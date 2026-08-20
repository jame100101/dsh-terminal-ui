# Agent Note: TUI copies prompts and replies with default drag-select

Status: implemented

English | [中文](2026-08-20-tui-copy-message-and-copy-mode.zh.md)

## Problem

Mouse tracking (`ENABLE_WHEEL_MOUSE`) is required for wheel and the scrollbar, so the host terminal cannot natively drag-select transcript text. A separate Copy Mode that disables tracking is extra ceremony: Grok's default is drag-to-highlight and auto-copy, plus click-to-copy a prompt or reply, with no mode switch. Issue #12's Copy Mode / Tab / `y` entries do not match that.

## Decision

Copy is the default mouse path on the transcript, not a mode. Left-button drag over painted rows highlights cells (inverse) and copies on release via `clipboard.ts` (stdin `clip` / `pbcopy` / `xclip` / `wl-copy`, OSC 52 fallback). A click with no drag on a user prompt or assistant reply copies that node's semantic `node.text` (markdown source, no glyphs) and highlights the block. `Esc` clears the highlight and does not cancel the agent. Wheel, scrollbar, disclosure arrows, and the back-to-bottom button still win when the press hits them.

`/copy` copies the latest assistant reply; `/copy n` is the Nth-latest reply (Grok numbering). Prompts are copied by click or drag, not by `/copy`. There is no `/select`, no `Ctrl+Y` Copy Mode, and mouse tracking stays on while the app runs. `Ctrl+C` stays cancel / double-press exit. Linear/print mode does not implement clipboard shortcuts.

## Alternatives considered

### Why not keep Copy Mode (`DISABLE_WHEEL_MOUSE` + host-terminal selection)?

That is an extra mode. Grok copies from drag-select while mouse reporting stays on. Users copy prompts and replies without remembering an entry chord.

### Why not restore Tab message selection and `y`?

Idle Tab drives the slash palette and settings. `y` would eat the first character of `yesterday` in the composer.

### Why not implement a grapheme engine over the raw session log?

The painted rows are already wrapped. Drag-copy reads those cells (CJK via `string-width`) and strips `▸ ` / `● ` only when the range includes the line start. Whole-message click still uses `node.text`.

## Consequences

Wheel and scrollbar keep working. A click on a prompt or reply copies it. A drag copies the highlighted span and auto-writes the clipboard. `/copy` only targets assistant replies.

## Testing

`packages/tui/tui/tests/selection.spec.ts` covers display-column slicing, chrome stripping, and range order. `copy-text.spec.ts` covers semantic extraction and Nth-latest `/copy`. `clipboard.spec.ts` covers OSC 52, dual-failure, and stdin piping. `render-frame.spec.ts` covers click-to-copy a prompt, drag-copy, `/copy` not calling `submit`, and wheel after a copy.
