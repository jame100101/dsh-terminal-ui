# Agent Note: TUI transcript 只拼接视口加 overscan 的行

Status: implemented

[English](2026-08-20-tui-transcript-viewport-blocks.md) | 中文

## Problem

Issue #14 的 Phase 1 仍然在每次 App render 时给所有保留节点（最近 3000 个）拼出一整条 `TranscriptLine[]`，再切片给 Ink。缓存 wrap 让第二次更便宜，但拼接几千个行对象仍然和滚轮、按键抢同一帧。

## Decision

每个节点（以及 live/dock 尾部）投影成自己的行块。`selectTranscriptBlocksWindow` 用各块长度算出全文行数，只拼接与可见切片相交、外加上下各 32 行 overscan 的块。Ink 仍用现有的从底部计的 offset 去切这个窗口。滚动条和滚动增长补偿用全文行数，不用窗口长度。鼠标 disclosure 命中用窗口相对 offset。这是行号窗口，不是 `@tanstack/react-virtual`。

## Alternatives considered

### Why not skip wrap for off-window nodes?

滚动条的 offset 钳位需要每个节点的行数。第一次访问仍会 wrap；之后的帧复用 `cachedNodeLines`。丢掉窗口外的行数组要等 Phase 3 的工作集。

### Why not pass already-sliced rows into Ink with offset 0?

现有的 `selectTranscriptViewport` 会把短内容底对齐，并给回到底部按钮留行。在 overscan 窗口上继续用这个函数，就不必再做一套布局。

## Consequences

follow 模式、PgUp/PgDn、滚动条拖拽、disclosure 箭头的像素不变。长 transcript 不再在每个忙碌帧分配全文数组。3000 节点上限留到 Phase 3。

## Testing

`packages/tui/tui/tests/viewport.spec.ts` 把窗口化后的可见切片和扁平的 `selectTranscriptViewport` 对照。`render-frame.spec.ts` 和 `terminal-pty.spec.ts` 覆盖滚轮、滚动条，以及长会话滚回第一条 prompt。
