# Agent Note: TUI busy-stream responsiveness and chrome contrast

Status: implemented

English | [中文](2026-08-20-tui-busy-stream-responsiveness.zh.md)

## Problem

While the agent is answering, Ink spends the event loop on per-token `store.set`, full live-text wrap, and an App-level 100ms tick that rebuilds history projection. Wheel and key input stall. User and assistant rows sit flush; dark theme uses dim/gray for primary text; the status bar busy marker is a static `●`.

## Decision

The TUI plugin keeps Ink 7. Fold still applies every session event immediately. UI `store.set` for `assistant/chunk` text/reasoning deltas coalesces at 40ms (`createUiPublishScheduler`); tool/call, tool/result, turn/end, assistant/message, and agent status publish immediately. Live assistant wrap reuses completed rows (`wrapLiveAssistantText`). Thinking/compaction ticks live in `ChatTranscript`; the status bar star (`✶✸✹✺`) has its own 100ms timer; retry waiting headers pulse inside `Transcript`. User nodes get Grok-style prompt blocks: gray Ink background (`bg = light`), one blank row above and below, merged between consecutive users. Assistant markdown keeps one blank row between blocks (marked `space` tokens); think/tool/assistant nodes stay flush. Dark palette keeps assistant body at `whiteBright`, leaves user prompts at `blue` on a gray block, and leaves chrome data (`gray`, turn tails, permission chip, composer `›`) un-brightened so those rows stay muted. Hex/`black` still remap so Windows Terminal never paints invisible text. Settings has no theme switcher; the terminal stays on the dark palette. Live Thinking changes only its spinner glyph. The busy status bar cycles the star glyph on a stable yellow. Settings uses Claude Code chrome: search field, clickable tab strip, Tab / ←→ to cycle, Esc to close. Models provider labels are cyan section titles without a `▸`. `TUI_PERF=1` prints publish/s and render/s on stderr.

## Alternatives considered

### Why not `@tanstack/react-virtual`?

It virtualizes DOM nodes. The TUI already slices visible rows in `selectTranscriptViewport`. A DOM virtualizer cannot drive Ink.

### Why not React `startTransition` / `requestAnimationFrame`?

Ink is not React DOM. Concurrent scheduling does not order terminal input ahead of wrap work. Coalesced publish plus incremental wrap shortens the blocking work.

### Why not an App-level tick for the status-bar star?

A 100ms `setTick` in `App` would rebuild `historyLines`. The star is StatusBar-local; Thinking animation is `ChatTranscript`-local.

## Consequences

Busy-turn wheel and keys share the event loop with fewer, cheaper frames. Cancelled streams still fold immediately because `assistant/message` is not coalesced. Linear/plain mode does not insert vpad. `TUI_PERF` is off by default.

## Testing

`packages/tui/tui/tests/wrap.spec.ts`, `ui-publish.spec.ts`, `busy-star.spec.ts`, and `render-frame.spec.ts` cover incremental wrap, coalescing, dark remap, prompt vpad, and the busy star.
