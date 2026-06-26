# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Web UI shipped. Build + typecheck clean. 46/46 vitest pass.**

The Ink TUI was scrapped in favor of a local web dashboard. The CLI now boots an HTTP server on a random port (or `--port <n>`), auto-opens the browser (or `--no-open`), and renders the UI as a vanilla-JS single-file app at `src/web/index.html`. The page subscribes to `/api/events` via SSE for live updates and calls JSON endpoints (`/api/rename`, `/api/teleport`, `/api/forget`, …) for actions.

Source tree:

```
src/
├── cli.ts                         # meow entry → startServer(); subcommands --purge / --doctor / --install / --teleport / --set-title
├── types.ts                       # zod SessionSchema + SessionWithMeta
├── collector/
│   ├── term-tabout.zsh            # chpwd / preexec hooks, atomic JSON write
│   └── term-tabout.fish           # fish equivalent
├── engine/
│   └── watcher.ts                 # SessionManager: chokidar watch, isAlive probe, purgeStale, forgetPid (force-aware)
├── server/
│   └── server.ts                  # node:http server: JSON API, SSE stream, static serve from dist/web
├── utils/
│   ├── groups.ts                  # cwd → group key, oldestStartedAt, duplicateCwds
│   ├── install.ts                 # ~/.zshrc marker-block append/remove
│   ├── repo.ts                    # findRepoRootSync + getBranchSync (reads .git/HEAD directly)
│   ├── terminal.ts                # AppleScript teleport, setTtyTitle (OSC 0 via fs.appendFile /dev/tty), clipboardy copy, kill
│   └── titles.ts                  # JsonTitlesStore: PID-keyed (not cwd-keyed), atomic write, pruneDead
└── web/
    └── index.html                 # the entire UI: One Dark CSS + vanilla JS + SSE client, copied to dist/web at build
```

