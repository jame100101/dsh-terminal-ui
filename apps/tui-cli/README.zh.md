# @jame100101/dsh-tui

[English](README.md) | 中文

`dsh-tui` — a thin, Claude Code-style command line over the DeepSeek Harness
terminal surface. It boots the TUI profile with a small user-facing flag
grammar; all sessions, agents, and rendering stay in the bundled runtime.

> **稳定版** — `0.1.0`，发布在 npm 的 `latest` dist-tag 下。
> 已在 Windows、macOS 和 Linux 上验证干净安装。首个稳定版包含有界长会话渲染、
> 持久会话、逐会话 preset、插件热应用和会话隔离的投影。

## Install

```text
npm install -g @jame100101/dsh-tui
```

(也可用 `npm install -g @jame100101/dsh-tui@0.1.0` 固定版本)

The package ships the built dsh runtime inside `runtime/`, so the global
install needs no other DeepSeek Harness package — external dependencies
install from the npm registry automatically. First boot initializes the
`tui` profile under `$DSH_HOME` on its own.

## Usage

```text
dsh-tui                          interactive TUI, new session
dsh-tui "fix the failing test"   interactive TUI, submits the task on boot
dsh-tui -c                       resume the most recently used session from this directory
dsh-tui -r                       interactive session picker
dsh-tui -r <session>             resume by id, id prefix, or title
dsh-tui -c --fork-session        fork the resumed session, then switch to it
dsh-tui -p "run the tests"       one-shot: print the assistant result and exit
dsh-tui -c -p "keep going"       resume, then run one task non-interactively
```

Exit codes: `0` success, `1` execution failure, `2` usage error, `130`
SIGINT. `--print` output goes to stdout (assistant result only); diagnostics
go to stderr.

`-c` 按 TUI 前台使用时间选择，而不是按会话创建顺序选择。有界索引位于 `$DSH_HOME/tui/session-recency.json`；某个目录首次使用索引时，会回退到最新的顶层会话，尚未在 TUI 前台打开过的 subagent 会话不参与这次迁移回退。

The wrapper resolves the bundled launcher bin, spawns it with inherited
stdio, and passes the child's exit code through — it never captures output,
queries sessions, or renders anything itself. 交互 child 退出后（包括原生
fatal）会幂等复位 mouse tracking、bracketed paste、光标可见性、备用屏幕和
SGR。`--print` 不写这些序列。
