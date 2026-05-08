import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MARK_BEGIN = '# >>> term-tabout collector';
export const MARK_END = '# <<< term-tabout collector';

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
export async function install(opts: InstallOptions): Promise<InstallResult> {
  const rcPath = opts.rcPath ?? path.join(os.homedir(), '.zshrc');
  const block = [MARK_BEGIN, `source ${opts.collectorPath}`, MARK_END].join('\n');

  let existing = '';
  try {
    existing = await fs.readFile(rcPath, 'utf-8');
  } catch {
    // 文件不存在 → 视为空，apply 时会创建
  }

  const alreadyInstalled =
    existing.includes(MARK_BEGIN) && existing.includes(MARK_END);

  if (alreadyInstalled || !opts.apply) {
    return { rcPath, alreadyInstalled, block, applied: false };
  }

  // 处理换行：原文件不以 \n 结尾时补一个；非空时在 block 前再加一个空行
  let prefix: string;
  if (!existing) prefix = '';
  else if (existing.endsWith('\n\n')) prefix = '';
  else if (existing.endsWith('\n')) prefix = '\n';
  else prefix = '\n\n';
  await fs.writeFile(rcPath, existing + prefix + block + '\n');

  return { rcPath, alreadyInstalled: false, block, applied: true };
}

/** 移除 marker block 之间的所有内容（含 marker）。 */
export async function uninstall(opts: {
  rcPath?: string;
  apply: boolean;
}): Promise<{ rcPath: string; removed: boolean; applied: boolean }> {
  const rcPath = opts.rcPath ?? path.join(os.homedir(), '.zshrc');
  let existing: string;
  try {
    existing = await fs.readFile(rcPath, 'utf-8');
  } catch {
    return { rcPath, removed: false, applied: false };
  }

  const lines = existing.split('\n');
  const beginIdx = lines.findIndex((l) => l.trim() === MARK_BEGIN);
  const endIdx = lines.findIndex((l) => l.trim() === MARK_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    return { rcPath, removed: false, applied: false };
  }

  if (!opts.apply) {
    return { rcPath, removed: true, applied: false };
  }

  // 一并吃掉 block 前的空行（避免 .zshrc 中残留连续空行）
  let dropFrom = beginIdx;
  while (dropFrom > 0 && lines[dropFrom - 1].trim() === '') dropFrom--;
  const next = [...lines.slice(0, dropFrom), ...lines.slice(endIdx + 1)].join('\n');
  await fs.writeFile(rcPath, next);
  return { rcPath, removed: true, applied: true };
}
