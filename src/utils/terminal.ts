import { exec, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
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
/** 已知 GUI 终端（含 VS Code 嵌入式终端）→ AppleScript 应用名映射 */
const KNOWN_TERMS: Record<string, string> = {
  iterm: 'iTerm',
  'iterm.app': 'iTerm',
  apple_terminal: 'Terminal',
  terminal: 'Terminal',
  ghostty: 'Ghostty',
  wezterm: 'WezTerm',
  alacritty: 'Alacritty',
  warp: 'Warp',
  kitty: 'kitty',
  hyper: 'Hyper',
  tabby: 'Tabby',
  vscode: 'Visual Studio Code',
  'vscode-insiders': 'Visual Studio Code - Insiders',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
};

export async function teleportToSession(
  pid: number,
  term: string,
  cwd?: string,
  opts: { tabIndexHint?: number } = {}
): Promise<TeleportResult> {
  const t = (term || '').toLowerCase();
  const tty = await getTtyForPid(pid);

  // 拦下"明确不知道是什么终端"的情况：直接 spawn osascript 会触发 -1728
  // (`tell application "unknown" to activate`)，给出莫名其妙的 AppleScript 报错。
  // 在这里短路，让 toast 给用户更准确的诊断。
  if (!t || t === 'unknown') {
    return {
      tty,
      script: '',
      exitCode: -1,
      stdout: '',
      stderr:
        'TERM_PROGRAM was not set when this session was recorded — cannot teleport',
    };
  }
  if (!KNOWN_TERMS[t]) {
    const supported = [...new Set(Object.values(KNOWN_TERMS))].join(', ');
    return {
      tty,
      script: '',
      exitCode: -1,
      stdout: '',
      stderr: `unknown terminal "${term}". Known: ${supported}`,
    };
  }

  let script: string;
  if (t === 'iterm.app' || t === 'iterm') script = buildItermScript(tty);
  else if (t === 'apple_terminal' || t === 'terminal') script = buildTerminalScript(tty);
  else if (t === 'ghostty') script = buildGhosttyScript(cwd, opts.tabIndexHint);
  else {
    // wezterm / alacritty / warp / kitty / hyper / tabby — 仅 activate
    script = `tell application "${KNOWN_TERMS[t]}" to activate`;
  }
  const r = await runOsa(script);
  return { tty, script, ...r };
}

export async function copyToClipboard(text: string): Promise<void> {
  await clipboard.write(text);
}

export interface SetTitleResult {
  tty: string | null;
  ok: boolean;
  error?: string;
}

/**
 * 通过 OSC 0 序列把 tab/window 标题写到目标 PID 的 tty。
 *
 * 序列：ESC ] 0 ; <title> BEL  —— xterm OSC 0/2 兼容，iTerm / Terminal /
 * Ghostty / WezTerm / kitty / Alacritty 等绝大多数终端都吃。
 *
 * 注意这是"一次性"写入：如果用户的 zsh precmd 在每次回车时把 title 设回 cwd，
 * 我们写完很快就被覆盖。粘性靠 collector 在 chpwd/preexec 里复写来保。
 */
export async function setTtyTitle(
  pid: number,
  title: string
): Promise<SetTitleResult> {
  const tty = await getTtyForPid(pid);
  if (!tty) return { tty: null, ok: false, error: `cannot resolve tty for PID ${pid}` };
  // 移除控制字符（尤其 BEL/ESC，否则会截断或重新解析转义序列）
  const safe = title.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
  const seq = `\x1b]0;${safe}\x07`;
  const path = `/dev/${tty}`;
  try {
    await fs.appendFile(path, seq);
    return { tty, ok: true };
  } catch (e) {
    return { tty, ok: false, error: (e as Error).message };
  }
}

/**
 * Pull the current tab/session name from the terminal app via AppleScript.
 * Returns null if the term doesn't support reading it (Ghostty / VSCode / …),
 * if the tty can't be resolved, or if AppleScript fails.
 *
 * 用于把用户在终端原生 UI 里改的 tab title 回写到 titles.json（双向同步）。
 */
export async function getTabTitle(
  pid: number,
  term: string,
  cwd?: string
): Promise<string | null> {
  const t = (term || '').toLowerCase();
  let script: string;
  if (t === 'iterm.app' || t === 'iterm') {
    const tty = await getTtyForPid(pid);
    if (!tty) return null;
    script = `
tell application "iTerm"
  repeat with _w in windows
    repeat with _t in tabs of _w
      repeat with _s in sessions of _t
        if (tty of _s) ends with "${tty}" then
          return name of _s
        end if
      end repeat
    end repeat
  end repeat
  return ""
end tell
`;
  } else if (t === 'apple_terminal' || t === 'terminal') {
    // Terminal.app: custom title 是用户/OSC 设置的；name 是默认 (e.g. "bash")
    // 优先 custom title，空则回落到 name。
    const tty = await getTtyForPid(pid);
    if (!tty) return null;
    script = `
tell application "Terminal"
  repeat with _w in windows
    repeat with _t in tabs of _w
      if (tty of _t) ends with "${tty}" then
        set _ct to custom title of _t
        if _ct is "" then return name of _t
        return _ct
      end if
    end repeat
  end repeat
  return ""
end tell
`;
  } else if (t === 'ghostty') {
    // Ghostty 1.3+: tab 没有 tty 属性，但有 name + focused terminal.working directory，
    // 按 cwd 匹配；同 cwd 多 tab 取第一个（claude 写的 OSC 标题在所有同 tab 上常一致）。
    if (!cwd) return null;
    const safeCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    script = `
tell application "Ghostty"
  repeat with _w in windows
    repeat with _t in tabs of _w
      try
        if (working directory of focused terminal of _t) is "${safeCwd}" then
          return name of _t
        end if
      end try
    end repeat
  end repeat
  return ""
end tell
`;
  } else {
    // VSCode / WezTerm / kitty / … 没有可靠的 AppleScript API
    return null;
  }
  const r = await runOsa(script);
  if (r.exitCode !== 0) return null;
  const name = r.stdout.trim();
  return name || null;
}

/**
 * 批量读 Ghostty 所有 tab 的 (window/tab index, cwd, name)。
 *
 * Ghostty 1.3+ 的 tab 没有 tty / PID 属性，按 cwd 单点匹配会让"同 cwd 的多个
 * shell 都拿到 tab 1 的 name"（已实测验证）。所以读完所有 tab，让调用方
 * （server.ts /api/pull-titles）按 startedAt 顺序与 PID 配对。
 *
 * 返回空数组表示 Ghostty 未运行或 AppleScript 失败。
 */
export async function getGhosttyTabs(): Promise<
  Array<{ windowIndex: number; tabIndex: number; cwd: string; name: string }>
> {
  // _sep = ASCII char 9（即 \t）。直接用 AppleScript 的 `tab` 关键字会与
  // window 子元素 `tab` 冲突 —— 实测整脚本会被解释错、返回空字符串。
  const script = `
set _sep to ASCII character 9
set _out to ""
tell application "Ghostty"
  set _wi to 0
  repeat with _w in windows
    set _wi to _wi + 1
    repeat with _tab in tabs of _w
      try
        set _cwd to working directory of focused terminal of _tab
        set _name to name of _tab
        set _idx to index of _tab
        set _out to _out & _wi & _sep & _idx & _sep & _cwd & _sep & _name & linefeed
      end try
    end repeat
  end repeat
end tell
return _out
`;
  const r = await runOsa(script);
  if (r.exitCode !== 0) return [];
  const tabs: Array<{ windowIndex: number; tabIndex: number; cwd: string; name: string }> = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [wi, ti, cwd, ...nameParts] = parts;
    tabs.push({
      windowIndex: Number(wi),
      tabIndex: Number(ti),
      cwd,
      name: nameParts.join('\t'),
    });
  }
  return tabs;
}

