import React from 'react';
import { Box, Text } from 'ink';
import type { SessionGroup as Group } from '../utils/groups.js';
import { SessionRow } from './SessionRow.js';
import { formatDuration } from '../utils/format.js';

interface GroupProps {
  group: Group;
  home: string;
  focused: boolean;
  /** -1 表示该 group 未聚焦 */
  focusedRowIndex: number;
  renaming: boolean;
  renameBuffer: string;
  now: number;
  resolveTitle: (
    cwd: string,
    fallback: string
  ) => { title: string; manual: boolean };
  batchMode?: boolean;
  selectedPids?: Set<number>;
}

export const SessionGroup: React.FC<GroupProps> = ({
  group,
  home,
  focused,
  focusedRowIndex,
  renaming,
  renameBuffer,
  now,
  resolveTitle,
  batchMode,
  selectedPids,
}) => {
  const oldest = formatDuration(now - group.oldestStartedAt);
  const sessionWord = group.sessions.length === 1 ? 'session' : 'sessions';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
      marginBottom={1}
    >
      {/* group header */}
      <Box>
        <Text bold color={focused ? 'cyan' : undefined}>
          {group.name}
        </Text>
        {group.branch && (
          <Text color="magenta">{'  ['}{group.branch}{']'}</Text>
        )}
        <Text dimColor>
          {'  '}
          {group.sessions.length} {sessionWord}
        </Text>
        {group.duplicateCwds > 0 && (
          <Text dimColor>
            {'  ('}
            {group.duplicateCwds + 1}× same cwd{')'}
          </Text>
        )}
        {group.saved && <Text color="yellow">{'  ★ saved'}</Text>}
        {group.hasStale && <Text color="red">{'  stale'}</Text>}
        <Text dimColor>{'  oldest '}{oldest}</Text>
      </Box>

      {/* divider */}
      <Box>
        <Text dimColor>{'─'.repeat(40)}</Text>
      </Box>

      {/* rows */}
      {group.sessions.map((s, i) => {
        const fallback = deriveTitleFallback(s.cwd, home, group.name);
        const { title, manual } = resolveTitle(s.cwd, fallback);
        const isFocusedRow = focused && focusedRowIndex === i;
        return (
          <Box key={s.pid} flexDirection="column">
            {i > 0 && (
              <Box>
                <Text dimColor>{'·'.repeat(40)}</Text>
              </Box>
            )}
            <SessionRow
              session={s}
              home={home}
              focused={isFocusedRow}
              renaming={isFocusedRow && renaming}
              renameBuffer={renameBuffer}
              now={now}
              title={title}
              hasManualTitle={manual}
              batchMode={batchMode}
              batchSelected={selectedPids?.has(s.pid)}
            />
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * 派生默认标题：
 *   ~/project/foo/src/ui  →  "foo · src/ui"
 *   ~/project/foo         →  groupName ("foo")
 */
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
