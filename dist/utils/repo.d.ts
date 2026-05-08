export declare function findRepoRootSync(cwd: string): string | null;
/** 测试 / 长时间运行时调用，避免 cache 失效 */
export declare function clearRepoCache(): void;
/**
 * 直接读 `.git/HEAD` 拿当前 branch；不依赖 `git` 二进制。
 *   - "ref: refs/heads/main\n"  → "main"
 *   - 40 位 sha (detached HEAD) → 短 sha
 *   - worktree (.git 是文件)    → 跟随 gitdir 指针再读一次
 *   - 任何 IO 错误              → null
 */
export declare function getBranchSync(repoRoot: string): string | null;
