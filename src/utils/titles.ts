import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 用户重命名的 session 标题持久化到 ~/.term-tabout/titles.json。
 *
 * 按 **PID（字符串化）** 索引而非 cwd —— 同一个 group 里两个 shell 的 cwd
 * 可能相同，按 cwd 索引会让两个 row 共用一个 title（用户实际遇到的 bug）。
 * PID 跨重启会复用，purgeStale 会同步清理 dead PID 的 title 条目。
 */
export class JsonTitlesStore {
  private file: string;
  private map: Record<string, string> = {};
  private loaded = false;

  constructor(home: string) {
    this.file = path.join(home, 'titles.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf-8');
      const parsed = JSON.parse(raw);
      this.map = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.map = {};
    }
    this.loaded = true;
  }

  get(pid: number): string | undefined {
    return this.map[String(pid)];
  }

  async set(pid: number, title: string): Promise<void> {
    if (!this.loaded) await this.load();
    this.map[String(pid)] = title;
    await this.save();
  }

  async delete(pid: number): Promise<void> {
    if (!this.loaded) await this.load();
    delete this.map[String(pid)];
    await this.save();
  }

  /** 删除所有不在 alivePids 中的 title 条目，返回是否变更过 */
  async pruneDead(alivePids: Set<number>): Promise<boolean> {
    if (!this.loaded) await this.load();
    let changed = false;
    for (const k of Object.keys(this.map)) {
      const pid = Number(k);
      if (!Number.isFinite(pid) || !alivePids.has(pid)) {
        delete this.map[k];
        changed = true;
      }
    }
    if (changed) await this.save();
    return changed;
  }

  /** 拷贝当前 map（仅用于 server 侧只读分发）*/
  snapshot(): Record<string, string> {
    return { ...this.map };
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(this.map, null, 2));
    await fs.rename(tmp, this.file);
  }
}
