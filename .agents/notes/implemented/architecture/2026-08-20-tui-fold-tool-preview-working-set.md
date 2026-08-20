# Agent Note: TUI fold keeps preview-sized tool rows; raw payloads stay on the session log

Status: implemented

English | [中文](2026-08-20-tui-fold-tool-preview-working-set.zh.md)

## Problem

Issue #14 Phase 3: a long coding session retains the jsonl log, folded `TuiNode`s, parsed `args`, and `presentCall`/`presentResult` views together. Giant shell logs, file reads, and diffs therefore live in the TUI working set even after the renderer already caps card lines. The display window of the last 3000 nodes does not shrink those objects.

## Decision

The session log remains the durable copy. Folded tool rows are a preview working set. `tool/call` still parses `args` so `presentResult` can run. `enrichToolCards` writes a compacted call/result view (`compactCallCard` / `compactResultCard` in `card-project.ts`, same 4000-character / 200-line caps the projector already uses). `tool/result` then drops `args` and the pending call view, keeps capped `text`, and stores only the compacted result card. Resume via `foldFromLog` never rehydrates raw arguments onto settled rows.

The renderer still windows the last 3000 nodes for wrap. It does not slice `fold.nodes` further: copy-by-index and scrollbar length need the compact index, and dropping old rows without re-folding from the log would hide history.

## Alternatives considered

### Why not `nodes = nodes.slice(-1000)`?

Issue #14 forbids deleting history from the fold to save memory. Scroll, resume, and `/copy n` would lose rows the log still has, unless a second on-demand re-fold path exists. That path is not this change.

### Why not project cards to `CardLine[]` at fold time?

Locale-sensitive labels (`truncated`, `共 N 项`) are chosen at render time. Compacting the view fields keeps `projectResultCard(view, text, locale)` and still bounds retained strings.

### Why not a smaller LRU over `cachedNodeLines`?

`historyBlocks` still asks every retained node for a line count each frame. An LRU smaller than that window would re-wrap the rest on every render.

## Consequences

Settled tool rows no longer hold parsed arguments or whole-file result views. Expanded cards still show the same truncated preview. `/copy` of a tool row copies the capped `text`, not the jsonl payload. User, assistant, and think bodies stay full length because they are the conversation.

## Testing

`packages/tui/tui/tests/fold.spec.ts` asserts args exist while running, then vanish after result, with result text capped at 4000. `card-project.spec.ts` asserts `compactResultCard` truncates terminal output and drops duplicate read `content`.
