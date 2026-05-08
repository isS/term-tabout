import React from 'react';
import { Box, Text } from 'ink';
import type { SessionWithMeta } from '../types.js';
import { formatStartedAt, formatDuration, tildify } from '../utils/format.js';

const TERM_COLOR: Record<string, 'yellow' | 'magenta' | 'gray' | 'cyan'> = {
  iterm: 'yellow',
  'iterm.app': 'yellow',
  ghostty: 'magenta',
  apple_terminal: 'gray',
  terminal: 'gray',
  wezterm: 'cyan',
};

const TERM_LABEL: Record<string, string> = {
  iterm: 'iT',
  'iterm.app': 'iT',
  ghostty: 'Gh',
  apple_terminal: 'Te',
  terminal: 'Te',
  wezterm: 'Wz',
};

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

interface RowProps {
  session: SessionWithMeta;
  home: string;
  focused: boolean;
  renaming: boolean;
  renameBuffer: string;
  now: number;
  /** 已合并好的标题（manual 优先 > derived） */
  title: string;
  hasManualTitle: boolean;
  /** 处于批量 kill 模式时，是否被勾选 */
  batchSelected?: boolean;
  /** 是否在批量模式（影响行首是否显示复选框） */
  batchMode?: boolean;
}

export const SessionRow: React.FC<RowProps> = ({
  session,
  home,
  focused,
  renaming,
  renameBuffer,
  now,
  title,
  hasManualTitle,
  batchSelected,
  batchMode,
}) => {
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

  return (
    <Box flexDirection="column" paddingY={0}>
      {/* row 1: [checkbox] + term tag + ✎ marker + title (or rename input) */}
      <Box>
        {batchMode && (
          <Text color={batchSelected ? 'red' : 'gray'}>
            {batchSelected ? '[✓] ' : '[ ] '}
          </Text>
        )}
        <Text color={tagColor} bold>
          {tagLabel}
        </Text>
        <Text> </Text>
        {hasManualTitle && !renaming && <Text color="yellow">✎ </Text>}
        {renaming ? (
          <>
            <Text color="cyan">✎ </Text>
            <Text color="cyan" inverse>
              {' '}
              {renameBuffer}
              {'_'}
              {' '}
            </Text>
            <Text dimColor>  ⏎ save · esc cancel</Text>
          </>
        ) : (
          <Text bold color={focused ? 'cyan' : undefined}>
            {title}
          </Text>
        )}
        {focused && !renaming && (
          <Text dimColor>  [r rename]</Text>
        )}
      </Box>

      {/* row 2: cwd */}
      <Box marginLeft={3}>
        <Text dimColor>{cwdShown}</Text>
      </Box>

      {/* row 3: prompt + cmd */}
      <Box marginLeft={3}>
        <Text color="green">❯ </Text>
        {cmd === 'idle' ? (
          <Text color="gray" italic>
            idle
          </Text>
        ) : (
          <Text color="yellow">{cmd}</Text>
        )}
      </Box>

      {/* row 4: time meta */}
      <Box marginLeft={3}>
        <Text dimColor>started </Text>
        <Text>{startedTxt}</Text>
        <Text dimColor>  {isStale ? 'ran ' : 'running '}</Text>
        <Text>{runningTxt}</Text>
        <Text dimColor>  </Text>
        {isStale ? (
          <>
            <Text color="red">died </Text>
            <Text color="red">{lastTxt}</Text>
          </>
        ) : isIdle ? (
          <Text color="gray" italic>
            idle {lastTxt}
          </Text>
        ) : (
          <>
            <Text dimColor>last </Text>
            <Text>{lastTxt}</Text>
          </>
        )}
        <Text dimColor>
          {'  · PID '}
          {session.pid}
          {isStale ? ' · gone' : ''}
        </Text>
      </Box>
    </Box>
  );
};
