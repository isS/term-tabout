# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**MVP feature-complete. Build + typecheck clean. Manual UX validation pending.**

Full source tree (~1.1k LOC):
```
src/
├── cli.ts                         # meow entry, --purge subcommand, render Dashboard
├── types.ts                       # zod SessionSchema + SessionWithMeta
├── collector/
│   ├── term-tabout.zsh            # chpwd/preexec/zshexit hooks, atomic JSON write
│   └── term-tabout.fish           # fish equivalent
├── engine/
│   └── watcher.ts                 # SessionManager: chokidar watch, isAlive probe, purgeStale, titles+saved load
├── ui/
│   ├── Dashboard.tsx              # focus model, normal/filter/rename modes, key bindings
│   ├── SessionGroup.tsx           # group card: head pills + ASCII divider + rows
│   └── SessionRow.tsx             # term tag, title (manual ✎ marker), cwd, ❯ cmd, started/running/last meta
└── utils/
    ├── format.ts                  # formatStartedAt / formatDuration / formatRelative / tildify
    ├── groups.ts                  # cwd → group key, oldestStartedAt, duplicateCwds
    ├── terminal.ts                # AppleScript teleport, clipboardy copy, kill via process.kill
    └── titles.ts                  # JsonTitlesStore: load/get/set/delete with atomic write
```

Verified:
- collector smoke: `startedAt` preserved across records · JSON escape safe · Node parses
- vitest suite: 32/32 (format / groups / titles)
- integration: dead PID → `--purge` removes; alive PID retained
- `--doctor`: tested against both empty-home and mixed-stale scenarios
- `npm run typecheck` / `npm run build` clean

Not yet validated (needs a real TTY):
- The TUI itself — keyboard navigation, rename inline-edit, filter, teleport, save/copy, batch-kill mode

## CLI Subcommands

| Command | Purpose |
| :-- | :-- |
| `term-tabout` | Launch dashboard (default) |
| `term-tabout --purge` | Remove state files of dead PIDs and exit |
| `term-tabout --doctor` | Print diagnostics — checks ~/.term-tabout dirs, lists sessions with alive/stale tags, prints the exact `source` line for ~/.zshrc when no sessions detected |
| `term-tabout --install` / `--install --apply` | Append the collector `source` line to ~/.zshrc, wrapped in a `# >>> term-tabout collector` marker block. Default is dry-run; `--apply` actually writes. Idempotent — second run detects the existing block and refuses to duplicate. |
| `term-tabout --uninstall` / `--uninstall --apply` | Remove the marker block from ~/.zshrc |
| `term-tabout --rc <path>` | Override the rc file path (default ~/.zshrc) |
| `term-tabout --teleport <pid>` | Activate the window/tab of a single PID and exit. Combine with `TERM_TABOUT_DEBUG=1` to dump the AppleScript + osascript stdout/stderr — designed for iterating on per-emulator scripts. |
| `term-tabout --home <dir>` | Override $TERM_TABOUT_DIR |

Run `term-tabout --install --apply` once to wire the collector into ~/.zshrc; the binary is exposed globally via `npm link` (build script chmods `dist/cli.js`).

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

5-second TTL cache (branches change rarely). Watcher attaches `branch` to every `SessionWithMeta`; `groups.ts` lifts it to the group (`branch` field of `SessionGroup`); `SessionGroup.tsx` renders `[branch]` in magenta next to the group name.

## Teleport Implementation

`utils/terminal.ts::teleportToSession`:
1. `ps -p PID -o tty=` → `ttys010`
2. iTerm: AppleScript walks `windows → tabs → sessions`, matches `tty of session ends with "ttys010"`, then `set current tab` + `select`
3. Terminal.app: same shape, walks `windows → tabs`
4. Ghostty: only `activate` the app (no AppleScript window/tab API as of 1.x)
5. Unknown term: best-effort `tell application "<term>" to activate`

The PID-to-tty mapping is the precise hook — without it teleport degrades to "activate the app" only.

Source of truth:
- Design spec: `docs/superpowers/specs/2026-04-30-term-tabout-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-30-term-tabout.md`
- **UI visual contract: `docs/preview.html`** (open in browser) — supersedes the spec's brief Bento mention

The plan was authored before the visual was finalized; preview.html embodies the agreed direction (One Dark theme, tab-out-style group/row layout, title rename, three time axes — started/running/last, lightweight kill).

## What `term-tabout` Is

A macOS CLI that renders a Bento Grid dashboard of active terminal sessions across emulators (iTerm2, Ghostty, …), with navigation, teleport-to-tab, kill, and bookmark capabilities. Inspired by the `tab-out` browser extension.

## Architecture (Decoupled Collector → State Files → UI)

The two halves communicate **only** through the filesystem at `~/.term-tabout/`. Keep this boundary clean — the UI must never call into shell hooks, and the collector must never depend on Node.

1. **Collector** — `src/collector/term-tabout.{zsh,fish}`
   - Hooks `chpwd` and `preexec` to write `~/.term-tabout/states/{PID}.json` on every directory change or command.
   - Atomic write: temp file + `mv -f` to avoid the UI reading half-written JSON.
   - Captures: `pid`, `cwd`, `term` (`$TERM_PROGRAM`), `lastCmd`, **`startedAt`** (first record only, never overwritten), `updatedAt` (every record).

2. **State storage** — `~/.term-tabout/`
   - `states/*.json` — live sessions, one file per shell PID.
   - `saved.yaml` — user-bookmarked cwds (one per line; `s` keybinding writes here).
   - `titles.json` — `{ [cwd]: title }`. UI writes (via `r` rename); collector never reads.

3. **UI** — Node.js + TypeScript + React Ink
   - `chokidar` watches `states/`; `zod` parses JSON into `Session` objects.
   - **Stale cleanup is the UI's job, not the collector's.** zshexit fires only on clean interactive exit; UI's `SessionManager.purgeStale()` is the authoritative path — `process.kill(pid, 0)` probes liveness, dead PIDs get unlinked.
   - Teleport uses AppleScript via `osascript` (per-emulator branching on `session.term`).
   - Sessions are grouped client-side by `cwd` top-level directory (see `utils/groups.ts`); same-cwd duplicates surface as `(N× same cwd)` badge.

## Tech Stack & Key Dependencies

Node.js, TypeScript, React 18, Ink 5, `chokidar`, `zod`, `meow` (CLI args), `clipboardy`, `yaml`, `chalk`. AppleScript for window activation. Exact versions are pinned in the `package.json` snippet inside the implementation plan — use those when scaffolding.

## Build & Run (once scaffolded)

Per the plan's `package.json`:
- `npm run build` — `tsc` to `dist/`
- `npm run dev` — `tsc -w` (watch mode)
- `npm start` — `node dist/cli.js`
- Binary entry: `dist/cli.js` (exposed as the `term-tabout` bin)

No test runner is specified yet; if you add one, update this section.

## Keybindings (UI Contract)

`↑↓` row · `←→` group · `⏎` teleport · `r` rename / `R` reset title · `s` save · `c` copy cwd · `/` filter · `x` kill (focused only) · `X` enter batch-kill mode · `q`/`Esc` quit.

`x` is intentionally the only kill key in normal mode — no batch buttons in the UI (see preview.html "Kill 视觉降权"). Batch kill requires explicit `X` mode + multi-select + confirm.

## Mockup-Driven Design

`docs/preview.html` is a self-contained HTML mock of the TUI in three states (main / filter / row anatomy). When implementing UI components, refer to it as the visual ground truth — it has the exact One Dark color tokens, group/row anatomy, time labels, and the renaming inline-edit pattern.
