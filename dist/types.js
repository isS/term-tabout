import { z } from 'zod';
/**
 * Collector 写入 ~/.term-tabout/states/{PID}.json 的原始 schema。
 * startedAt 在该 PID 的第一次记录时写入，之后保持不变；updatedAt 每次都刷新。
 */
export const SessionSchema = z.object({
    pid: z.number().int().positive(),
    cwd: z.string().min(1),
    term: z.string().default('unknown'),
    lastCmd: z.string().default('idle'),
    /** 老 collector 不写此字段时 watcher 会用 updatedAt 兜底 */
    startedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
});
