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
export declare function teleportToSession(pid: number, term: string): Promise<TeleportResult>;
export declare function copyToClipboard(text: string): Promise<void>;
export declare function killSession(pid: number, signal?: NodeJS.Signals): void;
/** ps -p PID -o tty= → "ttys010" 或 null */
export declare function getTtyForPid(pid: number): Promise<string | null>;
