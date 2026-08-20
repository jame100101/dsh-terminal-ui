# Agent Note: Stream UI publishes reuse panel snapshot fields

Status: implemented

English | [中文](2026-08-20-tui-stream-publish-reuses-panels.zh.md)

## Problem

Issue #14 Phase 4: every coalesced `assistant/chunk` UI publish rebuilt `/sessions`, `/jobs`, `/workflows`, sandbox mode, occupancy, and the model list, even though those rows do not change on a text or reasoning delta. React memoized chrome still saw new array identities.

## Decision

Coalesced stream publishes (`createUiPublishScheduler`'s delayed `publish(true)`) keep the previous snapshot's `sessions`, `jobs`, `workflows`, `models`, `sandbox`, and `occupancy` references. Interactive and structural events cancel the coalesced window (`dispose`) and call `publish()` with freshly computed panel fields. Fold nodes, live buffer, stats, and busy still update on both paths.

## Alternatives considered

### Why not split the store into several `useSyncExternalStore` slices?

The Ink tree has one `App` snapshot today. Reusing panel references is enough for `React.memo` children that depend on those fields. Multiple stores would rewrite every consumer.

### Why not skip `store.set` when only live text changed?

`ChatTranscript` and the status bar must see live text. The publish still happens; it just stops allocating panel rows.

## Consequences

A streaming token no longer remaps the agent list or job elapsed times. Opening `/jobs` during a stream still shows the last full-publish rows until a non-chunk event (status, tool, turn end) refreshes them. Job elapsed clocks therefore pause across a purely streamed turn and catch up on the next structural event.

## Testing

`packages/tui/tui/tests/ui-publish.spec.ts` still covers coalesce vs immediate. `startup.spec.ts` boots the plugin subscribe path. Stream reuse is the `publish(true)` argument on the delayed scheduler callback in `packages/tui/tui/src/index.ts`.
