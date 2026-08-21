# Agent Note: Windowed transcript hit-test and drag-copy coverage

Status: implemented

English | [中文](2026-08-20-tui-windowed-transcript-hit-test.zh.md)

## Problem

ChatTranscript concatenated every projected transcript line on each store publish so mouse hit-testing could use a dense absolute array. Streaming at ~25 UI frames per second therefore copied the full line list even though Ink only paints the overscan window.

A drag that auto-scrolls can start on a row that later leaves that window, so copy on mouse-up cannot read only the current slice.

## Decision

`selectTranscriptBlocksWindow` remains the painted set. Mouse handlers recompute that window from a `blocksRef` and the live scroll offset, and `transcriptCellAt` adds `windowStart` so line indices stay absolute.

During a drag, `rememberTranscriptWindow` writes each visited overscan slice into a sparse `Map<number, TranscriptLine>`. `extractSelectedText` reads that map (or a dense test array). Settled history is not flattened into one array on the render path.

## Alternatives considered

### Why not keep the dense `allLines` array?

It made offset changes hit-testable before the next React render, but the copy cost scaled with session length on every live frame. Recomputing the overscan window from per-node blocks is proportional to block count plus window size.

### Why not copy from the current window only?

Edge auto-scroll moves the window by two rows per tick with 32 rows of overscan. A long drag's start row leaves the window. The sparse map is the coverage of every window seen during the gesture.

## Consequences

Ink still receives only the overscan rows. Scrollbar length still walks block lengths. Node projection of the last 3000 nodes is unchanged.

## Testing

`viewport.spec.ts` covers `windowStart` on `transcriptCellAt` and `rememberTranscriptWindow`. `selection.spec.ts` extracts a gapped sparse map. `render-frame.spec.ts` covers drag-copy and edge auto-scroll.
