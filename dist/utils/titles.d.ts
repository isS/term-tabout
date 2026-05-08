/**
 * 用户重命名的会话标题持久化到 ~/.term-tabout/titles.json。
 * 按 cwd 索引（PID 易变，不能作 key）。
 *
 * UI 层写、collector 不读。读路径已在 SessionManager 里做。
 */
export declare class JsonTitlesStore {
    private file;
    private map;
    private loaded;
    constructor(home: string);
    load(): Promise<void>;
    get(cwd: string): string | undefined;
    set(cwd: string, title: string): Promise<void>;
    delete(cwd: string): Promise<void>;
    private save;
}
