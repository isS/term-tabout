# term-tabout

**English** · [简体中文](./README.zh-CN.md)

> A macOS dashboard of every active shell across your terminals — iTerm2, Ghostty, Terminal.app, even VS Code integrated terminals. Teleport to any tab, rename it, bookmark its directory, or clear out the dead ones, all from one page.

![term-tabout demo](docs/demo.gif)

## Install with an AI agent

Paste this to your AI agent (Claude Code, etc.) — it reads the guide and installs and configures everything for you:

```text
Read https://raw.githubusercontent.com/isS/term-tabout/main/SETUP.md and follow it to install and configure term-tabout for me.
```

<details>
<summary>Agent can't browse the web? Use this self-contained prompt.</summary>

```text
Install and configure term-tabout on my macOS machine. Run these in order and verify each step:
1. Confirm `uname -s` is Darwin and `node -v` is >= 18; stop and tell me why if not.
2. Run `npm install -g term-tabout`, then `term-tabout --help` to confirm it installed.
3. zsh: run `term-tabout --install --apply` (adds the collector to ~/.zshrc).
   fish: run `echo "source $(npm root -g)/term-tabout/src/collector/term-tabout.fish" >> ~/.config/fish/config.fish`.
4. Have me open a new terminal, then run `term-tabout --doctor` to confirm sessions are detected.
5. Run `term-tabout` to launch the dashboard.
```

</details>

## Manual install

```bash
npm install -g term-tabout      # requires Node >= 18
term-tabout --install --apply   # wire the collector into ~/.zshrc
```

Open a **new** terminal, then run:

```bash
term-tabout --doctor   # verify the collector is active
term-tabout            # launch the dashboard (opens your browser)
```

See [SETUP.md](./SETUP.md) for full steps, fish setup, and troubleshooting.

## How it works

A lightweight shell hook records each terminal session (PID, working directory, last command) to `~/.term-tabout`. The CLI serves a local web dashboard from that state — click a row to teleport to the real tab via AppleScript, rename it, or clean up sessions that have exited. The server binds to `127.0.0.1` only and runs a single instance per machine.

## License

[ISC](./LICENSE)
