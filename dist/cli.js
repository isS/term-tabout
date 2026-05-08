#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { Dashboard } from './ui/Dashboard.js';
import { SessionManager } from './engine/watcher.js';
import { install, uninstall, MARK_BEGIN } from './utils/install.js';
import { teleportToSession } from './utils/terminal.js';
const cli = meow(`
  Usage
    $ term-tabout                    Launch the dashboard
    $ term-tabout --purge            Remove state files of dead PIDs and exit
    $ term-tabout --doctor           Diagnose collector hookup
    $ term-tabout --install          Preview the line to add to ~/.zshrc
    $ term-tabout --install --apply  Actually append it
    $ term-tabout --uninstall        Preview removal
    $ term-tabout --uninstall --apply  Actually remove it

  Options
    --home <dir>     state directory (default $TERM_TABOUT_DIR or ~/.term-tabout)
    --purge          purge stale state files and exit
    --doctor         print diagnostics and exit
    --install        append collector source line to ~/.zshrc (use --apply to commit)
    --uninstall      remove the previously installed block (use --apply to commit)
    --apply          actually write changes (with --install / --uninstall)
    --rc <path>      override rc file path (default ~/.zshrc)
    --teleport <pid> activate the window/tab of that PID and exit (debugging)
    --help, --version

  Env
    TERM_TABOUT_DEBUG=1   print AppleScript and stdout/stderr on every teleport

  Keys (in TUI)
    ↑↓        navigate row within group
    ←→        navigate group
    ⏎         teleport to session
    r / R     rename / reset title
    s         toggle save
    c         copy cwd to clipboard
    x         kill focused PID (sends SIGTERM)
    K         force-kill focused PID (sends SIGKILL)
    X         enter batch-kill mode (space toggle, ⏎ confirm)
    /         filter
    q / esc   quit
`, {
    importMeta: import.meta,
    flags: {
        home: { type: 'string' },
        purge: { type: 'boolean', default: false },
        doctor: { type: 'boolean', default: false },
        install: { type: 'boolean', default: false },
        uninstall: { type: 'boolean', default: false },
        apply: { type: 'boolean', default: false },
        rc: { type: 'string' },
        teleport: { type: 'string' },
    },
});
const home = cli.flags.home
    ? path.resolve(cli.flags.home)
    : process.env.TERM_TABOUT_DIR
        ? path.resolve(process.env.TERM_TABOUT_DIR)
        : path.join(os.homedir(), '.term-tabout');
