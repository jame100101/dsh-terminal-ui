# Agent Note: Direct TUI controls and a read-only plugin inventory

Status: implemented

English | [中文](2026-08-17-tui-safe-plugin-switches.zh.md)

The plugin-inventory decision below is partially superseded by [transactional TUI profile plugin toggles](../feature/2026-08-31-tui-profile-plugin-toggles.md). Its rejection of unguarded all-entry switches remains current; the Thinking, command-choice, and locale decisions remain current in full.

## Problem

The TUI plugin page exposed Loader entries as live switches even though the surface could not prove every composition dependency or preserve every conditional patch expression. A write could therefore leave required consumers pending and make the next strict startup reject the profile. Filtering the page down to a small set of apparently independent leaves also hid most of the composition and still presented plugin mutation as a reliable in-process operation. Separately, `/effort` appeared in the slash palette but still required a memorized free-text argument.

Transcript disclosure controls were tied to an idle Tab selection mode: arrows moved a selected message, Space expanded it, and `g`/`b` rated an assistant message. That mode competed with composer input and gave Thinking rows local overrides even though the header and settings page described Thinking as one global display preference.

## Decision

The plugin page is a complete read-only projection of the Loader plugin rows. It shows enabled, disabled, loaded, and unloaded state but exposes no Enter action, config-editor shortcut, patch write, or optimistic state. Its footer names `$DSH_HOME/profiles/<profile>/cordis.patch.yml` as the enable/disable source and tells users they may edit it directly or ask the Agent to update it. Include/group structural rows remain excluded because they are composition containers rather than plugin entries. This keeps composition mutation in the explicit configuration workflow without changing Loader or Harness startup semantics.

Transcript rows carry disclosure metadata only on the wrapped line that owns a trailing `▶` or `▼`. Mouse hit testing uses the same bottom-aligned, scroll-offset-aware viewport calculation as rendering. Context, tool, and retry arrows toggle their node. Any Thinking arrow writes the global `thinking: collapsed|expanded` setting, so every settled Thinking row and the header's `thinking on/off` label change together. Idle Tab transcript selection and its arrow, Space, and `g`/`b` bindings are removed; Tab remains available to slash palettes and settings tabs, Shift+Tab retains its permission action, arrows retain composer history navigation, and Space remains draft input.

The slash palette keeps one selectable root row for every command. Commands with a finite argument set may expose a nested palette; `/effort` is the first such command and offers exactly `off`, `high`, and `max`. Commands whose arguments are paths, titles, or other free text retain composer completion.

English mode localizes every renderer-owned panel, transcript-status, structured tool-card, notice, help, and linear-fallback label. User, model, tool-output, workflow-log, title, and objective payloads remain byte-for-byte content rather than translation targets.

## Alternatives considered

**Keep a filtered set of in-process switches.** Rejected because dependency inspection cannot prove undeclared behavioral dependencies or safely override every conditional patch layer, and filtering hides most of the composition.

**Show protected providers as locked switches beside mutable leaves.** Rejected because identical switch styling gives two different interaction contracts and still encourages configuration edits from a partial Loader view.

**Keep per-row Thinking overrides or keyboard selection beside direct controls.** Rejected because the overrides conflict with the persisted global setting, while the selection mode reserves ordinary composer keys for a second expansion authority.

**Represent every slash-command argument as a predefined choice.** Rejected because paths, titles, filters, and extension-contributed commands do not have a finite inventory.

## Consequences

The plugin page again shows the full plugin roster without implying that the TUI can safely mutate the composition. It performs no profile write and cannot create a pending dependency tree. Configuration remains available through the profile patch file and through an Agent request that edits the same explicit source.

Thinking disclosure now has one persisted authority across all rows, the header, and settings. Non-Thinking rows retain individual expansion through direct arrow clicks. Removing transcript keyboard selection also removes the TUI message-rating shortcut, while feedback display and storage remain unchanged. The nested choice mechanism is reusable for future finite command arguments, while free-text command behavior and command dispatch remain unchanged. No Agent Loop, session protocol, model request, or non-TUI surface behavior changes.

Locale changes now cover both Ink and the non-TTY fallback while preserving payload text. English regression fixtures reject Han characters only in renderer-owned copy assembled from English-only fixture data.
