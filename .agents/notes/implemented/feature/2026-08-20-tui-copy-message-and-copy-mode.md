# Agent Note: TUI copies prompts and replies with default drag-select

Status: implemented

English | [中文](2026-08-20-tui-copy-message-and-copy-mode.zh.md)

## Problem

Mouse tracking (`ENABLE_WHEEL_MOUSE`) is required for wheel and the scrollbar, so the host terminal cannot natively drag-select transcript text. A separate Copy Mode that disables tracking is extra ceremony: Grok's default is drag-to-highlight and auto-copy, with no mode switch. A bare click must not select or copy a message. Issue #12's Copy Mode / Tab / `y` entries do not match that.

## Decision

Copy is the default mouse path on the transcript, not a mode. Left-button drag over painted rows highlights cells (inverse) and copies on release via `clipboard.ts` (stdin `clip` / `pbcopy` / `xclip` / `wl-copy`, OSC 52 fallback). Mouse-up copies and immediately clears the highlight (Grok default). The range includes both endpoint glyphs in either direction. Dragging against the top or bottom edge auto-scrolls so the selection can cover off-screen history; wheel ticks during a drag are ignored. Paint partitions glyphs by start column so a CJK split cannot duplicate a character or wrap a pre-wrapped row onto a second terminal line. Windows `clip.exe` receives UTF-16 LE with BOM; UTF-8 stdin is the OEM-code-page mojibake on Chinese Windows. Blank spacer rows between messages can start or continue a drag and are omitted from the clipboard. The composer is a TUI-owned editor (not the host terminal's selection): drag or `Ctrl+A` selects with a blue background, `Ctrl+C` copies that range, `Ctrl+V` or terminal paste inserts, and typing or paste replaces the range. Composer mouse-up keeps the highlight and does not auto-copy. Each wrap row paints a 2-cell `› `/indent prefix inside the allocated box so line 0 shares the wrap budget with later rows; a sibling prompt beside only the first row would clip that row's last glyphs from paint and from a drag copy. Wrap is one cell narrower than the painted text box so a full row cannot clip its last glyph (Ink truncate-at-equals, Windows Terminal pending-wrap). Wrap and hit-testing share that text width. Arrow keys move the caret (including between wrap rows) when the draft is nonempty and recall submit history when it is empty. A draft with 4 or more hard-newline lines collapses to a one-line preview plus a line-count row. A click with no drag does not select or copy a message. `Esc` still clears a transcript highlight or a composer range. Wheel, scrollbar, disclosure arrows, and the back-to-bottom button still win when the press hits them.

`/copy` copies the latest assistant reply; `/copy n` is the Nth-latest reply (Grok numbering). Prompts and replies are copied by dragging, not by a bare click. There is no `/select`, no `Ctrl+Y` Copy Mode, and mouse tracking stays on while the app runs. `Ctrl+C` copies the composer selection when one exists; otherwise it stays cancel / double-press exit. Linear/print mode does not implement clipboard shortcuts.

## Alternatives considered

### Why not keep Copy Mode (`DISABLE_WHEEL_MOUSE` + host-terminal selection)?

That is an extra mode. Grok copies from drag-select while mouse reporting stays on. Users copy prompts and replies without remembering an entry chord.

### Why not restore Tab message selection and `y`?

Idle Tab drives the slash palette and settings. `y` would eat the first character of `yesterday` in the composer.

### Why not implement a grapheme engine over the raw session log?

The painted rows are already wrapped. Drag-copy reads those cells (CJK via `string-width`) and strips `▸ ` / `● ` only when the range includes the line start. Trailing pad spaces are not selectable, and a one-row one-column move is click jitter rather than a drag. Adjacent highlight slices use start-column ownership so they concatenate to the original row.

## Consequences

Wheel and scrollbar keep working except during an active text drag, which ignores the wheel and instead auto-scrolls when the pointer holds against the transcript edge. A click on a prompt or reply does not select or copy it. A drag copies the highlighted span, auto-writes the clipboard, and clears the inverse. `/copy` only targets assistant replies.

## Testing

`packages/tui/tui/tests/selection.spec.ts` covers display-column slicing, CJK partition without overlap, glyph-inclusive backward ranges, chrome stripping, skipping spacer rows, range order, and click-jitter vs drag. `copy-text.spec.ts` covers semantic extraction and Nth-latest `/copy`. `clipboard.spec.ts` covers OSC 52, dual-failure, stdin piping, Windows `clip` UTF-16 LE with BOM, and clipboard read. `render-frame.spec.ts` covers a bare click not copying or highlighting, drag-copy clearing inverse on mouse-up, a vertical drag that neither duplicates a line nor moves other rows, edge-drag auto-scroll into older history, wrapped composer rows keeping every glyph including line 0, caret arrows in a nonempty draft, history recall only on an empty draft, Ctrl+A then typing replacing the composer draft, `/copy` not calling `submit`, and wheel after a copy.
