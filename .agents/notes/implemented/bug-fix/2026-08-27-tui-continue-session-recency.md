# Agent Note: TUI continuation uses foreground session recency

Status: implemented

English | [中文](2026-08-27-tui-continue-session-recency.zh.md)

## Problem

`dsh-tui -c` selected a persisted session in the current working directory by `SessionHeader.createdAt`. Reopening an older conversation did not make it the next continuation target, and a newly persisted background subagent could outrank the conversation the user had actually kept in the foreground. The launcher and inner argument parser already transmitted `--continue` correctly; the missing information was TUI use order.

## Decision

The TUI owns a bounded navigation sidecar at `$DSH_HOME/tui/session-recency.json`. It remains separate from the authoritative session log because foreground navigation is surface state and never enters a model request. Each record identifies one exact lifecycle by session id, `createdAt`, and normalized creation cwd, then stores a monotonic wall-clock-derived `lastUsedAt` value. The `sessionRecencyMaxEntries` plugin setting controls the bound and defaults to 1,000 records.

The TUI records use after a successful explicit resume, an admitted user message, or an accepted host command. Background session events, streamed chunks, tool progress, todo/goal changes, and subagent creation do not update the index. In-process writes queue behind one promise; cross-process writers use `withFileLock`, re-read under the lock, retain the newest bounded set, and publish through `writeFileAtomic`. Reads remain lock-free. A malformed sidecar is reported, contributes no ordering evidence, and is rebuilt by the next successful write; a sidecar fault does not roll back the foreground action.

`--continue` first filters the authoritative corpus to persisted, non-live sessions whose normalized cwd matches the current directory. Exact lifecycle observations rank those candidates by `lastUsedAt`, with deterministic creation-time and id tie breaks. If the directory has no matching observation yet, migration chooses the newest top-level session by creation time. An untouched `origin: 'subagent'` session stays out of that fallback; explicitly resuming it records foreground use and makes it eligible thereafter.

## Alternatives considered

**Add mutable use time to `SessionHeader`, a session event, or the persistence schema.** Foreground navigation is neither durable conversation content nor model-visible state. Putting it in Harness persistence would widen every backend and replay surface for a TUI-only fact.

**Use the newest session event or artifact modification time.** Background tools, goal rounds, subagents, persistence repair, and unrelated file writes can advance those times without foreground selection. They measure activity, not the user's last TUI session.

**Keep ordering by creation time and exclude subagents only.** That removes one incorrect winner but still fails after the user returns to an older conversation.

## Consequences

Existing installations have no sidecar initially, so their first continuation in each directory keeps a deterministic newest-top-level migration result. Subsequent resumes follow foreground use order across TUI processes. Deleting the sidecar resets only this navigation order. The Agent, session log, provider request, tool dispatch, and Harness persistence formats remain unchanged.

## Testing

`packages/tui/tui/tests/startup.spec.ts` covers foreground recency, exact lifecycle and cwd matching, migration, and subagent eligibility. `packages/tui/tui/tests/session-recency.spec.ts` covers missing and malformed files, normalized writes, monotonic retouch, cross-writer merging, pruning, and cwd-less headers. The existing startup-argument and launcher translation tests keep `-c` transmission independent from selection policy.
