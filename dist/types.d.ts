import { z } from 'zod';
/**
 * Collector 写入 ~/.term-tabout/states/{PID}.json 的原始 schema。
 * startedAt 在该 PID 的第一次记录时写入，之后保持不变；updatedAt 每次都刷新。
 */
export declare const SessionSchema: z.ZodObject<{
    pid: z.ZodNumber;
    cwd: z.ZodString;
    term: z.ZodDefault<z.ZodString>;
    lastCmd: z.ZodDefault<z.ZodString>;
    /** 老 collector 不写此字段时 watcher 会用 updatedAt 兜底 */
    startedAt: z.ZodOptional<z.ZodNumber>;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    pid: number;
    cwd: string;
    term: string;
    lastCmd: string;
    updatedAt: number;
    startedAt?: number | undefined;
}, {
    pid: number;
    cwd: string;
    updatedAt: number;
    term?: string | undefined;
    lastCmd?: string | undefined;
    startedAt?: number | undefined;
}>;
export type Session = z.infer<typeof SessionSchema>;
/**
 * SessionManager 在读取 state 后挂上的运行时元数据。
 * 这些字段不写回 state 文件 — 它们要么来自其他文件（titles/saved），
 * 要么是每次扫描动态算出来的（alive）。
 */
export interface SessionWithMeta extends Omit<Session, 'startedAt'> {
    /** 总是有值：collector 写的，或 watcher 用 updatedAt 兜底 */
    startedAt: number;
    /** PID 是否还活着（process.kill(pid, 0) 探测） */
    alive: boolean;
    /** 用户在 titles.json 中重命名的标题；缺省时由 UI 自动从 cwd 推断 */
    title?: string;
    /** 该 cwd 是否在 saved.yaml 里被标记保存 */
    saved: boolean;
    /** cwd 所在的 git repo 根（含 .git 的目录），不在 repo 内为 null */
    repoRoot: string | null;
    /** 当前 git branch；detached HEAD 时是短 sha，不在 repo 内为 null */
    branch: string | null;
}
