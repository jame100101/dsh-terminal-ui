# Agent Note: 窗口化 transcript 命中与拖选覆盖

Status: implemented

[English](2026-08-20-tui-windowed-transcript-hit-test.md) | 中文

## Problem

ChatTranscript 每次 store 发布都会把投影出的每一行拼成一张密数组，供鼠标命中按绝对下标取行。流式大约 25 帧/秒时，即使用 Ink 只画 overscan 窗口，也会按会话长度复制整表。

拖选自动滚动时，起选行可能已经离开当前窗口，松开复制不能只读当前切片。

## Decision

绘制集合仍是 `selectTranscriptBlocksWindow`。鼠标处理从 `blocksRef` 和当前滚动偏移即时重算该窗口；`transcriptCellAt` 加上 `windowStart`，行下标保持绝对。

拖选过程中，`rememberTranscriptWindow` 把每次经过的 overscan 切片写入稀疏 `Map<number, TranscriptLine>`。`extractSelectedText` 读这张表（或测试用的密数组）。渲染路径不再把已落定历史展成一张数组。

## Alternatives considered

### Why not keep the dense `allLines` array?

密数组让偏移变化能在下一次 React 渲染前命中，但复制成本随会话长度在每一帧增长。从按节点的块重算 overscan 窗口，成本与块数量加窗口大小成正比。

### Why not copy from the current window only?

边缘自动滚动每次两行、overscan 32 行。长拖选的起点会离开窗口。稀疏表覆盖手势期间见过的每个窗口。

## Consequences

Ink 仍只收到 overscan 行。滚动条长度仍走各块行数。最近 3000 个节点的投影不变。

## Testing

`viewport.spec.ts` 覆盖 `transcriptCellAt` 的 `windowStart` 和 `rememberTranscriptWindow`。`selection.spec.ts` 从有空洞的稀疏表提取。`render-frame.spec.ts` 覆盖拖选复制和边缘自动滚动。
