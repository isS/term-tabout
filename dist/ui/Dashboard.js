import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SessionManager } from '../engine/watcher.js';
import { JsonTitlesStore } from '../utils/titles.js';
import { groupSessions } from '../utils/groups.js';
import { SessionGroup } from './SessionGroup.js';
import { copyToClipboard, killSession, teleportToSession, } from '../utils/terminal.js';
import { formatDuration } from '../utils/format.js';
export const Dashboard = ({ home }) => {
    const app = useApp();
    const [sessions, setSessions] = useState([]);
    const [now, setNow] = useState(Date.now());
    const [groupIdx, setGroupIdx] = useState(0);
    const [rowIdx, setRowIdx] = useState(0);
    const [mode, setMode] = useState('normal');
    const [filterBuf, setFilterBuf] = useState('');
    const [renameBuf, setRenameBuf] = useState('');
    const [selectedPids, setSelectedPids] = useState(new Set());
    const [titlesVersion, setTitlesVersion] = useState(0);
    const [toast, setToast] = useState(null);
    const toastTimerRef = useRef(null);
    function showToast(msg, tone = 'info', ms = 2500) {
        setToast({ msg, tone });
        if (toastTimerRef.current)
            clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
            setToast(null);
            toastTimerRef.current = null;
        }, ms);
    }
    // 清理 toast timer
    useEffect(() => () => { if (toastTimerRef.current)
        clearTimeout(toastTimerRef.current); }, []);
    const [titles] = useState(() => new JsonTitlesStore(home));
    const [manager] = useState(() => new SessionManager({ home }));
    const [savedCwds, setSavedCwds] = useState(new Set());
    // initial load + watcher subscribe
    useEffect(() => {
        titles.load().then(() => setTitlesVersion((v) => v + 1));
        let cleanup;
        cleanup = manager.watch(setSessions);
        return () => {
            void cleanup?.();
        };
    }, [manager, titles]);
    // tick "now" so relative times stay fresh
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    // groups (filter applied)
    const groups = useMemo(() => {
        const q = filterBuf.toLowerCase();
        const filtered = q
            ? sessions.filter((s) => {
                const titleMaybe = titles.get(s.cwd) ?? '';
                return (s.cwd.toLowerCase().includes(q) ||
                    (s.lastCmd ?? '').toLowerCase().includes(q) ||
                    titleMaybe.toLowerCase().includes(q));
            })
            : sessions;
        // saved 标记合入 SessionWithMeta（titles 由 SessionManager 已合并；
        // saved 这里再合并一次，因为外部 saved.yaml 可能在运行期被改动）
        const merged = filtered.map((s) => ({
            ...s,
            saved: s.saved || savedCwds.has(s.cwd),
        }));
        return groupSessions(merged, home);
    }, [sessions, filterBuf, home, titlesVersion, savedCwds, titles]);
    // clamp focus indices when groups change
    useEffect(() => {
        if (groups.length === 0)
            return;
        if (groupIdx >= groups.length)
            setGroupIdx(groups.length - 1);
        const cur = groups[Math.min(groupIdx, groups.length - 1)];
        if (cur && rowIdx >= cur.sessions.length) {
            setRowIdx(Math.max(0, cur.sessions.length - 1));
        }
    }, [groups, groupIdx, rowIdx]);
    const currentGroup = groups[groupIdx];
    const currentRow = currentGroup?.sessions[rowIdx];
    function resolveTitle(cwd, fallback) {
        void titlesVersion; // re-render trigger when titles change
        const manual = titles.get(cwd);
        return { title: manual ?? fallback, manual: !!manual };
    }
    useInput((input, key) => {
        void handleKey(input, key);
    });
    async function handleKey(input, key) {
        // ── rename mode ─────────────────────────────────────
        if (mode === 'rename') {
            if (key.escape) {
                setMode('normal');
                setRenameBuf('');
                return;
            }
            if (key.return) {
                if (currentRow && renameBuf.trim()) {
                    await titles.set(currentRow.cwd, renameBuf.trim());
                }
                setMode('normal');
                setRenameBuf('');
                setTitlesVersion((v) => v + 1);
                return;
            }
            if (key.backspace || key.delete) {
                setRenameBuf((b) => b.slice(0, -1));
                return;
            }
            if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
                setRenameBuf((b) => b + input);
            }
            return;
        }
        // ── batch kill mode ─────────────────────────────────
        if (mode === 'batch') {
            if (key.escape) {
                setMode('normal');
                setSelectedPids(new Set());
                return;
            }
            if (key.upArrow || input === 'k') {
                setRowIdx((i) => Math.max(0, i - 1));
                return;
            }
            if (key.downArrow || input === 'j') {
                setRowIdx((i) => currentGroup ? Math.min(currentGroup.sessions.length - 1, i + 1) : 0);
                return;
            }
            if (key.leftArrow || input === 'h') {
                setGroupIdx((i) => Math.max(0, i - 1));
                setRowIdx(0);
                return;
            }
            if (key.rightArrow || input === 'l') {
                setGroupIdx((i) => Math.min(groups.length - 1, i + 1));
                setRowIdx(0);
                return;
            }
            if (input === ' ' && currentRow) {
                const next = new Set(selectedPids);
                if (next.has(currentRow.pid))
                    next.delete(currentRow.pid);
                else
                    next.add(currentRow.pid);
                setSelectedPids(next);
                return;
            }
            if (key.return) {
                if (selectedPids.size > 0) {
                    for (const pid of selectedPids)
                        killSession(pid);
                }
                setMode('normal');
                setSelectedPids(new Set());
                return;
            }
            return;
        }
        // ── filter mode ─────────────────────────────────────
        if (mode === 'filter') {
            if (key.escape) {
                setMode('normal');
                setFilterBuf('');
                return;
            }
            if (key.return) {
                setMode('normal');
                return;
            }
            if (key.backspace || key.delete) {
                setFilterBuf((b) => b.slice(0, -1));
                return;
            }
            if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
                setFilterBuf((b) => b + input);
            }
            return;
        }
        // ── normal mode ─────────────────────────────────────
        // esc 在 normal mode 下不退出 — 终端启动 / keypad reset 容易误发 \e 序列，
        // 把 esc 绑成 exit 会让 TUI 一启动就消失。退出走 q（明确动作）。
        if (input === 'q') {
            app.exit();
            return;
        }
        if (key.upArrow || input === 'k') {
            setRowIdx((i) => Math.max(0, i - 1));
            return;
        }
        if (key.downArrow || input === 'j') {
            setRowIdx((i) => currentGroup ? Math.min(currentGroup.sessions.length - 1, i + 1) : 0);
            return;
        }
        if (key.leftArrow || input === 'h') {
            setGroupIdx((i) => Math.max(0, i - 1));
            setRowIdx(0);
            return;
        }
        if (key.rightArrow || input === 'l') {
            setGroupIdx((i) => Math.min(groups.length - 1, i + 1));
            setRowIdx(0);
            return;
        }
        if (input === '/') {
            setMode('filter');
            return;
        }
        if (input === 'r' && currentRow && currentGroup) {
            const fallback = deriveTitleFallback(currentRow.cwd, home, currentGroup.name);
            setRenameBuf(titles.get(currentRow.cwd) ?? fallback);
            setMode('rename');
            return;
        }
        if (input === 'R' && currentRow) {
            await titles.delete(currentRow.cwd);
            setTitlesVersion((v) => v + 1);
            return;
        }
        if (input === 's' && currentRow) {
            const cwd = currentRow.cwd;
            const next = new Set(savedCwds);
            const wasSaved = next.has(cwd);
            if (wasSaved)
                next.delete(cwd);
            else
                next.add(cwd);
            setSavedCwds(next);
            await persistSaved(home, next);
            showToast(wasSaved ? `unsaved ${cwd}` : `★ saved ${cwd}`, 'ok');
            return;
        }
        if (input === 'c' && currentRow) {
            try {
                await copyToClipboard(currentRow.cwd);
                showToast(`✓ copied: ${currentRow.cwd}`, 'ok');
            }
            catch (err) {
                showToast(`✗ clipboard failed: ${err.message}`, 'err');
            }
            return;
        }
        if (input === 'x' && currentRow) {
            const pid = currentRow.pid;
            killSession(pid, 'SIGTERM');
            showToast(`SIGTERM → PID ${pid}  (press K to escalate to SIGKILL)`, 'warn', 3500);
            return;
        }
        if (input === 'K' && currentRow) {
            const pid = currentRow.pid;
            killSession(pid, 'SIGKILL');
            showToast(`☠ SIGKILL → PID ${pid}`, 'err');
            return;
        }
        if (input === 'X') {
            setMode('batch');
            setSelectedPids(new Set());
            return;
        }
        if (key.return && currentRow) {
            const pid = currentRow.pid;
            const term = currentRow.term;
            showToast(`⇢ teleport → PID ${pid} (${term})...`, 'info', 1500);
            const r = await teleportToSession(pid, term);
            if (r.exitCode === 0) {
                const isPrecise = (term.toLowerCase().includes('iterm') || term.toLowerCase().includes('terminal')) && !!r.tty;
                showToast(isPrecise
                    ? `✓ teleported to tty ${r.tty}`
                    : `✓ activated ${term}${r.tty ? '' : ' (tty unresolved)'}${term.toLowerCase() === 'ghostty' ? ' — ghostty has no tab-level selection' : ''}`, 'ok');
            }
            else {
                const firstErr = r.stderr.split('\n')[0]?.trim() || `exit ${r.exitCode}`;
                showToast(`✗ teleport failed: ${firstErr}`, 'err', 4000);
            }
            return;
        }
    }
    // header counters
    const totalSessions = sessions.length;
    const cwdSet = new Set(sessions.map((s) => s.cwd));
    const cwdCount = cwdSet.size;
    const oldestStartedAt = sessions.length
        ? Math.min(...sessions.map((s) => s.startedAt))
        : now;
    const oldestTxt = sessions.length ? formatDuration(now - oldestStartedAt) : '0s';
    const savedCount = sessions.filter((s) => s.saved || savedCwds.has(s.cwd)).length;
    const staleCount = sessions.filter((s) => !s.alive).length;
    return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsxs(Box, { children: [_jsx(Text, { italic: true, bold: true, children: "Open sessions" }), _jsx(Text, { children: '  ' }), _jsxs(Text, { dimColor: true, children: [totalSessions, " sessions \u00B7 ", cwdCount, " cwds \u00B7 oldest ", oldestTxt, " \u00B7 ", savedCount, " saved \u00B7 ", staleCount, " stale"] })] }), mode === 'filter' && (_jsxs(Box, { marginY: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "/ " }), _jsx(Text, { children: filterBuf }), _jsx(Text, { color: "cyan", inverse: true, children: ' ' }), _jsx(Text, { dimColor: true, children: '   esc clear · ⏎ apply' })] })), mode === 'batch' && (_jsxs(Box, { marginY: 1, children: [_jsx(Text, { color: "red", bold: true, children: "BATCH KILL" }), _jsxs(Text, { children: ['  ', selectedPids.size, " selected"] }), _jsx(Text, { dimColor: true, children: '   space toggle · ↑↓←→ navigate · ⏎ kill all selected · esc cancel' })] })), _jsx(Box, { marginTop: 1, flexDirection: "column", children: groups.length === 0 ? (_jsx(Text, { dimColor: true, children: sessions.length === 0
                        ? 'No active sessions yet. Source the collector in your shell rc file.'
                        : 'No sessions match the filter.' })) : (groups.map((g, gi) => (_jsx(SessionGroup, { group: g, home: home, focused: gi === groupIdx, focusedRowIndex: gi === groupIdx ? rowIdx : -1, renaming: gi === groupIdx && mode === 'rename', renameBuffer: renameBuf, now: now, resolveTitle: resolveTitle, batchMode: mode === 'batch', selectedPids: selectedPids }, g.name)))) }), toast && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: toast.tone === 'ok' ? 'green'
                        : toast.tone === 'warn' ? 'yellow'
                            : toast.tone === 'err' ? 'red'
                                : 'cyan', children: toast.msg }) })), mode !== 'batch' && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "\u2191\u2193/jk row \u00B7 \u2190\u2192/hl group \u00B7 \u23CE teleport \u00B7 r rename \u00B7 s save \u00B7 c copy \u00B7 x kill \u00B7 K force-kill \u00B7 X batch \u00B7 / filter \u00B7 q quit" }), sessions.length <= 1 && (_jsxs(Text, { dimColor: true, children: ['  ', "tip: \u4E0A\u4E0B\u5728\u540C group \u591A row \u65F6\u751F\u6548\uFF1B\u5DE6\u53F3\u5728\u591A group \u65F6\u751F\u6548\u3002\u5F53\u524D\u53EA\u6709 1 \u4E2A session\uFF0C\u6240\u4EE5\u4E24\u8005\u90FD\u770B\u4E0D\u51FA\u6548\u679C\u3002"] }))] }))] }));
};
function deriveTitleFallback(cwd, home, groupName) {
    if (cwd === home)
        return 'Home';
    if (cwd.startsWith(home + '/')) {
        const rel = cwd.slice(home.length + 1);
        const segs = rel.split('/').filter(Boolean);
        if (segs.length > 2) {
            return `${segs[1]} · ${segs.slice(2).join('/')}`;
        }
        return groupName;
    }
    return groupName;
}
async function persistSaved(home, cwds) {
    const file = path.join(home, 'saved.yaml');
    const body = Array.from(cwds).sort().join('\n') + (cwds.size ? '\n' : '');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
}
