# Agent Note: Bound TUI long-task retained roots

Status: implemented

English | [中文](2026-08-27-tui-long-task-retained-roots.zh.md)

## Problem

A long TUI session ended with a dsh child Node process at about 4 GB V8 heap and `Ineffective mark-compacts near heap limit`. The screenshot confirmed retained heap in that process, then a native fatal that skipped Ink teardown, leaving mouse tracking, bracketed paste, hidden cursor, and the alternate screen on the parent PowerShell.

Four TUI-owned retainers could grow for the lifetime of the process without a product cap:

1. Ink's input parser kept one `pending` string. A `ESC[200~` without `ESC[201~` swallowed later keys and SGR mouse reports into that string with no size or idle limit.
2. Interactive frames wrote to stdout without watching `write()` / `drain`. Windows fullscreen also cleared and rewrote the complete frame, so a slow ConPTY could queue obsolete screens.
3. Composer optimistic drafts were a `Set` of complete strings, and live fold still concatenated every assistant/reasoning delta after the visible body had already hit its cap.
4. The wrapper launched React with no `NODE_ENV`. React 19's development reconciler emitted User Timing measures for every changed component and prop, and Node retained them; a 20-second heap snapshot contained about 30,000 `PerformanceMeasure` objects and repeated `Changed Props` records.

Raising `--max-old-space-size` only delays the same retained-heap death. Official session logs stay append-only; this change does not rewrite them.

## Decision

The TUI Ink patch owns a bounded paste state machine: `normal` / incomplete CSI / `paste`. Paste bytes stay in a chunk list, and the end marker is matched incrementally across chunks. Product limits are 1 MiB of unfinished paste, 64 characters of unfinished CSI, and a 2 s idle timeout in Ink's App. A size abort records `limit`, releases the accumulated body, retains only the end-marker overlap, and discards subsequent paste chunks through `ESC[201~`; bytes after that marker return to ordinary key parsing. Idle timeout and `reset()` record their abort reason and return directly to normal input. Focus and suspend take the same reset path.

`runInk` enables `incrementalRendering`, `windowsFullscreenDiff`, and `coalesceBackpressuredFrames`. The last-column blank already makes Windows line diff safe; the patch therefore skips the Windows fullscreen `clearTerminal` path when that option is on and the terminal size is unchanged. A columns or rows change sets `pendingTerminalResets` to 2, drops the incremental line cache without `eraseLines`, and takes `clearTerminal` for the resize listener's stale-tree paint and the matching React commit. Same-size frames with 1–8 changed rows rewrite those rows with absolute CUP and an ASCII cell prefix. A height change or a larger delta still uses CUP 1;1 plus erase-down on Windows, not relative `eraseLines` or `cursorNextLine` walking, so ConPTY wrap and scroll cannot leave overlapping cells. `write()` returning false keeps a single pending redraw; `drain` renders the current tree against the last accepted frame.

log-update keeps the last mounted cursor until `useCursor` cleanup commits `undefined`, so a Transcript or StatusBar timer frame does not hide the IME caret. Thinking, compaction, pulse, and status motion use Ink's shared animation scheduler. Keyboard and paste events cancel a pending throttled animation render and request one immediate paint. Busy state writes a steady bar cursor style once per transition and restores the terminal default on idle, unmount, and launcher cleanup.

The status star advances at 250 ms with live think/text and 400 ms during quiet busy, so neither reasoning output nor a long PowerShell wait drives a 10 Hz status repaint. The live Thinking body retains one display-cell-bounded source suffix and consumes only each appended delta; a new line or non-append replacement resets that suffix. Its `  │ ` prefix is included in the row budget, so CJK or emoji tails cannot make Ink wrap the one-row Box and overwrite its neighbor.

`dsh-tui` writes an idempotent parent-process reset after every interactive child exit, including native fatals: mouse 1000/1002/1003/1006 off, bracketed paste off, show cursor, leave alternate screen, SGR reset. Print mode does not write it.

The wrapper sets `NODE_ENV=production` in the dsh child before any React or Ink import. Production React omits the development User Timing stream; the automated 3,000-node, 25 Hz ConPTY fixture reached 250.3 MB peak RSS over two minutes and plateaued after warm-up, whereas the same source graph previously reached 608.0 MB and continued rising over two minutes. Repository evaluators remain outside the shipped launcher and package runtime.

Composer display reads local draft state. App-originated assignments bump `draftSeq` so submit, history, palette, and chip rewrites still win. `onChange` keystrokes do not bump that counter, so a lagging parent echo cannot replace the latest draft or jump the caret. Live fold skips concatenating a text or reasoning delta once that body is already at cap, and a coalesced UI publish is skipped when `live` and `nodes` stay the same objects. Todo and goal docks keep styled runs through cell-safe truncation: pending/completed are `#C9B84A` / `#3FB950`, separators are `#666666`, and goal title/body are `#61D6D6` / `#A7A7A7`. Shift+Tab changes permission synchronously for each legacy report and accepts only the `press` event from Kitty's press/repeat/release reports, so a physical key cannot enqueue a permission rotation that appears during a later prompt or busy repaint. Resume publishes phase-zero progress and installs cancellation before the authoritative session-log read, then updates the total and begins fold replay after the read resolves.

## Alternatives considered

**Raise V8 `--max-old-space-size`.** This enlarges the same retained set and the machine-wide pressure. It is not a bound.

