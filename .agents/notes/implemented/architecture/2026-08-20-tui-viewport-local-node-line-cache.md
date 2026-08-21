# Agent Note: Viewport-local node line cache

Status: implemented

English | [中文](2026-08-20-tui-viewport-local-node-line-cache.zh.md)

## Problem

Every history rebuild projected all 3000 retained nodes into line arrays and kept those arrays on the block list passed into windowing. WeakMap entries lived as long as the node did, so a long session retained painted rows for off-screen cards, including extra width/expansion variants.

## Decision

Line counts stay in a WeakMap so the scrollbar can still walk every block. Painted rows live in a Map capped at 256 nodes (plus every node that intersects the current overscan window). Off-window blocks are length-only stubs. A session whose nodes share no identity with the cache clears it.

## Alternatives considered

### Why not evict by WeakMap alone?

WeakMap cannot bound the working set while `snapshot.nodes` still holds the last 3000 nodes. The cap is on painted rows, not on durable fold state.

### Why not skip counting off-window nodes?

Scrollbar thumb position needs the full line total. Counts are cheap once recorded; only the painted arrays are stubbed.

## Consequences

Scrolling to an evicted node re-projects it. Follow-mode streaming keeps the tail in cache. Issue #14 store splitting and heapUsed plateau tests are still open.

## Testing

`render-frame.spec.ts` covers scroll, drag-copy, and edge auto-scroll against the stubbed off-window blocks.