if (cli.flags.purge) {
    const mgr = new SessionManager({ home });
    const n = await mgr.purgeStale();
    console.log(`purged ${n} stale state file${n === 1 ? '' : 's'}`);
    process.exit(0);
}
if (cli.flags.doctor) {
    await runDoctor(home);
    process.exit(0);
}
if (cli.flags.install) {
    await runInstall();
    process.exit(0);
}
if (cli.flags.uninstall) {
    await runUninstall();
    process.exit(0);
}
if (cli.flags.teleport) {
    await runTeleport(cli.flags.teleport);
    process.exit(0);
}
// Ink 5 需要 raw mode 才能保持 TUI 运行；非 TTY 时它会渲染一次然后立即返回，
// 用户体验是"启动一闪就退出"。提前显式拦下，给清晰错误。
if (!process.stdin.isTTY) {
    console.error('term-tabout: stdin is not a TTY. The interactive dashboard needs a real terminal.\n' +
        'If you are inside tmux/screen/multiplexer or piping, run it directly in a normal shell.\n' +
        'You can still use the non-interactive subcommands: --doctor / --purge / --teleport <pid>.');
    process.exit(2);
}
render(React.createElement(Dashboard, { home }));
async function runTeleport(pidStr) {
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0) {
        console.error(`--teleport requires a positive PID, got "${pidStr}"`);
        process.exit(1);
    }
    const mgr = new SessionManager({ home });
    const sessions = await mgr.getActiveSessions();
    const target = sessions.find((s) => s.pid === pid);
    if (!target) {
        console.error(`No session with PID ${pid} in ${home}/states`);
        console.error('Run `term-tabout --doctor` to list known sessions.');
        process.exit(1);
    }
    console.log(`Teleporting to PID ${pid}  (term: ${target.term}  cwd: ${target.cwd})`);
    const r = await teleportToSession(pid, target.term);
    console.log(`tty:        ${r.tty ?? '(unresolved)'}`);
    console.log(`exit code:  ${r.exitCode}`);
    if (r.stderr.trim())
        console.log(`stderr:     ${r.stderr.trim()}`);
    if (r.exitCode !== 0) {
        console.log();
        console.log('Tip: set TERM_TABOUT_DEBUG=1 to print the AppleScript that ran.');
        process.exit(2);
    }
}
async function runInstall() {
    const collectorPath = resolveCollectorPath();
    const result = await install({
        rcPath: cli.flags.rc,
        collectorPath,
        apply: cli.flags.apply,
    });
    if (result.alreadyInstalled) {
        console.log(`○ Already installed in ${result.rcPath}`);
        console.log(`  (look for the "${MARK_BEGIN}" block)`);
        console.log(`  Use --uninstall to remove.`);
        return;
    }
    if (result.applied) {
        console.log(`✓ Appended to ${result.rcPath}:`);
        console.log();
        console.log(indent(result.block));
        console.log();
        console.log('Open a NEW terminal and run `term-tabout --doctor` to verify.');
        return;
    }
    console.log(`Would append to ${result.rcPath}:`);
    console.log();
    console.log(indent(result.block));
    console.log();
    console.log('To actually apply, re-run with --apply.');
}
async function runUninstall() {
    const result = await uninstall({
        rcPath: cli.flags.rc,
        apply: cli.flags.apply,
    });
    if (!result.removed) {
        console.log(`○ No term-tabout block found in ${result.rcPath}`);
        return;
    }
    if (result.applied) {
        console.log(`✓ Removed term-tabout block from ${result.rcPath}`);
        return;
    }
    console.log(`Would remove the term-tabout block from ${result.rcPath}.`);
    console.log('To actually apply, re-run with --apply.');
}
function indent(s, pad = '    ') {
    return s
        .split('\n')
        .map((l) => pad + l)
        .join('\n');
}
async function runDoctor(rootDir) {
    console.log(`term-tabout doctor — ${rootDir}`);
    console.log();
    // 1. home dir
    try {
        await fs.access(rootDir);
        console.log(`  ✓ home dir exists`);
    }
    catch {
        console.log(`  ○ home dir missing — will be created on first collector run`);
    }
    // 2. state dir
    const stateDir = path.join(rootDir, 'states');
    let stateFiles = [];
    try {
        const entries = await fs.readdir(stateDir);
        stateFiles = entries.filter((e) => e.endsWith('.json'));
        console.log(`  ✓ state dir: ${stateFiles.length} session file(s)`);
    }
    catch {
        console.log(`  ○ state dir not created yet (collector hasn't run)`);
    }
    // 3. session details
    if (stateFiles.length > 0) {
        const mgr = new SessionManager({ home: rootDir });
        const sessions = await mgr.getActiveSessions();
        console.log();
        for (const s of sessions) {
            const tag = s.alive ? '✓ alive' : '✗ stale';
            console.log(`    ${tag}  PID ${s.pid}  ${s.term}  ${s.cwd}`);
        }
        const stale = sessions.filter((s) => !s.alive);
        if (stale.length) {
            console.log();
            console.log(`  ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'}. run with --purge to clean.`);
        }
    }
    else {
        console.log();
        console.log('  ⚠ No sessions detected.');
        console.log('  The collector likely isn\'t loaded in your shell.');
        console.log();
        const collectorPath = resolveCollectorPath();
        console.log('  Add this to ~/.zshrc and open a NEW terminal:');
        console.log();
        console.log(`    source ${collectorPath}`);
        console.log();
    }
    // 4. titles.json
    try {
        const raw = await fs.readFile(path.join(rootDir, 'titles.json'), 'utf-8');
        const obj = JSON.parse(raw);
        const n = obj && typeof obj === 'object' ? Object.keys(obj).length : 0;
        console.log(`  ✓ titles.json: ${n} renamed`);
    }
    catch {
        console.log(`  ○ titles.json: not yet created`);
    }
    // 5. saved.yaml
    try {
        const raw = await fs.readFile(path.join(rootDir, 'saved.yaml'), 'utf-8');
        const lines = raw
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#')).length;
        console.log(`  ✓ saved.yaml: ${lines} bookmark(s)`);
    }
    catch {
        console.log(`  ○ saved.yaml: not yet created`);
    }
}
/** dist/cli.js → ../src/collector/term-tabout.zsh */
function resolveCollectorPath() {
    const here = url.fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(here), '..');
    return path.join(projectRoot, 'src/collector/term-tabout.zsh');
}
