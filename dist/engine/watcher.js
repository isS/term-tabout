import chokidar from 'chokidar';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionSchema } from '../types.js';
import { findRepoRootSync, getBranchSync } from '../utils/repo.js';
const DEFAULT_HOME = process.env.TERM_TABOUT_DIR
    ? path.resolve(process.env.TERM_TABOUT_DIR)
    : path.join(os.homedir(), '.term-tabout');
/**
 * 读取 + 监听 collector 写入的 state 文件，并补足运行时元数据
 * （PID 存活探测、titles、saved）。
 */
export class SessionManager {
    home;
    stateDir;
    titles = {};
    saved = new Set();
    constructor(opts = {}) {
        this.home = opts.home ?? DEFAULT_HOME;
        this.stateDir = path.join(this.home, 'states');
    }
    /** 一次性扫描所有活跃 session */
    async getActiveSessions() {
        await this.loadAuxiliary();
        const files = await this.listStateFiles();
        const parsed = await Promise.all(files.map((f) => this.readOne(f)));
        return parsed.filter((s) => s !== null);
    }
    /**
     * 删除 PID 已死的 state 文件，返回清理数量。
     * 这是 spec 设计的权威 stale cleanup 路径，弥补 collector zshexit 失效的场景。
     */
    async purgeStale() {
        const sessions = await this.getActiveSessions();
        let purged = 0;
        for (const s of sessions) {
            if (s.alive)
                continue;
            try {
                await fs.unlink(path.join(this.stateDir, `${s.pid}.json`));
                purged++;
            }
            catch {
                // 别人已删，忽略
            }
        }
        return purged;
    }
    /**
     * 监听 state 目录变更。chokidar 已把新增 / 修改 / 删除统一抽象成事件。
     * 返回 dispose 函数。
     */
    watch(callback) {
        const watcher = chokidar.watch(this.stateDir, {
            ignoreInitial: false,
            // collector 用 tmp + mv 原子写，但 chokidar 仍可能抓到中间态，
            // awaitWriteFinish 让我们等到文件稳定后再触发
            awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 20 },
        });
        const fire = async () => {
            try {
                callback(await this.getActiveSessions());
            }
            catch {
                callback([]);
            }
        };
        watcher.on('add', fire);
        watcher.on('change', fire);
        watcher.on('unlink', fire);
        watcher.on('ready', fire);
        return async () => {
            await watcher.close();
        };
    }
    async listStateFiles() {
        try {
            const entries = await fs.readdir(this.stateDir);
            return entries.filter((e) => e.endsWith('.json'));
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return [];
            throw err;
        }
    }
    async readOne(filename) {
        const file = path.join(this.stateDir, filename);
        try {
            const raw = await fs.readFile(file, 'utf-8');
            const parsed = SessionSchema.parse(JSON.parse(raw));
            return this.attach(parsed);
        }
        catch {
            // 损坏 / 半截 / schema 不符 → 静默丢弃，下次刷新会再试
            return null;
        }
    }
    attach(s) {
        const repoRoot = findRepoRootSync(s.cwd);
        return {
            ...s,
            // collector 老版本不写 startedAt → 用 updatedAt 兜底，避免会话被 schema 直接丢弃
            startedAt: s.startedAt ?? s.updatedAt,
            alive: isAlive(s.pid),
            title: this.titles[s.cwd],
            saved: this.saved.has(s.cwd),
            repoRoot,
            branch: repoRoot ? getBranchSync(repoRoot) : null,
        };
    }
    async loadAuxiliary() {
        // titles.json — { [cwd]: title }，UI 写、collector 不读
        try {
            const raw = await fs.readFile(path.join(this.home, 'titles.json'), 'utf-8');
            const parsed = JSON.parse(raw);
            this.titles = parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            this.titles = {};
        }
        // saved.yaml — 一行一个 cwd（最小实现，复杂结构留给后续）
        try {
            const raw = await fs.readFile(path.join(this.home, 'saved.yaml'), 'utf-8');
            this.saved = new Set(raw
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith('#')));
        }
        catch {
            this.saved = new Set();
        }
    }
}
function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // ESRCH = 进程不存在；EPERM = 存在但无权限（仍算活）
        return err.code === 'EPERM';
    }
}
