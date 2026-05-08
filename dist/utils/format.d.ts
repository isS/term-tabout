/**
 * 把 startedAt 渲染成绝对时间。
 * - 同一天：HH:MM
 * - 7 天内：Mon HH:MM
 * - 更早：MM-DD HH:MM
 */
export declare function formatStartedAt(ms: number, now?: number): string;
/**
 * 时长 / 相对时间格式化："2h 18m" / "47m" / "1d 4h" / "12s"
 * 单一函数兼顾 running（绝对时长）与 last（相对时间），调用方自己算 delta。
 */
export declare function formatDuration(ms: number): string;
export declare function formatRelative(ms: number, now?: number): string;
/** 路径用 ~ 缩写 */
export declare function tildify(p: string, home: string): string;
