# Agent Note: TUI busy-stream responsiveness and chrome contrast

Status: implemented

English | [中文](2026-08-20-tui-busy-stream-responsiveness.zh.md)

## Problem

While the agent is answering, Ink spends the event loop on per-token `store.set`, full live-text wrap, and an App-level 100ms tick that rebuilds history projection. Wheel and key input stall. A live reasoning chunk that ends in CR or LF also clears the only projected Thinking body row until another non-break chunk arrives. User and assistant rows sit flush; dark theme uses dim/gray for primary text; the status bar busy marker is a static `●`. The composer reserves two cells for `› ` before its wrap budget, making its first row needlessly narrow at the terminal edge. Its selected-row renderer also gives the unselected prefix, highlight, and suffix independent exact-width Yoga boxes; Windows Terminal can displace a leading first-row glyph while repainting those styled siblings. Segmented todo/goal colors make the compact dock visually noisy.

## Decision

The TUI plugin keeps Ink 7. Fold still applies every session event immediately. UI `store.set` for `assistant/chunk` text/reasoning deltas coalesces at 40ms (`createUiPublishScheduler`); tool/call, tool/result, turn/end, assistant/message, and agent status publish immediately. Live assistant wrap reuses completed rows (`wrapLiveAssistantText`). The single-row live Thinking projection retains a display-cell-bounded suffix, renders CR/LF as a compact `↵` separator, and keeps a separate 64-code-unit raw suffix to recognize append-only updates; a chunk ending at a line break therefore leaves visible content instead of removing the body row. Thinking/compaction ticks live in `ChatTranscript`; the status bar star (`✶✸✹✺`) has its own 100ms timer; retry waiting headers pulse inside `Transcript`. User nodes get Grok-style prompt blocks: darker gray Ink background (`#2d2d2d` in dark, named `gray` in light), white prompt text (`whiteBright` after dark remap), one blank row above and below, merged between consecutive users. Assistant markdown keeps one blank row between blocks (marked `space` tokens); think/tool/assistant nodes stay flush. Dark palette keeps assistant body at `whiteBright` and leaves chrome data (`gray`, turn tails, permission chip, composer `›`) un-brightened so those rows stay muted. The composer gives `›` and the matching continuation indent one cell, then preserves a separate one-cell right-edge wrap gutter; every row consequently shares the same text column and the first row gains one usable cell without touching the terminal autowrap column. A selected row remains one Ink text layout with nested before/highlight/after spans rather than three exact-width sibling boxes, preserving both source offsets and the blue selection style. Todo uses one exact `#8A8A8A` foreground for its complete dock row and goal uses one exact `#61D6D6` foreground for its complete row. Hex/`black` still remap so Windows Terminal never paints invisible text. Settings has no theme switcher; the terminal stays on the dark palette. Live Thinking sweeps a grayscale highlight across the label (`gray` / `whiteBright` from `thinkingShimmerLevel`); hex grayscale is not stamped because Windows Terminal paints it black. The busy status bar cycles the star glyph on a stable yellow. Settings uses Claude Code chrome: search field, clickable tab strip, Tab / ←→ to cycle, Esc to close. Models provider labels are cyan section titles without a `▸`. `TUI_PERF=1` prints publish/s and render/s on stderr.

## Alternatives considered

### Why not `@tanstack/react-virtual`?

It virtualizes DOM nodes. The TUI already slices visible rows in `selectTranscriptViewport`. A DOM virtualizer cannot drive Ink.

### Why not React `startTransition` / `requestAnimationFrame`?

Ink is not React DOM. Concurrent scheduling does not order terminal input ahead of wrap work. Coalesced publish plus incremental wrap shortens the blocking work.

### Why not an App-level tick for the status-bar star?

A 100ms `setTick` in `App` would rebuild `historyLines`. The star is StatusBar-local; Thinking animation is `ChatTranscript`-local.

### Why not reset live Thinking at every line break?

Resetting retains only the newest logical line, but a streamed chunk commonly ends exactly at its delimiter. That leaves an animated header with no body until the next content chunk and looks like the model stream stopped. A visible separator preserves the one-row bound and communicates continued progress.

### Why not retain per-status colors in the compact dock?

The counts and phase labels already carry the status semantics. Coloring every segment independently gives a small, frequently changing row too many competing accents; uniform exact colors keep the text legible without depending on terminal theme mappings.

## Consequences

Busy-turn wheel and keys share the event loop with fewer, cheaper frames. Cancelled streams still fold immediately because `assistant/message` is not coalesced. The live Thinking preview flattens logical line boundaries into `↵` inside its one visible row, while the durable reasoning text is unchanged. Composer text starts immediately after `›`; the right-edge safety gutter remains, and selection repaint retains every source glyph. Todo/goal phase changes do not change dock hue. Linear/plain mode does not insert vpad. `TUI_PERF` is off by default.

## Testing

`packages/tui/tui/tests/wrap.spec.ts`, `viewport.spec.ts`, `status-color.spec.ts`, `ui-publish.spec.ts`, `busy-star.spec.ts`, and `render-frame.spec.ts` cover incremental wrap, trailing and split line breaks, composer alignment, first-row glyph retention during a CJK mouse selection, exact selected-source replacement, uniform dock colors, coalescing, dark remap, prompt vpad, the busy star, and the Thinking grayscale sweep.