export function killSession(
  pid: number,
  signal: NodeJS.Signals = 'SIGHUP'
): void {
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH = 已死，忽略
  }
}

/**
 * "Close this terminal tab" — 对应 UI 上的 ✕ 按钮。
 *
 * 流程：
 *   1. SIGHUP（zsh 收到 hangup 会清场退出 → 终端模拟器默认会关闭 tab）。
 *      不是 SIGTERM —— interactive zsh 默认 trap SIGTERM，发它没用。
 *   2. 短暂等待让 shell 跑 zshexit。
 *   3. 还活着就 SIGKILL 兜底。
 *
 * 返回每一步的结果，便于 UI toast 显示发生了什么。
 */
export async function closeSession(
  pid: number
): Promise<{ signaled: NodeJS.Signals[]; alive: boolean }> {
  const signaled: NodeJS.Signals[] = [];
  let alive = isAlive(pid);
  if (!alive) return { signaled, alive: false };

  try {
    process.kill(pid, 'SIGHUP');
    signaled.push('SIGHUP');
  } catch {
    // ESRCH = 已死
    return { signaled, alive: false };
  }

  await new Promise((r) => setTimeout(r, 400));
  alive = isAlive(pid);
  if (!alive) return { signaled, alive: false };

  try {
    process.kill(pid, 'SIGKILL');
    signaled.push('SIGKILL');
  } catch {
    // 期间死了
  }
  await new Promise((r) => setTimeout(r, 150));
  return { signaled, alive: isAlive(pid) };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
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
  // iTerm AppleScript 方言：`select theSession` 会自动把 session 所在的 tab +
  // window 一起激活。最早写的 `set current tab to ...` 是 Terminal.app 方言，
  // iTerm 直接抛 -10000 (AppleEvent handler failed)。
  // session.tty 形如 "/dev/ttys010"，用 ends with 兜底前缀差异。
  return `
tell application "iTerm"
  activate
  repeat with _w in windows
    repeat with _t in tabs of _w
      repeat with _s in sessions of _t
        if (tty of _s) ends with "${tty}" then
          select _s
          return
        end if
      end repeat
    end repeat
  end repeat
end tell
`;
}

