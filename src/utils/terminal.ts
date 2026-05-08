import { exec, spawn } from 'node:child_process';
import clipboard from 'clipboardy';

const DEBUG = !!process.env.TERM_TABOUT_DEBUG;

export interface TeleportResult {
  /** 解析出的 tty (e.g., "ttys010")，无法解析时为 null */
  tty: string | null;
  /** 实际跑的 AppleScript */
  script: string;
  /** osascript 退出码（0 = 成功；非 0 多半是 AppleScript 抛错） */
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 激活并切换到目标会话所在的窗口/Tab。
 *
 * 策略：
 *   1. 通过 PID 解析 tty（macOS `ps -p N -o tty=`，输出形如 `ttys010`）。
 *   2. iTerm / Terminal.app：遍历 windows → tabs → sessions，按 tty 后缀
 *      匹配到目标 session 后 select。
 *   3. Ghostty：截至 1.x 没有 AppleScript window/tab API，只能 activate 应用。
 *   4. 未知终端：尝试以 term 作为应用名 activate。
 *
 * 返回 TeleportResult 便于命令行调试（--teleport / TERM_TABOUT_DEBUG=1）。
 */
export async function teleportToSession(
  pid: number,
  term: string
): Promise<TeleportResult> {
  const t = (term || '').toLowerCase();
  const tty = await getTtyForPid(pid);

  let script: string;
  if (t === 'iterm.app' || t === 'iterm') script = buildItermScript(tty);
  else if (t === 'apple_terminal' || t === 'terminal') script = buildTerminalScript(tty);
  else if (t === 'ghostty') script = buildGhosttyScript();
  else {
    const safe = term || 'Terminal';
    script = `tell application "${safe.replace(/"/g, '\\"')}" to activate`;
  }
  const r = await runOsa(script);
  return { tty, script, ...r };
}

export async function copyToClipboard(text: string): Promise<void> {
  await clipboard.write(text);
}

export function killSession(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM'
): void {
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH = 已死，忽略
  }
}

/** ps -p PID -o tty= → "ttys010" 或 null */
export function getTtyForPid(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`ps -p ${pid} -o tty=`, (err, stdout) => {
      if (err) return resolve(null);
      const t = stdout.trim();
      // ps 在 PID 不存在时输出空，tty 缺失时输出 "??"
      resolve(t && t !== '??' ? t : null);
    });
  });
}

function buildItermScript(tty: string | null): string {
  if (!tty) return `tell application "iTerm" to activate`;
  // iTerm session.tty 形如 "/dev/ttys010"。用 ends with 防 prefix 差异。
  return `
tell application "iTerm"
  activate
  set _found to false
  repeat with _w in windows
    repeat with _t in tabs of _w
      repeat with _s in sessions of _t
        if (tty of _s) ends with "${tty}" then
          tell _w to set current tab to _t
          tell _w to select
          set _found to true
          exit repeat
        end if
      end repeat
      if _found then exit repeat
    end repeat
    if _found then exit repeat
  end repeat
end tell
`;
}

/**
 * Ghostty 没有 AppleScript window/tab API（截至 1.x），但走两步可以可靠地把
 * Ghostty.app 拉到前台 + 抢回焦点：
 *   1. `tell application "Ghostty" to activate` — 标准应用激活
 *   2. `System Events` 把 Ghostty 进程 frontmost 置 true — 在 Stage Manager / 多桌面 / 其他 app 全屏时仍能抢回
 * 真正的"选中具体 tab"目前要靠用户自己切，调用方应反馈"activated 但无 tab-level 选择"。
 */
function buildGhosttyScript(): string {
  return `
tell application "Ghostty" to activate
tell application "System Events"
  if exists process "Ghostty" then
    set frontmost of process "Ghostty" to true
  end if
end tell
`;
}

function buildTerminalScript(tty: string | null): string {
  if (!tty) return `tell application "Terminal" to activate`;
  return `
tell application "Terminal"
  activate
  repeat with _w in windows
    repeat with _t in tabs of _w
      if (tty of _t) ends with "${tty}" then
        set selected of _t to true
        set frontmost of _w to true
        return
      end if
    end repeat
  end repeat
end tell
`;
}

/**
 * 用 spawn + array args 跑 osascript，避免 shell 转义问题。
 * 收集 stdout/stderr/exit code 返回，DEBUG 时输出到 console.error。
 */
function runOsa(
  script: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script]);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('exit', (code) => {
      const result = { exitCode: code ?? 0, stdout, stderr };
      if (DEBUG) {
        console.error('--- osascript ---');
        console.error(script);
        console.error('--- stdout ---');
        console.error(stdout || '(empty)');
        console.error('--- stderr ---');
        console.error(stderr || '(empty)');
        console.error(`--- exit ${code} ---`);
      }
      resolve(result);
    });
    child.on('error', (e) => {
      if (DEBUG) console.error('osa spawn error:', e);
      resolve({ exitCode: -1, stdout, stderr: String(e) });
    });
  });
}
