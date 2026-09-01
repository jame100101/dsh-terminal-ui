# Agent Note: TUI restores session-owned routes and projections

Status: implemented

English | [中文](2026-08-31-tui-session-owned-projections.zh.md)

## Problem

Resume and fork operations could reuse the currently displayed model selection even when the target log or fork seed had a different request route. The jobs panel also read the process registry without an Agent owner, and workflow rows treated process-global lifecycle events as authoritative even though those events do not identify their parent session.

## Decision

The TUI reconstructs model and reasoning selection from the latest canonical `request/header` in the target log, or from the seed prefix for a fork, with the deployment default as the legacy fallback. The mutable request hook is installed during resumed-Agent setup, and the exact recorded route plus its reasoning levels must resolve before the replacement Agent can publish. A fork crosses an explicit session flush barrier before its temporary live handle is disposed, so the returned id already names a readable cold artifact.

Jobs are projected through `jobs.list(surface.agent)` and refreshed from `onJobsChanged`; exact Agent identity filters foreign-owner notifications while unowned changes remain visible. Workflow rows are folded from the current Session's durable `tool-workflow/*` events for both replay and live delivery, following the parent-session recording decision in [durable workflow runs in chat](../feature/2026-08-10-durable-workflow-runs-in-chat.md). Process-global workflow events have no parent Session identity and are not consumed by the panel. New sessions clear the projection and resumed sessions replay it before surface adoption.

## Alternatives considered

**Reuse the surface selection during resume or fork.** Rejected because the visible session is not the authority for another log or a seed boundary; it can silently route the next request to the wrong provider, model, or effort.

**Use process-global workflow lifecycle events as the row store.** Rejected because `WorkflowRunInfo` has no parent-session identity, so a concurrent Agent can contaminate the current panel. Durable parent-session events already provide the required ownership fence.

**Add workflow state to the transcript sidecar.** Rejected because workflow records are a small independent projection; coupling them to fold cache schema would add migration and invalidation work without improving ownership or replay semantics.

## Consequences

Target session history, model routing, reasoning metadata, jobs visibility, and workflow rows now cross the surface swap together without changing core APIs or session format. Route resolution, preparation, or replay failure disposes the replacement while the old surface remains subscribed. Ephemeral process-global workflow phase and log text is intentionally excluded because it cannot prove parent-session ownership. A deployment with no preset roster and a legacy log still uses its current default route, while recorded preset and request-header data remain authoritative when present.

## Testing

Pure tests cover canonical latest-header and legacy fallback selection, owner-scoped job projection and elapsed values, durable workflow lifecycle folding, out-of-order delivery, exact Session isolation including a colliding subagent run id, and session reset/replay. Assembled tests create and immediately read default and switched fork artifacts, verify mounted composition and durable metadata, route an actual post-resume request through the target provider/model/effort, reject a retired recorded route before publication, exercise real JobRegistry ownership and notifications, prove two real Agent workflow streams share the process-global lifecycle while only the current Session projects, reconstruct persisted workflow history on resume, and verify cancellation plus preset/replay failures leave the old Agent intact. The full TUI test suite runs against the source TUI without changing harness packages.
