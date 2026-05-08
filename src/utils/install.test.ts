import { beforeEach, describe, expect, it } from 'vitest';
import { install, uninstall, MARK_BEGIN, MARK_END } from './install.js';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('install', () => {
  let dir: string;
  let rcPath: string;
  const collectorPath = '/abs/path/to/term-tabout.zsh';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tt-install-'));
    rcPath = path.join(dir, '.zshrc');
  });

  it('dry-run does not touch disk', async () => {
    await writeFile(rcPath, '# existing\n');
    const r = await install({ rcPath, collectorPath, apply: false });
    expect(r.applied).toBe(false);
    expect(r.alreadyInstalled).toBe(false);
    const after = await readFile(rcPath, 'utf-8');
    expect(after).toBe('# existing\n');
  });

  it('apply appends the marker block', async () => {
    await writeFile(rcPath, '# existing\n');
    const r = await install({ rcPath, collectorPath, apply: true });
    expect(r.applied).toBe(true);
    const after = await readFile(rcPath, 'utf-8');
    expect(after).toContain(MARK_BEGIN);
    expect(after).toContain(`source ${collectorPath}`);
    expect(after).toContain(MARK_END);
    expect(after.startsWith('# existing\n')).toBe(true);
  });

  it('detects already installed and refuses to duplicate', async () => {
    await writeFile(
      rcPath,
      `# existing\n${MARK_BEGIN}\nsource ${collectorPath}\n${MARK_END}\n`
    );
    const r = await install({ rcPath, collectorPath, apply: true });
    expect(r.alreadyInstalled).toBe(true);
    expect(r.applied).toBe(false);
    const after = await readFile(rcPath, 'utf-8');
    // 不应出现两次 begin marker
    expect(after.match(new RegExp(MARK_BEGIN, 'g'))?.length).toBe(1);
  });

  it('creates rc file when missing', async () => {
    // 不预创建 rcPath
    const r = await install({ rcPath, collectorPath, apply: true });
    expect(r.applied).toBe(true);
    await access(rcPath); // 不抛 = 存在
    const after = await readFile(rcPath, 'utf-8');
    expect(after).toContain(MARK_BEGIN);
  });

  it('handles rc file not ending with newline', async () => {
    await writeFile(rcPath, '# existing'); // 末尾无 \n
    await install({ rcPath, collectorPath, apply: true });
    const after = await readFile(rcPath, 'utf-8');
    expect(after).toContain('# existing\n');
    expect(after).toContain(MARK_BEGIN);
  });
});

describe('uninstall', () => {
  let dir: string;
  let rcPath: string;
  const collectorPath = '/abs/path/to/term-tabout.zsh';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tt-uninstall-'));
    rcPath = path.join(dir, '.zshrc');
  });

  it('removes the block in apply mode', async () => {
    await writeFile(
      rcPath,
      `# before\n\n${MARK_BEGIN}\nsource ${collectorPath}\n${MARK_END}\n# after\n`
    );
    const r = await uninstall({ rcPath, apply: true });
    expect(r.removed).toBe(true);
    expect(r.applied).toBe(true);
    const after = await readFile(rcPath, 'utf-8');
    expect(after).not.toContain(MARK_BEGIN);
    expect(after).not.toContain(MARK_END);
    expect(after).toContain('# before');
    expect(after).toContain('# after');
  });

  it('dry-run reports removable but does not write', async () => {
    const orig = `${MARK_BEGIN}\nsource ${collectorPath}\n${MARK_END}\n`;
    await writeFile(rcPath, orig);
    const r = await uninstall({ rcPath, apply: false });
    expect(r.removed).toBe(true);
    expect(r.applied).toBe(false);
    const after = await readFile(rcPath, 'utf-8');
    expect(after).toBe(orig);
  });

  it('returns removed=false when block absent', async () => {
    await writeFile(rcPath, '# nothing here\n');
    const r = await uninstall({ rcPath, apply: true });
    expect(r.removed).toBe(false);
    expect(r.applied).toBe(false);
  });

  it('returns gracefully when rc file missing', async () => {
    const r = await uninstall({ rcPath, apply: true });
    expect(r.removed).toBe(false);
    expect(r.applied).toBe(false);
  });
});
