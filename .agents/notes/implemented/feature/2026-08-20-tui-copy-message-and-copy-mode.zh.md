# Agent Note: TUI 用默认拖选复制提示词和回复

Status: implemented

[English](2026-08-20-tui-copy-message-and-copy-mode.md) | 中文

## Problem

滚轮和滚动条需要鼠标跟踪（`ENABLE_WHEEL_MOUSE`），宿主终端因此不能原生拖选 transcript。单独的 Copy Mode 要先关跟踪，多一层仪式。Grok 的默认是拖选高亮并自动复制，单击提示或回复也能复制，不用切换模式。Issue #12 的 Copy Mode / Tab / `y` 和这个不一致。

## Decision

复制是 transcript 上的默认鼠标路径，不是一种模式。左键在已绘制的行上拖选会反色高亮，松开时通过 `clipboard.ts` 复制（stdin 喂给 `clip` / `pbcopy` / `xclip` / `wl-copy`，OSC 52 兜底）。单击且没有拖动时，点用户提示或助手回复会复制该节点的语义 `node.text`（Markdown 源，无字形）并高亮整块。`Esc` 清掉高亮，不取消任务。滚轮、滚动条、disclosure 箭头、回到底部按钮在命中时仍优先。

`/copy` 复制最近一条助手回复；`/copy n` 是第 n 条最近回复（Grok 编号）。提示词靠单击或拖选复制，不走 `/copy`。没有 `/select`，没有 `Ctrl+Y` Copy Mode，应用运行期间鼠标跟踪保持开启。`Ctrl+C` 仍是取消 / 连按退出。线性/print 模式不实现剪贴板快捷键。

## Alternatives considered

### Why not keep Copy Mode (`DISABLE_WHEEL_MOUSE` + host-terminal selection)?

那是多出来的模式。Grok 在鼠标上报仍然开启时就能拖选复制。用户复制提示词和回复时不需要记一套进入组合键。

### Why not restore Tab message selection and `y`?

Idle Tab 给 slash palette 和设置。`y` 会吃掉 composer 里 `yesterday` 的首字符。

### Why not implement a grapheme engine over the raw session log?

屏幕上的行已经 wrap 过。拖选读这些格子（CJK 走 `string-width`），只有范围包含行首时才去掉 `▸ ` / `● `。整条单击仍用 `node.text`。

## Consequences

滚轮和滚动条继续可用。单击提示或回复就复制。拖选复制高亮片段并自动写入剪贴板。`/copy` 只针对助手回复。

## Testing

`packages/tui/tui/tests/selection.spec.ts` 覆盖显示列切片、chrome 剥离、范围顺序。`copy-text.spec.ts` 覆盖语义提取和第 n 条最近 `/copy`。`clipboard.spec.ts` 覆盖 OSC 52、双失败、stdin 管道。`render-frame.spec.ts` 覆盖单击复制提示、拖选复制、`/copy` 不调用 `submit`，以及复制后滚轮仍可用。
