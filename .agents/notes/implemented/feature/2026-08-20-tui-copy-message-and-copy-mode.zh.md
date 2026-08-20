# Agent Note: TUI 复制语义消息文本，并用 Copy Mode 做原生拖选

Status: implemented

[English](2026-08-20-tui-copy-message-and-copy-mode.md) | 中文

## Problem

Issue #12 需要整条消息复制，以及终端原生拖选。Idle Tab 已不再进入 transcript 选择，原文的 Tab / `y` 路径会抢 composer 输入。滚轮和滚动条依赖鼠标跟踪（`ENABLE_WHEEL_MOUSE`），所以正常模式下宿主终端无法拖选。

## Decision

`/copy last` 和 `/copy <n>` 从 fold 节点（user、assistant、think、tool、context）取 `extractCopyText`：`node.text`，去掉 ANSI，不含字形和边框。序号是这些可复制行的 1-based 编号。剪贴板写入走 `clipboard.ts`：spawn `clip` / `pbcopy` / `xclip` 再试 `wl-copy`，payload 走 stdin，OSC 52 兜底。失败只出 notice，不抛。

`/select` 和 `Ctrl+Y` 进入 Copy Mode：写 `DISABLE_WHEEL_MOUSE`，暂停 composer，显示 dock 提示。`Esc` 先退出 Copy Mode（恢复鼠标跟踪），不取消任务、不清 draft、不重置滚动。进程退出仍写 `DISABLE_WHEEL_MOUSE`。`Ctrl+C` 仍是取消 / 连按退出。不恢复 Tab 选择。`Ctrl+Shift+C` 仍是宿主终端的复制组合键。

线性/print 模式提示复制命令需要交互式 TUI，不会把 `/copy` 交给模型。

## Alternatives considered

### Why not restore Tab message selection and `y`?

Idle Tab 给 slash palette 和设置。`y` 会吃掉 composer 里 `yesterday` 的首字符。issue1.md v0.7 禁止在未明确要求时把选择模式加回来。

### Why not `Ctrl+Shift+C` for whole-message copy?

这是 Windows Terminal 的常用复制组合键。绑到 TUI 会和 Copy Mode 里宿主终端的复制抢键。

### Why not merge `rollback-safety/native-scrollback`?

那条分支把复制和原生 scrollback、另一套鼠标策略绑在一起。当前界面保留滚动条，只借用 stdin 剪贴板辅助。

## Consequences

整条复制是 slash 命令。局部复制是 Copy Mode 加宿主终端。工具行复制的是 fold preview，不是原始日志。只有 Copy Mode 期间或进程退出时才关掉鼠标跟踪。

## Testing

`packages/tui/tui/tests/copy-text.spec.ts` 覆盖语义提取、中文/emoji/markdown、ANSI 剥离，以及 `last`/`n` 定位。`clipboard.spec.ts` 覆盖 OSC 52、双失败、以及带 shell 元字符文本的 stdin 管道。`render-frame.spec.ts` 覆盖 Ctrl+Y 关闭鼠标、Esc 恢复且保留 draft，以及 `/copy last` 不调用 `submit`。
