# Agent Note: Composer `@` workspace and session completion

Status: implemented

English | [中文](2026-08-20-tui-at-file-mention.zh.md)

## Problem

Web has `@` file and session mention menus. The TUI originally required users to type workspace paths and cross-session identifiers by hand, even though Harness already owned file discovery, canonical session mentions, and durable cross-session context preparation.

## Decision

A trailing `@token` that is not a slash command opens the existing palette. Workspace-relative files and directories appear first; Tab or Enter replaces the token through `replaceAtToken`, directories keep a trailing `/`, listings never walk above cwd (`pathIsInside`), and at most 32 file rows are shown. Other sessions come from `sessionReferenceResolver.listCandidates` in the current agent scope after a short debounced lookup. Selecting one inserts the Host-formatted `@[label](dsh-session:...)` mention.

The TUI bundle mounts `@deepseek-ai/dsh-session-reference`. That existing pre-step plugin parses canonical session mentions and prepares bounded, durable, read-only session context. The TUI owns discovery and draft insertion only; it does not parse session logs or add another model-input path.

## Alternatives considered

### Why not add TUI-specific cross-session parsing or Agent Loop injection?

The session-reference service already owns identifier encoding, candidate limits, cancellation, snapshot preparation, durability, and model-visible context. A second implementation would diverge from Web and other front doors.

### Why not merge session candidates into filesystem traversal?

Files are cwd-scoped paths while sessions are durable identities with titles and optional workspaces. Keeping the candidate sources separate preserves their ownership and lets slow persisted metadata lookup remain asynchronous.

## Consequences

Submitted file mentions remain ordinary draft characters. Canonical session mentions are recognized by the mounted Harness plugin and produce reconstructable session-reference context. Superseded asynchronous session searches are discarded, so a late result cannot replace candidates for newer input.

## Testing

`file-mention.spec.ts` covers token parsing, replacement, containment, and listing. `render-frame.spec.ts` covers workspace candidates and an official session mention insertion. The session-reference package tests retain authority for canonical URI parsing and durable context preparation.
