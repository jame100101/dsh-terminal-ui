# Agent Note: Stream publishes reuse panel snapshot fields

Status: implemented

English | [中文](2026-08-20-tui-stream-publish-skips-panels.zh.md)

## Problem

Coalesced `assistant/chunk` publishes already skipped sessions/jobs/workflows/sandbox/occupancy recompute, but still rebuilt queued, settings, subagents, feedback, reasoning, and attachmentCount on every 40ms flush. Header and the permission row also re-rendered because they received a new snapshot object.

## Decision

`selectPanelSnapshot` returns the previous panel-field identities when `reusePanels` is true and does not call the compute function. Immediate publishes still compute those fields. Header and PermissionBar are `React.memo` with comparators that ignore live text and stats.

## Alternatives considered

### Why not split the store into TranscriptStore and PanelStore?

Separate stores would stop App from waking on live text, but every layout consumer would need a second subscription. Reusing field identities plus memo comparators keeps one snapshot and skips the expensive chrome subtrees.

## Consequences

A stream chunk still publishes live, stats, nodes (stable), and busy. Sessions, jobs, settings, and occupancy stay the previous objects until a non-chunk event.

## Testing

`publish-snapshot.spec.ts` proves `reusePanels` skips compute and keeps identities.
