# Agent Note: Transcript owns live thinking/compaction shimmer

Status: implemented

English | [中文](2026-08-20-tui-transcript-owns-live-shimmer.zh.md)

## Problem

A 100ms timer in ChatTranscript rebuilt the full transcript window (block walk, `allLines` concat, overscan slice) on every spinner frame, even when settled history and live text had not changed.

## Decision

`TranscriptLine` carries `shimmer: 'thinking' | 'compact'` and optional `shimmerSince`. ChatTranscript emits static live headers. Transcript runs the 100ms timer only while a visible row has `shimmer`, and paints glyph, elapsed suffix, and grayscale sweep through `liveShimmerPaint`. Store publishes still rebuild the window; the spinner does not.

## Alternatives considered

### Why not paint thinking outside the transcript viewport?

The live header must stay in the scrollable transcript so follow-mode, overscan, and drag-copy hit-testing share one row list.

### Why not keep the timer on ChatTranscript and memoize the settled window?

The timer still re-rendered ChatTranscript, which concatenated every transcript line for mouse hit-testing. Moving the timer to Transcript limits that work to the visible rows.

## Consequences

Busy thinking/compaction still animates while idle history is off the timer. Status-bar star keeps its own tick.

## Testing

`packages/tui/tui/tests/busy-star.spec.ts` covers `liveShimmerPaint` glyphs and named colors. `render-frame.spec.ts` covers the visible Thinking spinner and compacting row.
