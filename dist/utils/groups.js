import path from 'node:path';
/**
 * 把 sessions 按"项目"归组。优先级：
 *   1. session.repoRoot 非空 → basename(repoRoot)（git 仓库就是项目）
 *   2. cwd 在 home 下取第二层：~/{a}/{b}/* → "{b}"
 *   3. cwd 仅一层 ~/X → "X"
 *   4. cwd === home → "Home"
 *   5. 不在 home 下 → basename(cwd)
 *
 * git repo 根优先确保 ~/project/foo 和 ~/project/foo/server 落到同一组，
 * 即使它们的二级目录（"foo" vs 不同子目录的"foo"）一致，也由 repoRoot 决定。
 */
export function groupSessions(sessions, home) {
    const map = new Map();
    for (const s of sessions) {
        const key = deriveGroupKey(s, home);
        const list = map.get(key);
        if (list)
            list.push(s);
        else
            map.set(key, [s]);
    }
    const groups = [];
    for (const [name, list] of map) {
        list.sort((a, b) => a.startedAt - b.startedAt);
        const cwdCounts = new Map();
        for (const s of list)
            cwdCounts.set(s.cwd, (cwdCounts.get(s.cwd) ?? 0) + 1);
        let duplicateCwds = 0;
        for (const c of cwdCounts.values())
            if (c > 1)
                duplicateCwds += c - 1;
        // group 的 branch 取首个 session 的；同一 repoRoot 的 session 共享 branch
        const branch = list.find((s) => s.branch != null)?.branch ?? null;
        groups.push({
            name,
            sessions: list,
            oldestStartedAt: list[0].startedAt,
            duplicateCwds,
            saved: list.some((s) => s.saved),
            hasStale: list.some((s) => !s.alive),
            branch,
        });
    }
    // group 排序：先 focused（调用方处理）→ 按 oldest 升序（最久挂着的优先看见）
    groups.sort((a, b) => a.oldestStartedAt - b.oldestStartedAt);
    return groups;
}
function deriveGroupKey(s, home) {
    if (s.repoRoot)
        return path.basename(s.repoRoot);
    if (s.cwd === home)
        return 'Home';
    if (s.cwd.startsWith(home + '/')) {
        const rel = s.cwd.slice(home.length + 1);
        const segs = rel.split('/').filter(Boolean);
        // ~/project/foo/* → "foo"；~/dotfiles → "dotfiles"
        if (segs.length >= 2)
            return segs[1];
        return segs[0] || 'Home';
    }
    return path.basename(s.cwd) || s.cwd;
}