/**
 * Ghostty 1.3+ 有部分 AppleScript：window/tab 列表可读，但
 * `selected tab` 是只读，没法直接 set。曲线方案：
 *   1. 通过 cwd 匹配定位目标 tab 的 `index` 属性
 *   2. activate Ghostty
 *   3. 通过 System Events 发 `Cmd+<index>` —— Ghostty 默认绑定 super+1..8 = goto_tab:N
 *
 * 没有 cwd（老调用方/未传参）则退化为只 activate 应用。
 *
 * macOS 辅助功能权限要求：System Events 发送按键需要 osascript（或更上游的
 * 父进程，比如 node / Terminal）在"系统设置 → 隐私与安全性 → 辅助功能"被授权。
 * 未授权会得到 -1719/-1728 错误，UI 会把 stderr 显示到 toast。
 */
function buildGhosttyScript(cwd?: string, tabIndexHint?: number): string {
  // 优先用 server 算好的 tabIndexHint —— 这是修同 cwd 多 PID 都跳同一个 tab 的关键。
  // server.ts /api/teleport 知道全局 session 列表，能算出"目标 PID 对应同 cwd 第 N
  // 个 ghostty tab"，传 tabIndex 进来后 AppleScript 直接切，不再按 cwd 单点匹配。
  if (typeof tabIndexHint === 'number' && tabIndexHint > 0) {
    return `
tell application "Ghostty" to activate
tell application "System Events"
  if not (exists process "Ghostty") then return "ghostty: process not found"
  set frontmost of process "Ghostty" to true
  if ${tabIndexHint} <= 8 then
    keystroke ("${tabIndexHint}") using command down
  else
    keystroke "1" using command down
    delay 0.05
    repeat ${tabIndexHint - 1} times
      key code 48 using control down
      delay 0.02
    end repeat
  end if
end tell
return "ghostty: switched to tab ${tabIndexHint} (hint)"
`;
  }
  if (!cwd) {
    return `
tell application "Ghostty" to activate
tell application "System Events"
  if exists process "Ghostty" then
    set frontmost of process "Ghostty" to true
  end if
end tell
`;
  }
  // AppleScript string-escape cwd（双引号、反斜杠）
  const safeCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `
set targetIndex to -1
tell application "Ghostty"
  activate
  repeat with _w in windows
    repeat with _t in tabs of _w
      try
        if (working directory of focused terminal of _t) is "${safeCwd}" then
          set targetIndex to index of _t
          exit repeat
        end if
      end try
    end repeat
    if targetIndex is not -1 then exit repeat
  end repeat
end tell
if targetIndex is -1 then
  return "ghostty: no tab matching cwd"
end if
tell application "System Events"
  if not (exists process "Ghostty") then return "ghostty: process not found"
  set frontmost of process "Ghostty" to true
  if targetIndex <= 8 then
    -- super+1..8 = goto_tab:N
    keystroke (targetIndex as string) using command down
  else
    -- 先 super+1 跳首，再 ctrl+tab (next_tab) 走 targetIndex-1 次
    keystroke "1" using command down
    delay 0.05
    set _step to targetIndex - 1
    repeat _step times
      key code 48 using control down  -- key code 48 = Tab
      delay 0.02
    end repeat
  end if
end tell
return "ghostty: switched to tab " & targetIndex
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
