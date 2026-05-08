import { describe, expect, it } from 'vitest';
import { groupSessions } from './groups.js';
import type { SessionWithMeta } from '../types.js';

const HOME = '/Users/me';

function s(over: Partial<SessionWithMeta>): SessionWithMeta {
  return {
    pid: 1,
    cwd: '/Users/me/project/foo',
    term: 'iTerm',
    lastCmd: 'idle',
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    alive: true,
    saved: false,
    repoRoot: null,
    branch: null,
    ...over,
  };
}

describe('groupSessions', () => {
  it('groups by 2nd-level cwd segment under home', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/Users/me/project/foo' }),
        s({ pid: 2, cwd: '/Users/me/project/foo/src' }),
        s({ pid: 3, cwd: '/Users/me/work/bar' }),
      ],
      HOME
    );
    expect(groups.map((g) => g.name).sort()).toEqual(['bar', 'foo']);
    const foo = groups.find((g) => g.name === 'foo')!;
    expect(foo.sessions).toHaveLength(2);
  });

  it('counts duplicates when same cwd repeats', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/Users/me/project/foo' }),
        s({ pid: 2, cwd: '/Users/me/project/foo' }),
        s({ pid: 3, cwd: '/Users/me/project/foo' }),
      ],
      HOME
    );
    expect(groups[0].duplicateCwds).toBe(2); // 3 - 1 unique = 2 extras
  });

  it('orders sessions in a group by startedAt asc', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/Users/me/project/foo', startedAt: 3 }),
        s({ pid: 2, cwd: '/Users/me/project/foo', startedAt: 1 }),
        s({ pid: 3, cwd: '/Users/me/project/foo', startedAt: 2 }),
      ],
      HOME
    );
    expect(groups[0].sessions.map((x) => x.pid)).toEqual([2, 3, 1]);
    expect(groups[0].oldestStartedAt).toBe(1);
  });

  it('flags hasStale when any member is dead', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/Users/me/project/foo', alive: true }),
        s({ pid: 2, cwd: '/Users/me/project/foo', alive: false }),
      ],
      HOME
    );
    expect(groups[0].hasStale).toBe(true);
  });

  it('flags saved when any member is saved', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/Users/me/project/foo', saved: false }),
        s({ pid: 2, cwd: '/Users/me/project/foo', saved: true }),
      ],
      HOME
    );
    expect(groups[0].saved).toBe(true);
  });

  it('treats home itself as "Home"', () => {
    const groups = groupSessions([s({ pid: 1, cwd: HOME })], HOME);
    expect(groups[0].name).toBe('Home');
  });

  it('uses basename for paths outside home', () => {
    const groups = groupSessions([s({ pid: 1, cwd: '/etc/hosts' })], HOME);
    expect(groups[0].name).toBe('hosts');
  });

  it('sorts groups by their oldestStartedAt asc', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/Users/me/a/x', startedAt: 200 }),
        s({ pid: 2, cwd: '/Users/me/b/y', startedAt: 100 }),
      ],
      HOME
    );
    expect(groups.map((g) => g.name)).toEqual(['y', 'x']);
  });

  it('uses repoRoot basename when present (overrides cwd-based heuristic)', () => {
    // 三个 session，cwd 在不同子目录 / 完全不同的二级目录，但 repoRoot 一致
    const groups = groupSessions(
      [
        s({
          pid: 1,
          cwd: '/Users/me/project/term-tabout',
          repoRoot: '/Users/me/project/term-tabout',
        }),
        s({
          pid: 2,
          cwd: '/Users/me/project/term-tabout/src/ui',
          repoRoot: '/Users/me/project/term-tabout',
        }),
        s({
          pid: 3,
          cwd: '/Users/me/project/term-tabout/etl',
          repoRoot: '/Users/me/project/term-tabout',
        }),
      ],
      HOME
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('term-tabout');
    expect(groups[0].sessions).toHaveLength(3);
  });

  it('falls back to cwd-based key when repoRoot is null', () => {
    const groups = groupSessions(
      [s({ pid: 1, cwd: '/Users/me/project/foo', repoRoot: null })],
      HOME
    );
    expect(groups[0].name).toBe('foo');
  });

  it('exposes the first non-null branch on the group', () => {
    const groups = groupSessions(
      [
        s({ pid: 1, cwd: '/r', repoRoot: '/r', branch: 'main' }),
        s({ pid: 2, cwd: '/r/sub', repoRoot: '/r', branch: 'main' }),
      ],
      HOME
    );
    expect(groups[0].branch).toBe('main');
  });

  it('group branch is null when no session has a branch', () => {
    const groups = groupSessions(
      [s({ pid: 1, cwd: '/Users/me/project/foo' })],
      HOME
    );
    expect(groups[0].branch).toBeNull();
  });
});
