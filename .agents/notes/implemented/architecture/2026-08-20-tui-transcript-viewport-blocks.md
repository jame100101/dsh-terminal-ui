# Agent Note: TUI transcript concatenates only the viewport plus overscan

Status: implemented

English | [中文](2026-08-20-tui-transcript-viewport-blocks.zh.md)

## Problem

Issue #14 Phase 1 still built one flat `TranscriptLine[]` for every retained node (the last 3000) on each App render, then sliced it for Ink. Cached wrap made the second pass cheaper, but concatenating thousands of line objects still sat on the same frame as wheel and key input.

## Decision

Project each node (and the live/dock tail) into its own line block. `selectTranscriptBlocksWindow` walks block lengths for the full line count and concatenates only the blocks that intersect the visible slice plus 32 rows of overscan. Ink still slices that window with the existing bottom-anchored offset. The scrollbar and scroll-growth compensation use the full count, not the window length. Mouse disclosure hits use the window-relative offset. This is a line-index window, not `@tanstack/react-virtual`.

## Alternatives considered

### Why not skip wrap for off-window nodes?

Scrollbar offset clamp needs every node's line count. The first visit still wraps; later frames reuse `cachedNodeLines`. Dropping off-window arrays until they scroll in would be Phase 3 working-set work.

### Why not pass already-sliced rows into Ink with offset 0?

The existing `selectTranscriptViewport` bottom-aligns short content and reserves the back-to-bottom row. Keeping that function on an overscan window preserves those rules without a second layout path.

## Consequences

Follow mode, PgUp/PgDn, scrollbar drag, and disclosure arrows keep the same pixels. Long transcripts no longer allocate a full-history array on every busy frame. The 3000-node retention cap stays until Phase 3.

## Testing

`packages/tui/tui/tests/viewport.spec.ts` compares the windowed visible slice to a flat `selectTranscriptViewport`. `render-frame.spec.ts` and `terminal-pty.spec.ts` cover wheel, scrollbar, and the first-prompt scroll of a long session.
