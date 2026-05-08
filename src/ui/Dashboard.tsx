import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SessionManager } from '../engine/watcher.js';
import { JsonTitlesStore } from '../utils/titles.js';
import { groupSessions } from '../utils/groups.js';
import type { SessionWithMeta } from '../types.js';
import { SessionGroup } from './SessionGroup.js';
import {
  copyToClipboard,
  killSession,
  teleportToSession,
} from '../utils/terminal.js';
import { formatDuration } from '../utils/format.js';

export interface DashboardProps {
  home: string;
}

type Mode = 'normal' | 'filter' | 'rename' | 'batch';

export const Dashboard: React.FC<DashboardProps> = ({ home }) => {
  const app = useApp();
  const [sessions, setSessions] = useState<SessionWithMeta[]>([]);
  const [now, setNow] = useState(Date.now());
  const [groupIdx, setGroupIdx] = useState(0);
  const [rowIdx, setRowIdx] = useState(0);
  const [mode, setMode] = useState<Mode>('normal');
  const [filterBuf, setFilterBuf] = useState('');
  const [renameBuf, setRenameBuf] = useState('');
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());
  const [titlesVersion, setTitlesVersion] = useState(0);
  const [toast, setToast] = useState<{ msg: string; tone: 'info' | 'ok' | 'warn' | 'err' } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  function showToast(msg: string, tone: 'info' | 'ok' | 'warn' | 'err' = 'info', ms = 2500): void {
    setToast({ msg, tone });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, ms);
  }
  // 清理 toast timer
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
  const [titles] = useState(() => new JsonTitlesStore(home));
  const [manager] = useState(() => new SessionManager({ home }));
  const [savedCwds, setSavedCwds] = useState<Set<string>>(new Set());

  // initial load + watcher subscribe
  useEffect(() => {
    titles.load().then(() => setTitlesVersion((v) => v + 1));
    let cleanup: (() => Promise<void>) | undefined;
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
          return (
            s.cwd.toLowerCase().includes(q) ||
            (s.lastCmd ?? '').toLowerCase().includes(q) ||
            titleMaybe.toLowerCase().includes(q)
          );
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
    if (groups.length === 0) return;
    if (groupIdx >= groups.length) setGroupIdx(groups.length - 1);
    const cur = groups[Math.min(groupIdx, groups.length - 1)];
    if (cur && rowIdx >= cur.sessions.length) {
      setRowIdx(Math.max(0, cur.sessions.length - 1));
    }
  }, [groups, groupIdx, rowIdx]);

  const currentGroup = groups[groupIdx];
  const currentRow = currentGroup?.sessions[rowIdx];

  function resolveTitle(cwd: string, fallback: string) {
    void titlesVersion; // re-render trigger when titles change
    const manual = titles.get(cwd);
    return { title: manual ?? fallback, manual: !!manual };
  }

  useInput((input, key) => {
    void handleKey(input, key);
  });

  async function handleKey(
    input: string,
    key: { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean }
  ): Promise<void> {
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
        setRowIdx((i) =>
          currentGroup ? Math.min(currentGroup.sessions.length - 1, i + 1) : 0
        );
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
        if (next.has(currentRow.pid)) next.delete(currentRow.pid);
        else next.add(currentRow.pid);
        setSelectedPids(next);
        return;
      }
      if (key.return) {
        if (selectedPids.size > 0) {
          for (const pid of selectedPids) killSession(pid);
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
      setRowIdx((i) =>
        currentGroup ? Math.min(currentGroup.sessions.length - 1, i + 1) : 0
      );
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
      if (wasSaved) next.delete(cwd);
      else next.add(cwd);
      setSavedCwds(next);
      await persistSaved(home, next);
      showToast(wasSaved ? `unsaved ${cwd}` : `★ saved ${cwd}`, 'ok');
      return;
    }
    if (input === 'c' && currentRow) {
      try {
        await copyToClipboard(currentRow.cwd);
        showToast(`✓ copied: ${currentRow.cwd}`, 'ok');
      } catch (err) {
        showToast(`✗ clipboard failed: ${(err as Error).message}`, 'err');
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
        showToast(
          isPrecise
            ? `✓ teleported to tty ${r.tty}`
            : `✓ activated ${term}${r.tty ? '' : ' (tty unresolved)'}${term.toLowerCase() === 'ghostty' ? ' — ghostty has no tab-level selection' : ''}`,
          'ok'
        );
      } else {
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

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* header */}
      <Box>
        <Text italic bold>
          Open sessions
        </Text>
        <Text>{'  '}</Text>
        <Text dimColor>
          {totalSessions} sessions · {cwdCount} cwds · oldest {oldestTxt} · {savedCount} saved · {staleCount} stale
        </Text>
      </Box>

      {/* filter bar */}
      {mode === 'filter' && (
        <Box marginY={1}>
          <Text color="cyan" bold>/ </Text>
          <Text>{filterBuf}</Text>
          <Text color="cyan" inverse>{' '}</Text>
          <Text dimColor>{'   esc clear · ⏎ apply'}</Text>
        </Box>
      )}

      {/* batch kill mode banner */}
      {mode === 'batch' && (
        <Box marginY={1}>
          <Text color="red" bold>
            BATCH KILL
          </Text>
          <Text>
            {'  '}
            {selectedPids.size} selected
          </Text>
          <Text dimColor>
            {'   space toggle · ↑↓←→ navigate · ⏎ kill all selected · esc cancel'}
          </Text>
        </Box>
      )}

      {/* groups */}
      <Box marginTop={1} flexDirection="column">
        {groups.length === 0 ? (
          <Text dimColor>
            {sessions.length === 0
              ? 'No active sessions yet. Source the collector in your shell rc file.'
              : 'No sessions match the filter.'}
          </Text>
        ) : (
          groups.map((g, gi) => (
            <SessionGroup
              key={g.name}
              group={g}
              home={home}
              focused={gi === groupIdx}
              focusedRowIndex={gi === groupIdx ? rowIdx : -1}
              renaming={gi === groupIdx && mode === 'rename'}
              renameBuffer={renameBuf}
              now={now}
              resolveTitle={resolveTitle}
              batchMode={mode === 'batch'}
              selectedPids={selectedPids}
            />
          ))
        )}
      </Box>

      {/* toast */}
      {toast && (
        <Box marginTop={1}>
          <Text
            color={
              toast.tone === 'ok' ? 'green'
              : toast.tone === 'warn' ? 'yellow'
              : toast.tone === 'err' ? 'red'
              : 'cyan'
            }
          >
            {toast.msg}
          </Text>
        </Box>
      )}

      {/* status bar */}
      {mode !== 'batch' && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            ↑↓/jk row · ←→/hl group · ⏎ teleport · r rename · s save · c copy · x kill · K force-kill · X batch · / filter · q quit
          </Text>
          {sessions.length <= 1 && (
            <Text dimColor>
              {'  '}tip: 上下在同 group 多 row 时生效；左右在多 group 时生效。当前只有 1 个 session，所以两者都看不出效果。
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

function deriveTitleFallback(
  cwd: string,
  home: string,
  groupName: string
): string {
  if (cwd === home) return 'Home';
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

async function persistSaved(home: string, cwds: Set<string>): Promise<void> {
  const file = path.join(home, 'saved.yaml');
  const body = Array.from(cwds).sort().join('\n') + (cwds.size ? '\n' : '');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, file);
}
