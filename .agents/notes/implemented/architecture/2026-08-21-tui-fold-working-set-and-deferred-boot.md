# Agent Note: TUI fold working set and deferred boot loads

Status: implemented

English | [中文](2026-08-21-tui-fold-working-set-and-deferred-boot.zh.md)

## Problem

The Ink viewport already painted only the visible tail, but `FoldState.nodes` and `trace` kept every event for the life of the process, and user/assistant/think bodies had no cap. A long session therefore held a second, unbounded copy of the session log in the TUI. Catalog, settings, feedback, and subagent lists also started I/O during Cordis boot, contending with the first frame. Daily `pnpm dsh --profile tui` still launched through tsx (~19 s in the release baseline) even though a built `lib/` path exists.

## Decision

The fold working set keeps the newest 3000 transcript rows and the newest 512 trajectory lines. Settled bodies hard-slice to 32 KiB (assistant), 8 KiB (user), and 4 KiB (think, tool, context). Live streaming buffers use the same caps. Stats still accumulate for evicted prefix events. The session jsonl log is unchanged and remains the full record. Catalog, settings, reasoning, and feedback load on `setImmediate` after boot yields; print mode skips them; subagent rows load when `/subagents` opens. `TUI_PERF=1` reports `heapUsed` each second. `pnpm dsh:tui` runs `node apps/cli/lib/bin.js --profile tui` (one Node process, built artifacts).

## Alternatives considered

### Why not drop the in-memory session event log?

The Agent and resume path require the complete log. Changing that store is outside the TUI package and would alter session format or loop contracts.

### Why not keep full assistant text for `--print`?

`--print` reads the same fold. 32 KiB covers typical script output. Unbounded print would reintroduce the second copy the working set exists to prevent.

### Why not in-process-exec the `dsh-tui` wrapper?

Replacing the wrapper process on Windows has no `execve`. `pnpm dsh:tui` already skips the wrapper. Changing the published `dsh-tui` spawn contract is a separate launcher change.

## Consequences

Scrolling older than 3000 fold rows is impossible; that already matched the previous render slice. `/copy` of a truncated body copies the prefix. `--print` of a longer assistant message is truncated at 32 KiB. The in-memory session log can still grow with turn count; the TUI copy does not.

## Testing

`fold.spec.ts` asserts body caps, a 1200-turn replay retaining 3000 rows with stats still at 1200, and `foldResidentChars` below the uncapped size. `tui-perf.spec.ts` asserts the heap field on the stderr line.
