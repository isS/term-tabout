# term-tabout Design Specification

**Status:** Approved
**Date:** 2026-04-30
**Topic:** Terminal Tab Visualization and Management CLI

## 1. Overview
`term-tabout` is a system-level terminal tab visualization and management tool for macOS. It provides a Bento Grid-style dashboard (similar to the `tab-out` browser extension) to visualize, manage, and navigate between active terminal sessions across different terminal emulators (iTerm2, Ghostty, etc.).

## 2. Architecture
The system uses a decoupled architecture with a shell-based collector and a React Ink-based UI.

### 2.1 Collector (Shell Plugin)
- **Language:** Zsh/Fish shell scripts.
- **Hooks:** `chpwd` (directory change) and `preexec` (before command execution).
- **Function:** Captures session metadata and writes it to `~/.term-tabout/states/{PID}.json`.
- **Metadata Captured:**
    - PID, PPID
    - Current Working Directory (CWD)
    - Terminal Program (`$TERM_PROGRAM`)
    - Last executed command
    - Timestamp

### 2.2 Storage
- **Active States:** `~/.term-tabout/states/*.json` (one file per active shell session).
- **Persistent Sessions:** `~/.term-tabout/saved.yaml` (user-selected bookmarks).

### 2.3 UI (React Ink)
- **Tech Stack:** Node.js, React, Ink.
- **Layout:** Responsive Bento Grid.
- **Features:** 
    - Real-time updates via `fs.watch`.
    - Stale process detection: Manual cleanup only (no auto-purge) to allow manual verification.
    - Terminal-specific visual branding (colors/icons).
    - **Filtering:** Heavy dimming/overlay effect on non-matching items to maintain layout stability while focusing on matches.
    - **Header:** Optional system info display (CPU/Memory load) with a toggle switch.


### 2.4 Terminal App Badge (`row-ico`) — Frozen

Each session row leads with a 20×20 rounded square (`.row-ico`) whose glyph **mirrors that terminal app's own application icon**, not an arbitrary 2-letter abbreviation. This anchors our UI to the real-world brands users already recognize.

| App | Glyph | Foreground | Background | Glyph source |
| :--- | :--- | :--- | :--- | :--- |
| iTerm2 | `$\|` | `#5cff8a` phosphor green | `#0f1014` near-black | iTerm2's `AppIcon.png` is literally `$\|` green-on-black |
| Terminal.app | `>_` | `#f0f0f2` off-white | `#0f1014` | macOS Terminal.app icon is `>_` white-on-black |
| Ghostty | `👻` | emoji (native color) | `rgba(198,120,221,.14)` purple tint | Ghostty's logo is literally a ghost |
| _(unknown)_ | first 2 chars of `$TERM_PROGRAM` | `var(--text)` | `rgba(92,99,112,.20)` neutral gray | fallback |

**Rules — do not deviate without revisiting this spec:**
1. The glyph is the app icon's own visual identity. Never substitute an "expressive" emoji that the icon doesn't actually use.
2. Adding a new app: only adopt a custom glyph when that app's icon has a recognizable single/double-character signature (e.g., Kitty → 🐱, Warp → ⚡). Otherwise fall back to the 2-letter `$TERM_PROGRAM` rule above.
3. Every badge must carry a `title` attribute with the full app name (and version, when available) for tooltip + accessibility.
4. Reference rendering and exact CSS: `docs/preview.html` (`.row-ico.{iterm,terminal,ghostty}`).

## 3. Interaction Design
| Action | Key | Description |
| :--- | :--- | :--- |
| **Navigate** | `↑ ↓ ← →` | Move focus between cards. |
| **Teleport** | `Enter` | Activate the terminal window/tab (via AppleScript if supported). |
| **Kill** | `x` | Terminate the process associated with the tab. |
| **Copy** | `c` | Copy the CWD to the system clipboard. |
| **Save** | `s` | Save the path to `saved.yaml`. |
| **Filter** | `/` | Real-time fuzzy search by project name or command. |
| **Quit** | `q` / `Esc` | Close the CLI. |

## 4. Implementation Roadmap
1. **Phase 1: Collector Development** - Create shell hooks and state file logic.
2. **Phase 2: CLI Core** - Build the Node.js skeleton and file watcher.
3. **Phase 3: UI Implementation** - Build the Bento Grid components using Ink.
4. **Phase 4: Integration** - Implement AppleScript for terminal teleportation and clipboard support.
5. **Phase 5: Refinement** - Polish animations, colors, and error handling.
