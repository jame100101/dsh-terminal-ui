# Agent Note: Composer `@` workspace path completion

Status: implemented

English | [中文](2026-08-20-tui-at-file-mention.zh.md)

## Problem

Web has `@` file and session mention menus. The TUI only had `/` commands and `/attach` for images, so mentioning a workspace path meant typing it by hand.

## Decision

A trailing `@token` that is not a slash command opens the existing palette over cwd-relative files and directories. Tab or Enter replaces the token via `replaceAtToken`. Directories keep a trailing `/` so the picker stays open. Listings never walk above cwd (`pathIsInside`). At most 32 rows.

## Alternatives considered

### Why not port the Web mention graph (sessions, skills, `#`)?

The terminal has no clickable chips and no session sidebar. Path completion is the TUI-shaped mention. Session `@[title](dsh-session:…)` and `#` menus stay out.

## Consequences

Submitted text contains `@path` as ordinary draft characters. The model sees the path; there is no separate attachment unless the user also `/attach` an image.

## Testing

`file-mention.spec.ts` covers token parse, replace, containment, and listing. `render-frame.spec.ts` types `@` against `process.cwd()` and expects the file palette title.
