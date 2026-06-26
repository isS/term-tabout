# term-tabout — 安装与配置 / Setup Guide

> 这份文档面向 AI Agent（也适合手动照做）。请**按顺序**执行下面每一步，每步都给出了验证方法；某步失败时先解决再继续。
>
> This guide is written for an AI agent (humans can follow it too). Execute each step **in order**; every step includes a check. If a step fails, fix it before moving on.

---

## 0. 前置检查 / Preconditions

term-tabout 仅支持 **macOS**，并需要 **Node ≥ 18**。

term-tabout supports **macOS only** and requires **Node ≥ 18**.

```bash
uname -s          # 期望 / expect: Darwin
node -v           # 期望 / expect: v18 或更高 / v18 or higher
```

- 若 `uname -s` 不是 `Darwin`：停止，告知用户 term-tabout 仅支持 macOS。
- 若 `node -v` 低于 18 或 `node` 不存在：先安装/升级 Node（如 `brew install node`），再继续。

---

## 1. 安装 / Install

```bash
npm install -g term-tabout
```

验证 / Verify:

```bash
term-tabout --help    # 应打印用法，说明二进制已在 PATH 中 / should print usage
```

若提示 `command not found: term-tabout`，检查 `npm bin -g` 是否在 `PATH` 中。

---

## 2. 接入 shell collector / Wire up the shell collector

term-tabout 通过一个 shell 钩子脚本（collector）在每次切换目录/执行命令时记录会话。需要把它接入你的 shell 配置。

term-tabout uses a shell hook (the collector) that records sessions on every directory change / command. You must wire it into your shell config.

### zsh（默认 / default）

```bash
term-tabout --install --apply
```

这会在 `~/.zshrc` 末尾追加一个 marker block（包住一行 `source …/term-tabout.zsh`）。该命令**幂等**——重复执行不会重复写入。

This appends a marker block (wrapping a `source …/term-tabout.zsh` line) to `~/.zshrc`. The command is **idempotent** — re-running won't duplicate it.

### fish

`--install` 目前只处理 zsh。fish 用户请手动把 collector 加入 `config.fish`：

`--install` only handles zsh. For fish, add the collector to `config.fish` manually:

```bash
echo "source $(npm root -g)/term-tabout/src/collector/term-tabout.fish" >> ~/.config/fish/config.fish
```

---

## 3. 重载 shell 并验证 / Reload the shell and verify

collector 只在**新**的交互式 shell 里加载。请**打开一个新的终端标签/窗口**（或 `exec zsh` / `exec fish`），然后运行诊断：

The collector only loads in a **new** interactive shell. **Open a new terminal tab/window** (or `exec zsh` / `exec fish`), then run the doctor:

```bash
term-tabout --doctor
```

期望 / Expect: 输出里至少有一个标记为 `alive` 的会话。若显示 “collector likely isn't loaded”，说明第 2 步的配置没在当前 shell 生效——确认你确实开了新终端，且 source 行在 rc 文件里。

You should see at least one session tagged `alive`. If it says "collector likely isn't loaded", the step-2 config didn't take effect in this shell — make sure you opened a new terminal and the source line is in your rc file.

---

## 4. 启动仪表盘 / Launch the dashboard

```bash
term-tabout
```

会在随机端口起一个本地 HTTP 服务并自动打开浏览器。常用参数 / Common flags:

- `term-tabout --port 7777` — 指定端口 / pin a port
- `term-tabout --no-open` — 不自动开浏览器 / don't auto-open the browser

到此安装完成。点一行可瞬移到对应终端标签；`r` 重命名、`s` 收藏 cwd、`x` 清理。

Done. Click a row to teleport to that terminal tab; `r` rename, `s` save cwd, `x` kill/forget.

---

## 排错与卸载 / Troubleshooting & uninstall

- **看不到任何会话**：先 `term-tabout --doctor`，按它末尾打印的 `source` 行手动加到 rc 文件，再开新终端。
- **清理已死进程的残留**：`term-tabout --purge`。
- **卸载 shell 接入**：`term-tabout --uninstall --apply`（移除 `~/.zshrc` 里的 marker block；fish 需手动删 `config.fish` 里那一行）。
- **彻底卸载**：上面卸载后再 `npm uninstall -g term-tabout`。

---

## 维护者发布清单 / Maintainer release checklist

> 这段给仓库维护者，**不是给安装用户的**。上面的 AI 安装提示词只有在下面两步都完成后才能解析成功。
>
> For the repo maintainer, **not for end users**. The AI install prompt only resolves after both of these are done.

1. **发布到 npm** — 否则 `npm install -g term-tabout` 会 404：
   ```bash
   npm run build && npm publish
   ```
2. **推送到 GitHub `isS/term-tabout` 的 `main`** — 否则 README 里的 `raw.githubusercontent.com/.../SETUP.md` 链接会 404。
