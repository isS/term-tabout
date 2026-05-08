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
    expect(s.get('/some/cwd')).toBeUndefined();
  });

  it('loads existing titles.json', async () => {
    await writeFile(
      path.join(dir, 'titles.json'),
      JSON.stringify({ '/x': 'My title' })
    );
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get('/x')).toBe('My title');
  });

  it('persists set and re-reads on a fresh store', async () => {
    const a = new JsonTitlesStore(dir);
    await a.load();
    await a.set('/cwd1', 'Project A');

    const b = new JsonTitlesStore(dir);
    await b.load();
    expect(b.get('/cwd1')).toBe('Project A');
  });

  it('removes an entry via delete', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.set('/x', 'X');
    await s.delete('/x');
    const raw = await readFile(path.join(dir, 'titles.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({});
  });

  it('handles missing file gracefully', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get('/anything')).toBeUndefined();
  });

  it('handles malformed JSON gracefully', async () => {
    await writeFile(path.join(dir, 'titles.json'), '{not json');
    const s = new JsonTitlesStore(dir);
    await s.load();
    expect(s.get('/anything')).toBeUndefined();
  });

  it('uses atomic write (no partial files left over)', async () => {
    const s = new JsonTitlesStore(dir);
    await s.load();
    await s.set('/x', 'X');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files).toEqual(['titles.json']);
  });
});
