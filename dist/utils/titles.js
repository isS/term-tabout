import { promises as fs } from 'node:fs';
import path from 'node:path';
/**
 * 用户重命名的会话标题持久化到 ~/.term-tabout/titles.json。
 * 按 cwd 索引（PID 易变，不能作 key）。
 *
 * UI 层写、collector 不读。读路径已在 SessionManager 里做。
 */
export class JsonTitlesStore {
    file;
    map = {};
    loaded = false;
    constructor(home) {
        this.file = path.join(home, 'titles.json');
    }
    async load() {
        try {
            const raw = await fs.readFile(this.file, 'utf-8');
            const parsed = JSON.parse(raw);
            this.map = parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            this.map = {};
        }
        this.loaded = true;
    }
    get(cwd) {
        return this.map[cwd];
    }
    async set(cwd, title) {
        if (!this.loaded)
            await this.load();
        this.map[cwd] = title;
        await this.save();
    }
    async delete(cwd) {
        if (!this.loaded)
            await this.load();
        delete this.map[cwd];
        await this.save();
    }
    async save() {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp.${process.pid}`;
        await fs.writeFile(tmp, JSON.stringify(this.map, null, 2));
        await fs.rename(tmp, this.file);
    }
}
