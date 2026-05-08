export declare const MARK_BEGIN = "# >>> term-tabout collector";
export declare const MARK_END = "# <<< term-tabout collector";
export interface InstallOptions {
    /** rc 文件路径，默认 ~/.zshrc */
    rcPath?: string;
    /** collector 脚本绝对路径 */
    collectorPath: string;
    /** false 表示 dry-run，仅返回将要写入的内容 */
    apply: boolean;
}
export interface InstallResult {
    rcPath: string;
    alreadyInstalled: boolean;
    /** 完整的 marker block，含起止注释 */
    block: string;
    /** apply 是否真的写入磁盘 */
    applied: boolean;
}
/**
 * 在 rc 文件末尾追加 collector 的 source 行（包在 marker block 中）。
 * dry-run 默认；只有 opts.apply === true 才真写。
 *
 * 已存在 marker block 时短路返回 alreadyInstalled=true，不重复追加。
 */
export declare function install(opts: InstallOptions): Promise<InstallResult>;
/** 移除 marker block 之间的所有内容（含 marker）。 */
export declare function uninstall(opts: {
    rcPath?: string;
    apply: boolean;
}): Promise<{
    rcPath: string;
    removed: boolean;
    applied: boolean;
}>;