**Replace Ink with pi-tui or OpenTUI in this change.** Those renderers still need a bounded paste parser, latest-frame output, and a parent-process reset. Swapping the tree does not close the crash retainers.

**Return to ordinary keys immediately after a size abort.** A continuously arriving oversized paste would then turn every later chunk into composer input and rebuild the same memory pressure outside the parser. Size abort instead stays in a zero-body discard mode until the bracketed-paste end marker; timeout and reset may return directly to ordinary input.

**Keep `pendingLocalValues` as a `Set` of every in-flight draft.** That is the unbounded intermediate-string retainer. A single local draft plus `draftSeq` is enough for echo vs authoritative overwrite.

**Publish every saturated assistant chunk.** The visible body is unchanged, so the publish is wasted React/Ink work on the same output path the long task already starves.

**Keep Ink's width-shrink `eraseLines` and paint immediately in the resize listener.** ConPTY reflows the existing cells before Ink writes. `eraseLines` then uses the previous line count against that reflowed buffer, so permission/status fragments land in the transcript. Painting immediately also uses the React tree that still holds the old Box width/height.

**Disable `windowsFullscreenDiff` after the overlap.** That restores a clear on every busy frame and reopens the 4 GB stdout-queue path.

**Keep per-line `cursorNextLine` walking or relative `eraseLines` on Windows fullscreen.** A CJK or wrap mismatch in one earlier frame desynchronizes every later skip, which is the duplicate Thinking/permission overlay. Absolute CUP + ED does not inherit that cursor.

**Treat `cursorDirty` as the only source of cursor intent.** A StatusBar or Transcript timer frame would hide the IME caret until the next keystroke.

## Consequences

Missing paste-end, slow stdout, React development measures, and long live streams no longer have a TUI-owned path to an unbounded retained string, measurement list, or frame queue. The TUI's explicit `windowsFullscreenDiff` option makes same-size frames with 1–8 changed rows use absolute CUP plus an ASCII cell prefix; a height change or a larger delta rewrites from CUP 1;1 plus erase-down on Windows so ConPTY wrap cannot keep stale cells, while other Ink incremental surfaces retain the upstream relative renderer. Tool rows pair by `callId` and take `isError` from the tool-result block; Code Mode sub-dispatches fold as child rows. Transcript wheel reuses a memoized height prefix sum and coalesces ticks in one microtask. Panel refreshes are scoped, so the one-second jobs poll no longer reads subagent descendants or the persisted session/title corpus. The official session event log remains the process memory floor; the TUI does not rewrite it. A TUI projection sidecar stores only complete idle-turn folds under `$DSH_HOME/tui/projections/` and retains at most one pending write per session. Resume folds the cached suffix or full log while the current session stays visible, then swaps the session and fold together; phase-zero cancellation works during the initial read, cancellation disposes the prepared handle, and composer drafts stay local until replay finishes. Shift+Tab paints a local pending permission chip until the sandbox snapshot catches up. Todo/goal docks keep glyph and label text and color by status/phase. The production launcher and bundled TUI contain no performance logger or viewer. Repository-only `evaluation/tui/run-with-perf.mjs` samples a normal launch into a temporary log, `conpty-soak.mjs` automates the Windows terminal/build campaign, and `soak.mjs` advances one persistent fold, parser, and append-only event list; runtime assembly rejects stale diagnostic chunks and markers.

## Testing

The permission regression feeds Kitty Shift+Tab press/repeat/release reports and requires one rotation. The real-PTY busy fixture then submits Chinese composer text and continues 25 Hz Thinking/todo/goal updates while the selected permission remains unchanged.

`packages/tui/tui/tests/ink-input-parser.spec.ts` covers complete paste, split end marker, missing end plus keys/mouse, zero-body drain after a size abort, oversized complete paste, CSI overflow, and reset. `ink-output-arbiter.spec.ts` covers backpressure coalescing, immediate input paint under a one-frame-per-second animation throttle, Windows fullscreen without `ESC[2J` at a stable size, resize reset, and same-size CJK row diff. `wrap.spec.ts` pins incremental no-newline Thinking tails, replacement detection, line resets, cell bounds, and bounded retained suffixes. `render-frame.spec.ts` covers dense transcript resize, CJK rewrite, a one-row long live-Thinking tail, late bare `[Z`, and local drafts during replay. `terminal-pty.spec.ts` drives a 25 Hz busy fixture through a real PTY and pins Chinese edit/submit, live Thinking/todo/goal paint, Shift+Tab, PageUp/PageDown, output size, and interaction latency. `status-color.spec.ts`, `cursor-style.spec.ts`, and permission tests pin exact dock runs through truncation, the busy/exit cursor sequences, and synchronous one-press rotation. `soak-budget.spec.ts` drives cumulative fold, parser, and session-log work. Launcher tests cover terminal restore, production child environment, ordinary diagnostics, and package exclusion of performance markers. `process-tree.spec.ts` pins repository evaluator parsing, bounded descendant walks, and deduplicated tree totals. `evaluation/tui/conpty-soak.mjs` automates typing, deletion, history paging, permission rotation, Thinking cadence, process memory, and repeated real builds. Fold and projection-sidecar tests retain the saturated live, tool callId/result, Code Mode, replay abort, checkpoint, corruption, and size-cap coverage.
