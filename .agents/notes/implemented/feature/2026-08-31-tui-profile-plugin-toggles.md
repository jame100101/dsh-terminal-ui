# Agent Note: Transactional TUI profile plugin toggles

Status: implemented

English | [中文](2026-08-31-tui-profile-plugin-toggles.zh.md)

This decision partially supersedes the plugin-inventory portion of [Direct TUI controls and a read-only plugin inventory](../bug-fix/2026-08-17-tui-safe-plugin-switches.md); that note's other decisions remain current.

## Problem

The TUI plugin inventory showed Loader state but required leaving the interface to change a profile patch. Restoring the former direct switches unchanged would again expose composition containers, unstable generated ids, platform expressions, the TUI that owns the active screen, and providers whose removal leaves active consumers pending. A switch also needs to distinguish a persisted file write from successful Loader activation: reporting success after the write alone can leave the screen inconsistent with the running composition when HMR rejects the candidate.

## Decision

The standard `tui` profile supplies the TUI plugin with the absolute path of its watched `cordis.patch.yml` and the ids of host rows whose disabled state preserves agent-preset ownership. The plugins page collapses stable Loader leaves by bare id, preferring the root boot Include row over a same-id Agent preset leaf. Every displayed row remains selectable. `Enter` mutates only the unique root Include row outside the protected set; preset-only rows, conditional `disabled` expressions, and the active TUI report their fixed-state reason immediately instead of writing an unmatched profile patch. Include carriers, group trees, and generated or unsafe ids stay out of the list. Before disabling an enabled provider, the operation rejects the change when another active leaf injects a service from that provider. A bundle test keeps the protected set identical to the rows moved behind presets, so a new preset-owned tool cannot silently become a host-level switch.

Each action is serialized in the TUI host. It takes the profile file lock, performs a comment-preserving line edit, and replaces the file atomically. A one-operation Loader listener then waits for the selected entry to become an active fiber when enabling or to disappear when disabling. The listener consumes lifecycle dispatch rather than polling or installing a render timer. HMR rejection and bounded settlement timeout are failures. Failure restores the exact previous file only when a compare-and-swap check proves that no concurrent editor replaced the attempted text.

The renderer keeps the in-flight id in a ref, so keyboard repeat cannot enqueue a second toggle before React commits another frame. The existing notice update supplies the pending and final feedback; no animation, interval, whole-transcript projection, Agent Loop, session event, model request, or tool composition path is added. Disabled rows use the existing dim presentation and become bright again only after the settings projection observes the settled Loader state.

## Alternatives considered

**Make every visible Loader row a switch.** Rejected because structural rows and generated ids do not identify one durable patch target, conditional rows belong to deployment logic, and disabling a provider with active consumers can invalidate strict composition.

**Write the patch and report success immediately.** Rejected because file persistence does not prove that Loader accepted and activated the candidate tree.

**Poll Loader state from the renderer.** Rejected because a periodic timer would repaint the settings surface while idle and would still need a separate HMR-failure channel.

**Round-trip the patch through a YAML serializer.** Rejected because profile patches may contain comments and `!!js` expressions whose spelling must survive a single-row state change.

## Consequences

The standard TUI can enable or disable an eligible profile plugin without restart. A closed plugin row is dim and an opened row is bright after Loader settlement. Duplicate bare ids produce one stable settings row. Rows whose profile ownership, expression ownership, or dependency topology makes an in-process change unsafe remain selectable and report their fixed-state reason in the notice line on `Enter`. Agent-preset modes continue to own their tool composition rather than being overridden by a host-level settings action, and a preset-only id returns immediately instead of timing out against an unrelated root patch. Custom embeddings that omit `profilePatchPath` retain a selectable read-only inventory.

The operation edits only the explicit user profile layer and uses the launcher's existing watch/recompose mechanism. Concurrent file edits are preserved by the file lock and rollback comparison. The page does not promise that arbitrary plugin combinations will activate: Loader rejection is shown and the user's prior patch text is restored.
