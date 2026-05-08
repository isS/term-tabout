import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { formatStartedAt, formatDuration, tildify } from '../utils/format.js';
const TERM_COLOR = {
    iterm: 'yellow',
    'iterm.app': 'yellow',
    ghostty: 'magenta',
    apple_terminal: 'gray',
    terminal: 'gray',
    wezterm: 'cyan',
};
const TERM_LABEL = {
    iterm: 'iT',
    'iterm.app': 'iT',
    ghostty: 'Gh',
    apple_terminal: 'Te',
    terminal: 'Te',
    wezterm: 'Wz',
};
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
export const SessionRow = ({ session, home, focused, renaming, renameBuffer, now, title, hasManualTitle, batchSelected, batchMode, }) => {
    const termKey = (session.term || 'unknown').toLowerCase();
    const tagColor = TERM_COLOR[termKey] ?? 'gray';
    const tagLabel = TERM_LABEL[termKey] ?? 'Sh';
    const startedTxt = formatStartedAt(session.startedAt, now);
    const runningMs = now - session.startedAt;
    const lastMs = now - session.updatedAt;
    const isStale = !session.alive;
    const isIdle = !isStale && lastMs > IDLE_THRESHOLD_MS;
    const lastTxt = formatDuration(lastMs);
    const runningTxt = formatDuration(runningMs);
    const cwdShown = tildify(session.cwd, home);
    const cmd = session.lastCmd || 'idle';
    return (_jsxs(Box, { flexDirection: "column", paddingY: 0, children: [_jsxs(Box, { children: [batchMode && (_jsx(Text, { color: batchSelected ? 'red' : 'gray', children: batchSelected ? '[✓] ' : '[ ] ' })), _jsx(Text, { color: tagColor, bold: true, children: tagLabel }), _jsx(Text, { children: " " }), hasManualTitle && !renaming && _jsx(Text, { color: "yellow", children: "\u270E " }), renaming ? (_jsxs(_Fragment, { children: [_jsx(Text, { color: "cyan", children: "\u270E " }), _jsxs(Text, { color: "cyan", inverse: true, children: [' ', renameBuffer, '_', ' '] }), _jsx(Text, { dimColor: true, children: "  \u23CE save \u00B7 esc cancel" })] })) : (_jsx(Text, { bold: true, color: focused ? 'cyan' : undefined, children: title })), focused && !renaming && (_jsx(Text, { dimColor: true, children: "  [r rename]" }))] }), _jsx(Box, { marginLeft: 3, children: _jsx(Text, { dimColor: true, children: cwdShown }) }), _jsxs(Box, { marginLeft: 3, children: [_jsx(Text, { color: "green", children: "\u276F " }), cmd === 'idle' ? (_jsx(Text, { color: "gray", italic: true, children: "idle" })) : (_jsx(Text, { color: "yellow", children: cmd }))] }), _jsxs(Box, { marginLeft: 3, children: [_jsx(Text, { dimColor: true, children: "started " }), _jsx(Text, { children: startedTxt }), _jsxs(Text, { dimColor: true, children: ["  ", isStale ? 'ran ' : 'running '] }), _jsx(Text, { children: runningTxt }), _jsx(Text, { dimColor: true, children: "  " }), isStale ? (_jsxs(_Fragment, { children: [_jsx(Text, { color: "red", children: "died " }), _jsx(Text, { color: "red", children: lastTxt })] })) : isIdle ? (_jsxs(Text, { color: "gray", italic: true, children: ["idle ", lastTxt] })) : (_jsxs(_Fragment, { children: [_jsx(Text, { dimColor: true, children: "last " }), _jsx(Text, { children: lastTxt })] })), _jsxs(Text, { dimColor: true, children: ['  · PID ', session.pid, isStale ? ' · gone' : ''] })] })] }));
};