Verified (this session):
- `npm run build` clean
- `npx vitest run` → 46/46 passing (groups / install / repo / titles)
- end-to-end with curl: `/api/sessions`, `/api/events` (SSE), `/api/rename` (writes titles.json + OSC), `/api/forget` (404/409/200 paths), `/api/forget` with `force:true`, `/api/purge-stale`
- iTerm teleport: AppleScript uses `select _s` (not Terminal.app's `set current tab to`) — switches tab + window in one op

## What `term-tabout` Is

A macOS CLI that launches a local web dashboard of every active shell across terminal emulators (iTerm2, Ghostty, Terminal.app, even VSCode integrated terminals). Click a row to teleport to that tab, rename it (writes back to the actual terminal title via OSC 0), bookmark its cwd, or forget stale rows. Inspired by the `tab-out` browser extension.

## Architecture (Decoupled Collector → State Files → Web UI)

The two halves communicate **only** through the filesystem at `~/.term-tabout/`. Keep this boundary clean — the UI must never call into shell hooks, and the collector must never depend on Node.

1. **Collector** — `src/collector/term-tabout.{zsh,fish}`
   - Hooks `chpwd` and `preexec` to write `~/.term-tabout/states/{PID}.json` on every directory change or command.
   - Atomic write: temp file + `mv -f` to avoid the UI reading half-written JSON.
   - Captures: `pid`, `cwd`, `term` (`$TERM_PROGRAM`), `lastCmd`, **`startedAt`** (first record only, never overwritten), `updatedAt` (every record).

2. **State storage** — `~/.term-tabout/`
   - `states/*.json` — live sessions, one file per shell PID.
   - `saved.yaml` — user-bookmarked cwds (one per line; `s` keybinding writes here).
   - `titles.json` — `{ [pid]: title }` (PID-keyed, not cwd-keyed — same-cwd shells must rename independently). UI writes; collector never reads.

3. **Server + Web UI** — `src/server/server.ts` + `src/web/index.html`
   - `chokidar` watches `states/`; `zod` parses JSON into `Session` objects (`engine/watcher.ts`).
   - **Stale cleanup is the UI's job, not the collector's.** `zshexit` fires only on clean interactive exit; `SessionManager.purgeStale()` is the authoritative path — `process.kill(pid, 0)` probes liveness, dead PIDs get unlinked. `forgetPid(pid, {force})` removes a single state file (UI escape hatch for the VSCode-alive-but-unreachable case).
   - Teleport uses AppleScript via `osascript` (per-emulator branching on `session.term`).
   - Sessions are grouped server-side by repoRoot/cwd top-level (see `utils/groups.ts`); same-cwd duplicates surface as `(N× same cwd)` badge.
   - SSE pushes a fresh `{groups, totals}` payload on every watcher fire; the web client patches the DOM and preserves in-flight rename input across rerenders.

## CLI Subcommands

| Command | Purpose |
| :-- | :-- |
| `term-tabout` | Launch web server, auto-open browser |
| `term-tabout --port <n>` | Bind to a specific port (default 0 = random) |
| `term-tabout --no-open` | Don't auto-open browser |
| `term-tabout --purge` | Remove state files of dead PIDs and exit |
| `term-tabout --doctor` | Print diagnostics — checks ~/.term-tabout dirs, lists sessions with alive/stale tags, prints the exact `source` line for ~/.zshrc when no sessions detected |
| `term-tabout --install` / `--install --apply` | Append the collector `source` line to ~/.zshrc, wrapped in a `# >>> term-tabout collector` marker block. Default is dry-run; `--apply` actually writes. Idempotent — second run detects the existing block and refuses to duplicate. |
| `term-tabout --uninstall` / `--uninstall --apply` | Remove the marker block from ~/.zshrc |
| `term-tabout --rc <path>` | Override the rc file path (default ~/.zshrc) |
| `term-tabout --teleport <pid>` | Activate the window/tab of a single PID and exit (debugging). `TERM_TABOUT_DEBUG=1` dumps the AppleScript + osascript stdout/stderr. |
| `term-tabout --set-title <pid>=<title>` | Write OSC 0 to that PID's tty and exit (debugging the rename → tab-title sync). |
| `term-tabout --home <dir>` | Override `$TERM_TABOUT_DIR` |

Run `term-tabout --install --apply` once to wire the collector into ~/.zshrc; the binary is exposed globally via `npm link` (build script chmods `dist/cli.js`).

## HTTP API

All POST bodies are JSON; responses are JSON unless noted.

| Endpoint | Body | Effect |
| :-- | :-- | :-- |
| `GET /api/sessions` | — | Snapshot `{groups, totals}` |
| `GET /api/events` | — | SSE stream; sends `event: sessions` on watcher fires |
| `POST /api/rename` | `{pid, title}` | `titles.json[pid] = title` + writes OSC 0 to that PID's tty |
| `POST /api/reset-title` | `{pid}` | Drops the title entry |
| `POST /api/teleport` | `{pid}` | AppleScript activate (iTerm/Terminal.app/Ghostty/…) |
| `POST /api/kill` | `{pid, signal?}` | `process.kill(pid, signal)` (default SIGTERM) |
| `POST /api/forget` | `{pid, force?}` | Delete state file. Rejects with `409 {removed:false, reason:'pid is still alive'}` unless `force:true`. |
| `POST /api/purge-stale` | `{}` | Bulk forget all dead PIDs (same as `--purge`) |
| `POST /api/save` | `{cwd, saved}` | Toggle `saved.yaml` membership |
| `POST /api/copy` | `{text}` | `clipboardy` fallback (browser-side prefers `navigator.clipboard`) |

## Grouping Strategy

`utils/groups.ts::deriveGroupKey` — fallback chain:
1. **`session.repoRoot`** (set by `findRepoRootSync` in `utils/repo.ts`, walks up looking for `.git`) → `basename(repoRoot)`. This is what makes `~/project/foo`, `~/project/foo/server`, `~/project/foo/etl` all coalesce into one "foo" group.
2. cwd 2nd-level under home (`~/{a}/{b}/*` → `b`)
3. cwd 1st-level (`~/X` → `X`)
4. cwd === home → `Home`
5. outside home → `basename(cwd)`

`findRepoRootSync` is `fs.statSync` based and uses an in-process cache keyed by cwd. Watcher's `attach` is a hot path (every state change triggers a re-scan), so sync + cache is the right tradeoff over async fs.

## Branch Detection

`utils/repo.ts::getBranchSync(repoRoot)` reads `.git/HEAD` directly — no `git` binary required:
- `ref: refs/heads/<name>` → `<name>` (handles `feature/foo` slashes)
- 40-hex sha (detached HEAD) → 7-char short sha
- worktree pointer (`.git` is a file): follows `gitdir:` to the real `.git` dir, then re-reads HEAD

5-second TTL cache (branches change rarely). Watcher attaches `branch` to every `SessionWithMeta`; `groups.ts` lifts it to the group (`branch` field of `SessionGroup`); the web UI renders it as a `<span class="group-pill branch">` next to the group name.

## Teleport Implementation

`utils/terminal.ts::teleportToSession`:
1. `ps -p PID -o tty=` → `ttys010`
2. **iTerm**: AppleScript walks `windows → tabs → sessions`, matches `tty of session ends with "ttys010"`, then `select _s` (iTerm's own idiom — brings session + tab + window forward in one op). Using Terminal.app's `set current tab to _t` against iTerm throws `errAEEventNotHandled (-10000)`.
3. **Terminal.app**: same shape, walks `windows → tabs`, uses `set frontmost of _w to true` + `set selected tab of _w to _t`.
4. **Ghostty**: only `activate` the app (no AppleScript window/tab API as of 1.x).
5. **VSCode**: the web UI declines to teleport — VSCode integrated terminals aren't reachable via AppleScript window/tab APIs.
6. Unknown term: best-effort `tell application "<term>" to activate`.

The PID-to-tty mapping is the precise hook — without it teleport degrades to "activate the app" only. `TERM_TABOUT_DEBUG=1` prints the generated AppleScript before running.

## Title Sync (UI rename → terminal tab)

`POST /api/rename` does two things in one shot:
1. `JsonTitlesStore.set(pid, title)` — persistent rename.
2. `setTtyTitle(pid, title)` — resolves the PID's tty via `ps -p PID -o tty=`, then writes `\x1b]0;<title>\x07` to `/dev/<tty>` via `fs.appendFile`. Sanitizes control chars + clamps to 200 chars.

This makes the rename immediately visible in the actual terminal tab (iTerm/Terminal.app/Ghostty all honor OSC 0). It does **not** survive the next shell prompt unless the shell's prompt itself respects the OSC — most defaults override it on every `precmd`.

`titles.json` is **PID-keyed** (`{ "12345": "..."}`), not cwd-keyed. Two shells in the same directory must rename independently; an earlier cwd-keyed implementation made them collide. `pruneDead(alivePids)` drops entries whose PID no longer exists.

## VSCode Integrated Terminals

The collector runs inside VSCode's integrated terminals too (zsh hooks fire normally), so they show up as sessions. The web UI:
- Tags them with `⌥` icon + `VSCODE` badge after the cwd.
- Blocks `⏎` / double-click teleport with a toast (`teleport unsupported for vscode`).
- Routes `x` / ✕ to a confirm dialog offering **force-forget** instead of kill, since kill on a VSCode shell either does nothing (VSCode respawns) or only kills one of N panes.

`POST /api/forget` accepts an optional `force: true` flag for this exact case — it bypasses the alive check.

## Build & Run

- `npm run build` — `tsc` to `dist/`, then `rm -rf dist/web && cp -R src/web dist/web` (the wipe-first matters: a plain `cp -R src/web dist/web` with an existing dir creates `dist/web/web/`), then chmod `dist/cli.js`.
- `npm run dev` — `tsc -w`
- `npm start` — `node dist/cli.js`
- `npm test` — `vitest run` (full suite). Single file: `npx vitest run src/utils/groups.test.ts`. Single test by name: `npx vitest run -t "deriveGroupKey"`. Watch mode: `npm run test:watch`.
- `npm run typecheck` — `tsc --noEmit` (type-check without emitting)
- Binary entry: `dist/cli.js` (exposed as the `term-tabout` bin)

## Keybindings (Web UI)

`↑↓` / `j k` row · `←→` / `h l` group · `⏎` teleport · `r` rename inline · `R` reset title · `s` save cwd · `c` copy cwd · `/` filter · `x` kill (alive) / forget (stale) · `Esc` clear focus / close filter.

Click row to focus; double-click to teleport. Action buttons (`✎ ★ ⧉ ✕/🗑`) appear on hover/focus. Stale rows hide the rename button (writing OSC to a dead tty is pointless) and block `⏎` / `r`.

## Mockup-Driven Design

`docs/preview.html` is the original self-contained HTML mock — kept as the visual ground truth (One Dark tokens, group/row anatomy, time labels, rename inline-edit pattern, terminal-icon glyphs). The live UI lives at `src/web/index.html` and has diverged in a few places: column-flow masonry (instead of Grid) to avoid empty-row gaps, force-forget escape hatch, VSCode tagging.

## Source of Truth

- Design spec: `docs/superpowers/specs/2026-04-30-term-tabout-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-30-term-tabout.md` (authored for the original Ink TUI; treat the web pivot as a superseding decision)
- UI visual contract: `docs/preview.html`
