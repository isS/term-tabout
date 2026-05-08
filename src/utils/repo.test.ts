import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRepoRootSync,
  clearRepoCache,
  getBranchSync,
} from './repo.js';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('findRepoRootSync', () => {
  beforeEach(() => {
    clearRepoCache();
  });

  it('returns null for paths outside any repo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-repo-no-'));
    expect(findRepoRootSync(dir)).toBeNull();
  });

  it('finds the repo root when cwd is the root itself', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-repo-root-'));
    await mkdir(path.join(dir, '.git'));
    expect(findRepoRootSync(dir)).toBe(dir);
  });

  it('walks upward from a nested cwd', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-repo-nested-'));
    await mkdir(path.join(dir, '.git'));
    const deep = path.join(dir, 'src', 'ui', 'components');
    await mkdir(deep, { recursive: true });
    expect(findRepoRootSync(deep)).toBe(dir);
  });

  it('treats a .git file (worktree pointer) as repo marker', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-repo-worktree-'));
    await writeFile(path.join(dir, '.git'), 'gitdir: /elsewhere\n');
    const sub = path.join(dir, 'sub');
    await mkdir(sub);
    expect(findRepoRootSync(sub)).toBe(dir);
  });

  it('caches results (second call returns same value)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-repo-cache-'));
    await mkdir(path.join(dir, '.git'));
    const first = findRepoRootSync(dir);
    const second = findRepoRootSync(dir);
    expect(first).toBe(second);
    expect(first).toBe(dir);
  });

  it('returns null and caches null for non-repo paths', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-repo-cachenull-'));
    expect(findRepoRootSync(dir)).toBeNull();
    expect(findRepoRootSync(dir)).toBeNull();
  });

  it('uses the inner repo when nested repos exist', async () => {
    const outer = await mkdtemp(path.join(tmpdir(), 'tt-repo-nested2-'));
    await mkdir(path.join(outer, '.git'));
    const inner = path.join(outer, 'vendor', 'thing');
    await mkdir(inner, { recursive: true });
    await mkdir(path.join(inner, '.git'));
    const sub = path.join(inner, 'src');
    await mkdir(sub);
    expect(findRepoRootSync(sub)).toBe(inner);
  });

  // 平台相关：仅 POSIX 环境下做软链测试
  it('follows realpath through symlinks (best effort)', async () => {
    const real = await mkdtemp(path.join(tmpdir(), 'tt-repo-symreal-'));
    await mkdir(path.join(real, '.git'));
    const linkParent = await mkdtemp(path.join(tmpdir(), 'tt-repo-symlink-'));
    const link = path.join(linkParent, 'work');
    await symlink(real, link);
    // 通过软链路径访问，应该能识别到 real 的 .git
    const result = findRepoRootSync(link);
    expect(result).not.toBeNull();
    // 不强求结果是 real 或 link（path.resolve 不解 symlink），只要找得到
  });
});

describe('getBranchSync', () => {
  beforeEach(() => {
    clearRepoCache();
  });

  it('reads branch name from refs/heads/<name>', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-branch-ref-'));
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    expect(getBranchSync(dir)).toBe('main');
  });

  it('handles branch names with slashes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-branch-slash-'));
    await mkdir(path.join(dir, '.git'));
    await writeFile(
      path.join(dir, '.git', 'HEAD'),
      'ref: refs/heads/feature/foo-bar\n'
    );
    expect(getBranchSync(dir)).toBe('feature/foo-bar');
  });

  it('returns short sha for detached HEAD (40-hex)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-branch-detached-'));
    await mkdir(path.join(dir, '.git'));
    await writeFile(
      path.join(dir, '.git', 'HEAD'),
      'a1b2c3d4e5f6789012345678901234567890abcd\n'
    );
    expect(getBranchSync(dir)).toBe('a1b2c3d');
  });

  it('returns null when not a repo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-branch-norepo-'));
    expect(getBranchSync(dir)).toBeNull();
  });

  it('returns null when HEAD is missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-branch-nohead-'));
    await mkdir(path.join(dir, '.git'));
    expect(getBranchSync(dir)).toBeNull();
  });

  it('follows worktree pointer file (.git is a file)', async () => {
    const real = await mkdtemp(path.join(tmpdir(), 'tt-branch-wt-real-'));
    await mkdir(path.join(real, '.git'));
    await writeFile(path.join(real, '.git', 'HEAD'), 'ref: refs/heads/feat\n');

    const wt = await mkdtemp(path.join(tmpdir(), 'tt-branch-wt-'));
    await writeFile(
      path.join(wt, '.git'),
      `gitdir: ${path.join(real, '.git')}\n`
    );
    expect(getBranchSync(wt)).toBe('feat');
  });

  it('caches results', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tt-branch-cache-'));
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/v1\n');
    const first = getBranchSync(dir);
    // 删 HEAD，cache 内的值应该仍然返回（5s TTL）
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(dir, '.git', 'HEAD'));
    const second = getBranchSync(dir);
    expect(first).toBe('v1');
    expect(second).toBe('v1');
  });
});
