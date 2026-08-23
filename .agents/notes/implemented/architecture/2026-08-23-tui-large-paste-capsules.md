# Agent Note: TUI large-paste capsules

Status: implemented

English | [中文](2026-08-23-tui-large-paste-capsules.zh.md)

## Problem

Terminal bracketed paste and the clipboard shortcut inserted a large body directly into the visible composer draft. The five-row caret window bounded painted rows but still retained and rewrapped the complete body during every edit and repaint. The former hard-newline preview also hid ordinary typed multi-line drafts, did not cover long soft-wrapped pastes, and replaced no input in the submission path.

## Decision

A single paste of at least 1,000 Unicode characters becomes a short `[Pasted text #N +M lines]` token in the composer. The App retains the exact sanitized text outside the visible draft and expands complete tokens before slash-command dispatch, queue/steer handling, input-size validation, and model submission. Both terminal bracketed paste and explicit clipboard text paste enter the same path. Image and file-path classification runs first, so attachment behavior remains independent.

The token is one deletion unit for Backspace and Delete. Removing or editing a token releases its retained text, and clearing the draft resets numbering. Ordinary typing and smaller pastes retain the standard five-row caret window; hard-newline count does not activate a second composer layout.

## Alternatives considered

**Collapse only by hard-newline count.** Long minified content and soft-wrapped prose still impose the full draft cost, while a short four-line hand-written draft is hidden unnecessarily.

**Replace the paste permanently with a summary token.** The model and registered commands would lose the user's source text.

**Keep the full body in hidden draft markup.** Cursor offsets, selection, width calculation, and image-chip reconciliation would still traverse the large text and would require a second parser inside the editor.

## Consequences

The capsule is presentation state only. No Agent Loop, session event, runtime protocol, or persisted message format changes. Once submitted, the existing host path receives the same expanded text it would receive from an ordinary paste, subject to the existing outer whitespace and input-size rules. A token that is only partly preserved is treated as ordinary visible text rather than silently recovering detached content.

## Testing

Pure unit tests pin the Unicode threshold, line count, token expansion, lifetime, and atomic deletion. The Ink full-screen render test drives bracketed paste through the production input hook, verifies the 628-line capsule, and verifies that Enter submits the retained body. Composer viewport tests pin ordinary multi-line behavior after removal of the hard-newline preview.
