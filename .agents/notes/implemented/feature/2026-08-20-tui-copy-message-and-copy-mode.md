# Agent Note: TUI copies semantic message text and uses Copy Mode for native drag-select

Status: implemented

English | [中文](2026-08-20-tui-copy-message-and-copy-mode.zh.md)

## Problem

Issue #12 needs whole-message copy plus native terminal drag-select. Idle Tab no longer enters transcript selection, so the issue's Tab / `y` path would steal composer input. Mouse tracking (`ENABLE_WHEEL_MOUSE`) is required for wheel and the scrollbar, which is why the host terminal cannot drag-select in normal mode.

## Decision

`/copy last` and `/copy <n>` copy `extractCopyText` from folded nodes (user, assistant, think, tool, context): `node.text` with ANSI stripped, no glyphs, no borders. Numbering is 1-based among those copyable rows. Clipboard writes go through `clipboard.ts`: spawn `clip` / `pbcopy` / `xclip` then `wl-copy`, piping the payload on stdin, with OSC 52 as fallback. Failures become a notice; they do not throw.

`/select` and `Ctrl+Y` enter Copy Mode: write `DISABLE_WHEEL_MOUSE`, pause the composer, show a dock hint. `Esc` leaves Copy Mode first (re-enables mouse tracking) and does not cancel the agent, clear the draft, or reset scroll. Application exit still writes `DISABLE_WHEEL_MOUSE`. `Ctrl+C` stays cancel / double-press exit. Tab selection is not restored. `Ctrl+Shift+C` stays the host terminal's copy chord.

Linear/print mode prints that copy commands need the interactive TUI and does not forward `/copy` to the model.

## Alternatives considered

### Why not restore Tab message selection and `y`?

Idle Tab drives the slash palette and settings. `y` would eat the first character of `yesterday` in the composer. Issue1.md v0.7 forbids bringing that mode back unless explicitly requested.

### Why not `Ctrl+Shift+C` for whole-message copy?

That chord is the usual Windows Terminal copy. Binding it in the TUI would race the host copy used inside Copy Mode.

### Why not merge `rollback-safety/native-scrollback`?

That branch couples copy with native scrollback and a different mouse policy. This surface keeps the scrollbar and only borrows the stdin clipboard helper.

## Consequences

Whole-message copy is a slash command. Partial copy is Copy Mode plus the host terminal. Tool rows copy the fold preview, not the raw log. Mouse tracking is off only while Copy Mode is active or the process is exiting.

## Testing

`packages/tui/tui/tests/copy-text.spec.ts` covers semantic extraction, CJK/emoji/markdown, ANSI strip, and `last`/`n` targeting. `clipboard.spec.ts` covers OSC 52, dual-failure, and stdin piping of shell-metacharacter text. `render-frame.spec.ts` covers Ctrl+Y mouse-disable, Esc restore with draft kept, and `/copy last` not calling `submit`.
