# Agent Note: TUI projections of Harness interactions

Status: implemented

English | [中文](2026-08-23-tui-harness-interaction-projections.zh.md)

## Problem

Harness already exposes agent-scoped user skills, structured question batches, and tool presentation metadata, but the terminal surface did not project them completely. Users had no bounded terminal catalog for user-invocable skills; `ask_user_question` submitted each page independently and lacked multi-select or multiline custom answers; successful editing tools had no compact turn-level deliverables summary.

## Decision

The TUI projects these capabilities through their existing owners without adding session events, protocol fields, or Agent Loop behavior.

The root slash catalog contains commands only. `/skills` opens a second, single-row-per-item picker populated asynchronously with user-invocable skills for the current agent and cwd. It refreshes on `skills/change` and ignores superseded reads after a session, preset, or workspace switch. Commands win same-name conflicts. Selecting a skill inserts literal `/name ` text; the existing skill pre-step plugin remains the sole owner of recognition, loading, injection, and logging.

The question takeover accumulates one answer per question and resolves the provider once after the final item. Single-select, checkbox multi-select, custom text, Shift+Enter newlines, and per-item Escape skipping use the existing `PendingQuestion` and answer fields. The TUI stores only transient navigation state while the question is pending.

The fold records compact tool-call presentation by call id until its result. A successful `diff` presentation, or a successful `generic` presentation whose kind is `edit`, contributes first-seen `locations` paths to the active turn. The turn tail renders one localized produced-files row before its statistics. Resume replay enriches the same call and result presentations before folding, so live and resumed rows agree. Failed tools, read-only presentations, and tools without locations contribute nothing.

## Alternatives considered

### Why not invoke skills directly from the renderer?

Direct invocation would duplicate the pre-step plugin's scope checks, invocation metadata, durable context injection, and command precedence. Literal insertion keeps the terminal a client of the shared behavior.

### Why not answer each question as soon as its page closes?

The provider request is one structured batch. Partial calls would change cancellation and validation semantics and could settle the interaction before later answers exist.

### Why not treat every tool location as a deliverable?

Read and search presentations also carry locations. Restricting the summary to the official mutation render intents avoids reporting inspected inputs as produced files.

## Consequences

Catalog discovery and session metadata remain off the first-paint path. Skill invocation, question settlement, and model-visible context keep their existing Harness ownership. The deliverables row is a deterministic transcript projection rather than a new durable fact; tools that do not advertise a mutation render intent remain absent from it.

## Testing

`render-frame.spec.ts` covers nested skill discovery, command precedence, one-row palette clipping, panel/composer row stability, question batches with single-select, multi-select, custom multiline text and Escape skipping, and Nth-latest message rating. `fold.spec.ts` covers successful mutation-path deduplication and exclusion of failed or read-only tool presentations. TUI package tests exercise the same projections under repeated Ink full-screen repaint.
