# Agent Note: TUI Grok image chips and Web admission

Status: implemented

English | [中文](2026-08-21-tui-image-chips.zh.md)

## Problem

Web can paste, drop, and send images through `attachments.saveImage` and `commands.execute(..., images)`. The TUI only had `/attach <path>` and a count dock. A text-only model route rejects image content. Grok's TUI uses path-free `[Image #N]` chips and Windows Alt+V because Windows Terminal drops bitmaps on Ctrl+V.

## Decision

Pending images are durable `ImageAttachmentRef` values on the surface. Composer paste of a single image path, or Alt+V (win32) / Ctrl+V bitmap tools (macOS/Linux), admits one file with Web's order: type, count, per-file size, total size — then `saveImage`. Linux/macOS Ctrl+V falls back to text paste when the desktop clipboard has no image. Success inserts a host-assigned `[Image #N]` for clipboard/path paste; `/attach` still queues on the dock without rewriting the slash line. Backspace/Delete treats a chip as one edit, deleting a chip removes its attachment, and remaining chips are renumbered without dropping `/attach`-only entries. Submit strips chips from model prose and checks the exact provider/model route before refusing a model whose `inputModalities` omits `image`. `/settings` models uses the same route identity and marks image-capable rows `· 图` / `· image`. `/image [N]` shows the pending image name, intrinsic size, and byte count; Ink retains ownership of the alternate screen, so the fallback does not write a terminal graphics protocol outside its repaint lifecycle.

## Alternatives considered

### Why not put `/attach` chips in the slash-command draft?

`/attach` runs after the composer is cleared. Inserting a chip there swallowed the next `/fork` in the frame tests and is not how a slash command should leave the prompt.

### Why not render a Kitty graphics preview?

Ink repaints the alt screen every frame. A graphics protocol write would be overwritten or would desync the cursor. The dock line plus attach notice carry the same facts Grok shows in its overlay chrome.

## Consequences

The official catalog exposes `deepseek-v4-flash-vision-exp` as an image route; `deepseek-v4-flash` and `deepseek-v4-pro` remain text routes unless settings replace their declared modalities. Non-image file pastes become absolute path text. Session jsonl stores the same durable image blocks used by Web.

## Testing

`image-intake.spec.ts` covers atomic chip deletion, mixed chip/path-only reconciliation, provider/model identity, path classification, magic bytes, and Web batch order. `image-clipboard.spec.ts` covers platform commands and sniffed payloads. `image-submit.spec.ts` proves that ordinary turns carry durable image blocks and slash commands read and encode the stored bytes. `settings-data.spec.ts` covers exact-route default and vision markers. `render-frame.spec.ts` keeps `/attach` and the remaining local command routes independent.
