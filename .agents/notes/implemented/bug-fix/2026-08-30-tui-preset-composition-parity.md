# Agent Note: TUI preset composition follows Web ownership

Status: implemented

English | [中文](2026-08-30-tui-preset-composition-parity.zh.md)

## Problem

The TUI exposed the shared agent-preset selector but retained every base agent-plane row. Startup also created an agent without resolving or mounting the roster default. Selecting `minimal` therefore changed the recorded id and preset scope while the base `compact`, `plan`, tools, skills, and prompt contributors remained visible. The effective composition was the base agent plus the selected preset rather than the host plane plus one selected preset.

The TUI switch path also checked for `turn/start` before asynchronous recomposition without serializing concurrent selections. A prompt could be admitted after that check and before the turn event appeared, allowing a preset change to race the first model request.

## Decision

The TUI bundle disables the same preset-owned base rows as the Web bundle. Shared registries, providers, persistence, policy, token metering, the code runtime, and the Cordis host runner remain on the host plane. A parity test compares the bounded disabled sections so ownership changes in either interactive bundle cannot drift silently.

Agent creation resolves `agentPresets.resolve(requestedId)` before creating the session, passes the resolved id to `mount`, and writes that id into the immutable header. Startup resolves the roster default; `/new` continues the newest selection or header and falls back to the current default; resume uses the newest selection event, then the header, then the current default for metadata-free old sessions. That fallback is recorded as a selection event so a later default change does not reinterpret the migrated session.

Preset switches and prompt admission share one per-session promise queue. The blank-session check runs inside the queued switch. An accepted prompt claims the session inside its queued operation before the next switch can check blank state, without depending on when agent-loop publishes `turn/start`; a switch queued first commits before the prompt. `recompose` remains the atomic composition operation, and the TUI appends `agent-preset/selected` only after it succeeds; rejection leaves composition, log, catalogs, and current marker unchanged.

## Alternatives considered

**Remove stale commands and skills in the renderer after selecting `minimal`.** Rejected because commands and skills are only symptoms; base tools and prompt sections would still reach the model, and every new preset would require another presentation-specific denylist.

**Recreate the agent for each blank-session selection.** Rejected because `AgentPresets.recompose` already prepares the target before atomically re-linking the existing agent scope. Recreating the agent would change session identity and duplicate lifecycle behavior that Web does not use.

**Check only the durable `turn/start` event.** Rejected because prompt admission and event publication are separate operations. Sharing the queue and recording an admission claim preserves user order without changing agent-loop or the session event format.

## Consequences

The current marker, session record, scoped catalogs, prompt assembly, and effective tools all derive from the same mounted preset. Standard-to-minimal removes preset-owned commands and local skill discovery; switching back restores them; code and Cordis selections activate their actual model-facing capabilities. A deployment without a preset roster can still create a metadata-free agent, but it rejects resuming a session that records a preset it cannot reconstruct.

The queue is process-local because it protects live TUI operations; the logged selection remains the durable authority. A process terminated between a successful recompose and its immediately following append has the same narrow crash window as the Web handler, while an ordinary rejection records nothing.

## Testing

The focused TUI lifecycle tests cover default resolution, rosterless handling, queue order, rejection recovery, prompt-before-switch locking, switch-before-prompt ordering, and durable conversation locking. The assembled TUI composition test boots the real base and TUI bundle patches, verifies default header and mount identity, exercises standard → minimal → standard commands, skills, tools, and prompt assembly, checks code and Cordis capabilities, rejects an invalid preset without mutation, serializes rapid real recompositions, carries the current preset into a new session, and resumes both recorded and metadata-free sessions. The bundle parity test compares the Web and TUI preset-owned disabled rows and pins TUI-specific host runtimes.

## Related

Preset scope ownership originates in [per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.md) and [host-plane ownership after presets](../architecture/2026-08-10-host-plane-ownership-after-presets.md). Catalog refresh after a committed switch remains owned by [the slash catalog follows a blank session's preset switch](2026-08-10-slash-catalog-follows-preset-switch.md).
