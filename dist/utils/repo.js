import fs from 'node:fs';
import path from 'node:path';
/**
 * 向上查找 .git（目录或 worktree 文件），返回 repo 根；不在 repo 内返回 null。
 *
 * 同步版本：watcher attach 是热路径，sync stat 比 async 微秒级更快，
 * 且 cache 命中后零开销。
 */
const cache = new Map();
export function findRepoRootSync(cwd) {
    const cached = cache.get(cwd);
    if (cached !== undefined)
        return cached;
    let dir = path.resolve(cwd);
    // 兜底防止 symlink 环；正常路径不会超过 64 层
    for (let i = 0; i < 64; i++) {
        try {
            fs.statSync(path.join(dir, '.git'));
            cache.set(cwd, dir);
            return dir;
        }
        catch {
            // 不存在，继续向上
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break; // 到根
        dir = parent;
    }
    cache.set(cwd, null);
    return null;
}
/** 测试 / 长时间运行时调用，避免 cache 失效 */
export function clearRepoCache() {
    cache.clear();
    branchCache.clear();
}
const branchCache = new Map();
const BRANCH_TTL_MS = 5_000; // branch 切换频率低，5s cache 足够新鲜也避开重复 IO
/**
 * 直接读 `.git/HEAD` 拿当前 branch；不依赖 `git` 二进制。
 *   - "ref: refs/heads/main\n"  → "main"
 *   - 40 位 sha (detached HEAD) → 短 sha
 *   - worktree (.git 是文件)    → 跟随 gitdir 指针再读一次
 *   - 任何 IO 错误              → null
 */
export function getBranchSync(repoRoot) {
    const now = Date.now();
    const cached = branchCache.get(repoRoot);
    if (cached && cached.expires > now)
        return cached.value;
    const value = readBranch(repoRoot);
    branchCache.set(repoRoot, { value, expires: now + BRANCH_TTL_MS });
    return value;
}
function readBranch(repoRoot) {
    const gitPath = path.join(repoRoot, '.git');
    try {
        const stat = fs.statSync(gitPath);
        if (stat.isDirectory()) {
            return parseHeadFile(path.join(gitPath, 'HEAD'));
        }
        if (stat.isFile()) {
            // worktree pointer: "gitdir: /abs/path/to/real/.git"
            const content = fs.readFileSync(gitPath, 'utf-8').trim();
            const m = content.match(/^gitdir:\s*(.+)$/m);
            if (!m)
                return null;
            const realGitDir = path.isAbsolute(m[1])
                ? m[1]
                : path.resolve(repoRoot, m[1]);
            return parseHeadFile(path.join(realGitDir, 'HEAD'));
        }
    }
    catch {
        /* fall through */
    }
    return null;
}
function parseHeadFile(headPath) {
    try {
        const head = fs.readFileSync(headPath, 'utf-8').trim();
        if (!head)
            return null;
        if (head.startsWith('ref: ')) {
            const ref = head.slice(5).trim();
            const m = ref.match(/^refs\/heads\/(.+)$/);
            return m ? m[1] : ref;
        }
        // 40-char sha → 短 sha；anything else 原样返回
        return /^[0-9a-f]{40}$/.test(head) ? head.slice(0, 7) : head;
    }
    catch {
        return null;
    }
}
