import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { SessionRow } from './SessionRow.js';
import { formatDuration } from '../utils/format.js';
export const SessionGroup = ({ group, home, focused, focusedRowIndex, renaming, renameBuffer, now, resolveTitle, batchMode, selectedPids, }) => {
    const oldest = formatDuration(now - group.oldestStartedAt);
    const sessionWord = group.sessions.length === 1 ? 'session' : 'sessions';
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: focused ? 'cyan' : 'gray', paddingX: 1, marginBottom: 1, children: [_jsxs(Box, { children: [_jsx(Text, { bold: true, color: focused ? 'cyan' : undefined, children: group.name }), group.branch && (_jsxs(Text, { color: "magenta", children: ['  [', group.branch, ']'] })), _jsxs(Text, { dimColor: true, children: ['  ', group.sessions.length, " ", sessionWord] }), group.duplicateCwds > 0 && (_jsxs(Text, { dimColor: true, children: ['  (', group.duplicateCwds + 1, "\u00D7 same cwd", ')'] })), group.saved && _jsx(Text, { color: "yellow", children: '  ★ saved' }), group.hasStale && _jsx(Text, { color: "red", children: '  stale' }), _jsxs(Text, { dimColor: true, children: ['  oldest ', oldest] })] }), _jsx(Box, { children: _jsx(Text, { dimColor: true, children: '─'.repeat(40) }) }), group.sessions.map((s, i) => {
                const fallback = deriveTitleFallback(s.cwd, home, group.name);
                const { title, manual } = resolveTitle(s.cwd, fallback);
                const isFocusedRow = focused && focusedRowIndex === i;
                return (_jsxs(Box, { flexDirection: "column", children: [i > 0 && (_jsx(Box, { children: _jsx(Text, { dimColor: true, children: '·'.repeat(40) }) })), _jsx(SessionRow, { session: s, home: home, focused: isFocusedRow, renaming: isFocusedRow && renaming, renameBuffer: renameBuffer, now: now, title: title, hasManualTitle: manual, batchMode: batchMode, batchSelected: selectedPids?.has(s.pid) })] }, s.pid));
            })] }));
};
/**
 * 派生默认标题：
 *   ~/project/foo/src/ui  →  "foo · src/ui"
 *   ~/project/foo         →  groupName ("foo")
 */
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
