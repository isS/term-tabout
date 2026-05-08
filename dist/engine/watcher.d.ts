import { type SessionWithMeta } from '../types.js';
export interface SessionManagerOptions {
    /** 状态目录根。默认 $TERM_TABOUT_DIR 或 ~/.term-tabout */
    home?: string;
}
/**
 * 读取 + 监听 collector 写入的 state 文件，并补足运行时元数据
 * （PID 存活探测、titles、saved）。
 */
export declare class SessionManager {
    readonly home: string;
    readonly stateDir: string;
    private titles;
    private saved;
    constructor(opts?: SessionManagerOptions);
    /** 一次性扫描所有活跃 session */
    getActiveSessions(): Promise<SessionWithMeta[]>;
    /**
     * 删除 PID 已死的 state 文件，返回清理数量。
     * 这是 spec 设计的权威 stale cleanup 路径，弥补 collector zshexit 失效的场景。
     */
    purgeStale(): Promise<number>;
    /**
     * 监听 state 目录变更。chokidar 已把新增 / 修改 / 删除统一抽象成事件。
     * 返回 dispose 函数。
     */
    watch(callback: (sessions: SessionWithMeta[]) => void): () => Promise<void>;
    private listStateFiles;
    private readOne;
    private attach;
    private loadAuxiliary;
}
