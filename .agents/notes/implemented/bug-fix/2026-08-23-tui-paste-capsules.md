# Agent Note: TUI paste capsules across terminal clipboard modes

Status: implemented

English | [中文](2026-08-23-tui-paste-capsules.zh.md)

## Problem

Terminal clipboard input does not always arrive through bracketed-paste markers, and clipboard providers may delimit lines with LF, CRLF, or bare CR. Treating only Ink `usePaste` events as paste left large ordinary input chunks expanded in the composer. Sanitizing bare CR before normalizing line endings removed every separator, so a multiline capsule could report one line.

## Decision

Ink bracketed paste remains the primary path. An ordinary input event also enters paste handling when the complete chunk reaches 1,000 Unicode characters or 20 logical lines; smaller chunks retain normal typing and IME behavior. Paste handling normalizes CRLF and bare CR to LF before terminal-control sanitization, counts the normalized logical lines, retains the complete sanitized text outside the visible draft, and submits that retained text when the capsule token remains present.

The dark-theme activity row uses `#4FC3F7` for every busy phase and `#4A90C4` for idle. The light theme keeps its existing named blue contrast behavior. Permission colors remain independent.

## Alternatives considered

### Why not require bracketed paste?

Bracketed mode is enabled, but terminal clipboard actions and intermediaries can still deliver one ordinary input chunk. Accepting only marked events makes capsule behavior depend on the terminal's delivery path.

### Why not preserve carriage returns in the general sanitizer?

The sanitizer also protects transcript and tool-output rendering, where carriage returns can reposition terminal output. Normalizing line endings only at paste intake fixes clipboard semantics without weakening other text surfaces.

## Consequences

Large session copies collapse consistently without changing small paste, IME, selection replacement, atomic deletion, image-path intake, or submission ownership. Clipboard line endings become LF in submitted text, matching the existing CRLF behavior. A deliberately generated single input event above either threshold is treated as paste.

## Testing

Unit coverage pins both thresholds and all three line-ending forms. Full-screen Ink coverage feeds an unbracketed 187-line bare-CR chunk, verifies the compact token and exact count, and confirms submission of the complete LF-normalized text. Existing bracketed-paste coverage retains the 628-line and exact-submission cases.
