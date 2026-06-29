# term-tabout

[English](./README.md) · **简体中文**

> macOS 终端会话仪表盘，一个网页总览所有终端里的活跃 shell —— iTerm2、Ghostty、Terminal.app，乃至 VS Code 集成终端。点一下就能瞬移到对应标签页、重命名、收藏目录，或清理已退出的会话。

![term-tabout 演示](docs/demo.gif)

## 用 AI Agent 安装

把下面这段发给你的 AI Agent（Claude Code 等），它会读文档并自动帮你装好、配置好：

```text
请阅读 https://raw.githubusercontent.com/isS/term-tabout/main/SETUP.md 文档，按照步骤为我安装并配置 term-tabout。
```

<details>
<summary>Agent 不能联网？用这个自包含版本。</summary>

```text
请在 macOS 上为我安装并配置 term-tabout，按顺序执行并逐步验证：
1. 确认 `uname -s` 为 Darwin、`node -v` ≥ 18，否则停止并告诉我原因。
2. 运行 `npm install -g term-tabout`，再用 `term-tabout --help` 确认安装成功。
3. zsh 用户运行 `term-tabout --install --apply`（把 collector 写入 ~/.zshrc）；
   fish 用户运行 `echo "source $(npm root -g)/term-tabout/src/collector/term-tabout.fish" >> ~/.config/fish/config.fish`。
4. 让我打开一个新终端，运行 `term-tabout --doctor` 确认能检测到会话。
5. 运行 `term-tabout` 启动仪表盘。
```

</details>

## 手动安装

```bash
npm install -g term-tabout      # 需要 Node ≥ 18
term-tabout --install --apply   # 把 collector 写入 ~/.zshrc
```

打开一个**新**终端，然后运行：

```bash
term-tabout --doctor   # 验证 collector 已生效
term-tabout            # 启动仪表盘（自动打开浏览器）
```

详细步骤、fish 配置与排错见 [SETUP.md](./SETUP.md)。

## 工作原理

一个轻量的 shell 钩子把每个终端会话（PID、工作目录、最近命令）记录到 `~/.term-tabout`。CLI 据此在本地起一个网页仪表盘——点击一行即可通过 AppleScript 瞬移到真实标签页、重命名，或清理已退出的会话。服务只绑定 `127.0.0.1`，且每台机器只运行一个实例。

## 许可证

[ISC](./LICENSE)
