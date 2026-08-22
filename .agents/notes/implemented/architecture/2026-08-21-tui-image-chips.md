# Agent Note: TUI Grok image chips and Web admission

Status: implemented

English | [中文](2026-08-21-tui-image-chips.zh.md)

## Problem

Web can paste, drop, and send images through `attachments.saveImage` and `commands.execute(..., images)`. The TUI only had `/attach <path>` and a count dock. Default DeepSeek catalog models are text-only; sending a picture without a check would hit the adapter as `UNSUPPORTED_CONTENT`. Grok's TUI uses path-free `[Image #N]` chips and Windows Alt+V because Windows Terminal drops bitmaps on Ctrl+V.

## Decision

Pending images are durable `ImageAttachmentRef` values on the surface. Composer paste of a single image path, or Alt+V (win32) / Ctrl+V bitmap tools (macOS/Linux), admits one file with Web's order: type, count, per-file size, total size — then `saveImage`. Success inserts `[Image #N]` for clipboard/path paste; `/attach` still queues on the dock without rewriting the slash line. Submit strips chips from model prose and refuses when the current route's `inputModalities` does not include `image`. `/settings` models marks those routes `· 图` / `· image`. Pixel overlay is a notice with name, intrinsic size, and bytes; Ink owns the alt screen so Kitty/iTerm inline graphics are not painted.

## Alternatives considered

### Why not put `/attach` chips in the slash-command draft?

`/attach` runs after the composer is cleared. Inserting a chip there swallowed the next `/fork` in the frame tests and is not how a slash command should leave the prompt.

### Why not render a Kitty graphics preview?

Ink repaints the alt screen every frame. A graphics protocol write would be overwritten or would desync the cursor. The dock line plus attach notice carry the same facts Grok shows in its overlay chrome.

## Consequences

Default `deepseek-v4-flash` / `deepseek-v4-pro` still refuse images until the catalog or `settings.yaml` declares `input: [text, image]`. Non-image file pastes stay as path text. Session jsonl is unchanged.

## Testing

`image-intake.spec.ts` covers chips, path classification, magic bytes, and Web batch order. `image-clipboard.spec.ts` covers platform commands and sniffed payloads. `settings-data.spec.ts` covers the vision marker. `render-frame.spec.ts` still routes `/attach`.
