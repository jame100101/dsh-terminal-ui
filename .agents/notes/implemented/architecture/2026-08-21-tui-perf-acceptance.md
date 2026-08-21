# Agent Note: TUI performance acceptance counters

Status: implemented

English | [中文](2026-08-21-tui-perf-acceptance.zh.md)

## Problem

Issue #14 Phase 1 and the v0.8 list required numbers for busy-stream UI rate, wheel-to-offset delay, 100/500-turn heap, and a built-artifact startup remasure. `TUI_PERF=1` only printed publish/s, render/s, and heap. There was no keyless gate that could fail CI when those budgets slipped.

## Decision

`TUI_PERF=1` stderr windows include `wheel_avg` / `wheel_max` (parse through scroll-offset write) and `lag` (one `setImmediate` sample). The wheel handler in `render.tsx` always records that delay; the counter no-ops when `TUI_PERF` is unset. `perf-acceptance.spec.ts` is the keyless gate: coalesced publishes stay well below token rate, incremental wrap of the second half stays cheaper than a full rewrap, 800 wheel ticks stay under 8 ms p99, fold resident chars at 100 and 500 turns stay inside the working-set caps, and built `--version` / `--help` / `--dump-config` stay on the product path. The spec writes `evaluation/performance/DSH_TUI_PERF_CURRENT.md` (not committed).

## Alternatives considered

### Why not require `--expose-gc` in every vitest worker?

That flag would change the whole suite. The acceptance spec reports `heapUsed` with optional `global.gc`; fold resident chars are the deterministic bound.

### Why not time a full TTY surface-ready in CI?

A real Ink first frame needs a PTY and a complete Cordis boot with credentials. `--version`, `--help`, and `--dump-config` on `apps/cli/lib/bin.js` remasure the built path against the 76 ms / 2.1 s baseline class without hanging the suite.

## Consequences

Product busy turns with `TUI_PERF=1` print wheel and lag next to publish/s. A live Agent's in-memory session log can still grow; the TUI fold copy does not. Follow-mode offset 0 and scrolled-window anchoring stay in `viewport.spec.ts` and `render-frame.spec.ts`.

## Testing

`tui-perf.spec.ts` covers silent mode, the report line, non-finite wheel delays, and a `setImmediate` sample after `TUI_PERF` is cleared. `perf-acceptance.spec.ts` holds the budgets.
