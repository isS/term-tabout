import { beforeEach, describe, expect, it } from 'vitest';
import { JsonTitlesStore } from './titles.js';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('JsonTitlesStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tt-titles-'));
  });

  it('returns undefined for missing keys', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get(12345)).toBeUndefined();
  });

  it('loads existing titles.json keyed by pid string', async () => {
    await writeFile(
      path.join(dir, 'titles.json'),
      JSON.stringify({ '12345': 'My title' })
    );
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get(12345)).toBe('My title');
  });

  it('persists set and re-reads on a fresh store', async () => {
    const a = new JsonTitlesStore(dir);
    await a.load();
    await a.set(11111, 'Project A');

    const b = new JsonTitlesStore(dir);
    await b.load();
    expect(b.get(11111)).toBe('Project A');
  });

  it('two distinct pids get independent titles', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.set(1, 'one');
    await s.set(2, 'two');
    expect(s.get(1)).toBe('one');
    expect(s.get(2)).toBe('two');
  });

  it('removes an entry via delete', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.set(42, 'X');
    await s.delete(42);
    const raw = await readFile(path.join(dir, 'titles.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({});
  });

  it('pruneDead removes pids not in alive set', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.set(100, 'alive');
    await s.set(200, 'dead');
    await s.set(300, 'also dead');
    const changed = await s.pruneDead(new Set([100]));
    expect(changed).toBe(true);
    expect(s.get(100)).toBe('alive');
    expect(s.get(200)).toBeUndefined();
    expect(s.get(300)).toBeUndefined();
  });

  it('pruneDead with non-numeric keys also drops them', async () => {
    await writeFile(
      path.join(dir, 'titles.json'),
      JSON.stringify({ '/old/cwd-key': 'legacy', '999': 'pid-keyed' })
    );
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.pruneDead(new Set([999]));
    expect(s.get(999)).toBe('pid-keyed');
    const raw = await readFile(path.join(dir, 'titles.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ '999': 'pid-keyed' });
  });

  it('handles missing file gracefully', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get(123)).toBeUndefined();
  });

  it('handles malformed JSON gracefully', async () => {
    await writeFile(path.join(dir, 'titles.json'), '{not json');
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get(123)).toBeUndefined();
  });

  it('uses atomic write (no partial files left over)', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.set(7, 'X');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files).toEqual(['titles.json']);
  });
});
