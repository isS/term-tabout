# Term-Tabout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS terminal tab visualization tool with a React Ink dashboard and shell-based session tracking.

**Architecture:** A Zsh/Fish collector writes session metadata to JSON files in `~/.term-tabout/states/`. A Node.js CLI with React Ink watches this directory and renders a Bento Grid-style UI with process management and navigation capabilities.

**Tech Stack:** Node.js, TypeScript, React, Ink, Zsh, AppleScript.

---

## Recent Updates

- **2026-05-08** — Spec §2.4 "Terminal App Badge (`row-ico`) — Frozen" added. Three apps' glyphs locked to mirror their real `AppIcon`: iTerm2 `$|` (green-on-black), Terminal.app `>_` (white-on-black), Ghostty `👻` (purple tint). Reference rendering and frozen CSS live in `docs/preview.html` (`.row-ico.{iterm,terminal,ghostty}`). Rule: glyph = real icon's signature, never an arbitrary expressive emoji. Task 3 SessionCard implementation must follow this enum mapping.
- _Note for next session: dead `.term-tag` CSS in `preview.html` (lines ~359-368) is unused — flagged for cleanup decision later, not deleted._

---

### Task 1: Project Scaffolding & Collector Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/collector/term-tabout.zsh`
- Create: `src/collector/term-tabout.fish`

- [ ] **Step 1: Initialize package.json**
```json
{
  "name": "term-tabout",
  "version": "0.1.0",
  "bin": {
    "term-tabout": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/cli.js",
    "dev": "tsc -w"
  },
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.2.0",
    "zod": "^3.22.0",
    "chokidar": "^3.5.3",
    "chalk": "^4.1.2",
    "meow": "^9.0.0",
    "clipboardy": "^3.0.0",
    "yaml": "^2.3.4"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create Zsh Collector**
```bash
# src/collector/term-tabout.zsh
_term_tabout_record() {
  local state_dir="$HOME/.term-tabout/states"
  mkdir -p "$state_dir"
  local pid=$$
  local cwd=$(pwd)
  local cmd=$1
  local term=$TERM_PROGRAM
  
  cat <<EOF > "$state_dir/$pid.json"
{
  "pid": $pid,
  "cwd": "$cwd",
  "term": "$term",
  "lastCmd": "${cmd:-"idle"}",
  "updatedAt": $(date +%s)000
}
EOF
}

autoload -Uz add-zsh-hook
add-zsh-hook chpwd _term_tabout_record
preexec_functions+=(_term_tabout_record)
```

- [ ] **Step 3: Commit**
```bash
git add package.json src/collector/term-tabout.zsh
git commit -m "chore: initial scaffold and zsh collector"
```

### Task 2: Core Data Engine & Watcher

**Files:**
- Create: `src/types.ts`
- Create: `src/engine/watcher.ts`

- [ ] **Step 1: Define Session Types**
```typescript
import { z } from 'zod';

export const SessionSchema = z.object({
  pid: z.number(),
  cwd: z.string(),
  term: z.string().optional(),
  lastCmd: z.string().optional(),
  updatedAt: z.number()
});

export type Session = z.infer<typeof SessionSchema>;
```

- [ ] **Step 2: Implement File Watcher**
```typescript
import chokidar from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import { SessionSchema, Session } from '../types';

export class SessionManager {
  private stateDir = path.join(process.env.HOME!, '.term-tabout/states');
  
  async getActiveSessions(): Promise<Session[]> {
    const files = await fs.readdir(this.stateDir);
    const sessions = await Promise.all(
      files.map(async (f) => {
        try {
          const content = await fs.readFile(path.join(this.stateDir, f), 'utf-8');
          return SessionSchema.parse(JSON.parse(content));
        } catch {
          return null;
        }
      })
    );
    return sessions.filter((s): s is Session => s !== null);
  }

  watch(callback: (sessions: Session[]) => void) {
    const watcher = chokidar.watch(this.stateDir);
    watcher.on('all', async () => {
      const sessions = await this.getActiveSessions();
      callback(sessions);
    });
    return () => watcher.close();
  }
}
```

### Task 3: Basic UI Layout with Ink

**Files:**
- Create: `src/ui/Dashboard.tsx`
- Create: `src/ui/SessionCard.tsx`
- Create: `src/cli.ts`

- [ ] **Step 1: Build SessionCard Component**

> **Required:** SessionCard must render a leading "row-ico" badge per spec **§2.4 (Frozen)**.
> Map `session.term` → `{ glyph, fg, bg }` exactly as the table dictates (iTerm.app→`$|`, Apple_Terminal→`>_`, Ghostty→`👻`, fallback → first 2 chars of `$TERM_PROGRAM`).
> Reference CSS in `docs/preview.html` `.row-ico.{iterm,terminal,ghostty}`.

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Session } from '../types';

export const SessionCard = ({ session, isFocused }: { session: Session; isFocused: boolean }) => (
  <Box
    borderStyle="round"
    borderColor={isFocused ? 'cyan' : 'gray'}
    paddingX={1}
    width={30}
    flexDirection="column"
  >
    <Text bold color="white">{path.basename(session.cwd)}</Text>
    <Text dimColor>{session.cwd}</Text>
    <Box marginTop={1}>
      <Text color="yellow">❯ {session.lastCmd}</Text>
    </Box>
  </Box>
);
```

- [ ] **Step 2: Implement Dashboard Grid**
```tsx
import React, { useState, useEffect } from 'react';
import { Box, useInput } from 'ink';
import { SessionManager } from '../engine/watcher';
import { Session } from '../types';
import { SessionCard } from './SessionCard';

export const Dashboard = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const manager = new SessionManager();

  useEffect(() => {
    return manager.watch(setSessions);
  }, []);

  useInput((input, key) => {
    if (key.rightArrow) setFocusIndex(i => Math.min(i + 1, sessions.length - 1));
    if (key.leftArrow) setFocusIndex(i => Math.max(i - 1, 0));
    if (input === 'q') process.exit();
  });

  return (
    <Box flexDirection="row" flexWrap="wrap">
      {sessions.map((s, i) => (
        <SessionCard key={s.pid} session={s} isFocused={i === focusIndex} />
      ))}
    </Box>
  );
};
```

### Task 4: Terminal Integration (Teleport & Kill)

**Files:**
- Modify: `src/ui/Dashboard.tsx`
- Create: `src/utils/terminal.ts`

- [ ] **Step 1: Implement AppleScript Teleport**
```typescript
import { exec } from 'child_process';

export const teleportToSession = (pid: number, term: string) => {
  if (term === 'iTerm.app') {
    const script = `tell application "iTerm" to activate`; // Simplified for now
    exec(`osascript -e '${script}'`);
  }
};

export const killSession = (pid: number) => {
  process.kill(pid, 'SIGTERM');
};
```

- [ ] **Step 2: Wire up keys in Dashboard**
```tsx
useInput((input, key) => {
  const current = sessions[focusIndex];
  if (key.return) teleportToSession(current.pid, current.term || '');
  if (input === 'x') killSession(current.pid);
});
```
