# Agent Note: Transcript 自己跑 live Thinking / compaction 微光

Status: implemented

[English](2026-08-20-tui-transcript-owns-live-shimmer.md) | 中文

## Problem

ChatTranscript 上的 100ms 定时器每一帧都会重建整段 transcript 窗口（块遍历、`allLines` 拼接、overscan 切片），即使已落定历史和 live 文本没有变化。

## Decision

`TranscriptLine` 带 `shimmer: 'thinking' | 'compact'` 和可选的 `shimmerSince`。ChatTranscript 只发出静态 live 标题。Transcript 仅在可见行带 `shimmer` 时跑 100ms 定时器，并通过 `liveShimmerPaint` 画字形、耗时后缀和灰度扫过。store 发布仍会重建窗口；转圈本身不会。

## Alternatives considered

### Why not paint thinking outside the transcript viewport?

live 标题必须留在可滚动的 transcript 里，follow 模式、overscan 和拖选命中共用同一行表。

### Why not keep the timer on ChatTranscript and memoize the settled window?

定时器仍会重绘 ChatTranscript，它会为鼠标命中拼接每一行。把定时器放到 Transcript 后，这份工作只落在可见行上。

## Consequences

忙碌的 Thinking / compaction 仍会动；空闲历史不在这个定时器上。状态栏星星仍用自己的 tick。

## Testing

`packages/tui/tui/tests/busy-star.spec.ts` 覆盖 `liveShimmerPaint` 的字形和具名颜色。`render-frame.spec.ts` 覆盖可见的 Thinking 转圈和 compacting 行。
