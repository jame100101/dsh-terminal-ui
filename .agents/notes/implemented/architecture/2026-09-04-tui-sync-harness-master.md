# Agent Note: Sync latest harness master onto the TUI fork without plugin extraction

Status: implemented

English | [中文](2026-09-04-tui-sync-harness-master.zh.md)

## Problem

The public TUI history was rewritten, so `git merge` from `deepseek-ai/deepseek-harness` has no native merge-base. The product tree last matched harness `dsh-v0.1.1-rc.2`. Remaining on that baseline would keep TUI calling `session.events`, `settingsNamespace`, `healProfilesModuleFallback(anchor, home)`, `meta.seedLength`, and `CallId`, all of which the current harness replaced. Plugin extraction of dsh-tui is a later change; this sync must keep the bundled runtime.

## Decision

Treat `dsh-v0.1.1-rc.2` (`b150a551b8`) as the content ancestor of local `main` and merge `upstream/master` (`76fda729`, workspace `0.1.2-rc.1` plus the http-proxy RC version fix). Keep the TUI-only layer (`packages/tui`, `packages/bundle/tui-app`, `apps/tui-cli`, Ink patch, TUI README). Take harness core from upstream. Re-apply TUI integration as current-API patches: `PROFILE_TEMPLATES.tui` as a `{ bundles, patchReload: 'live' }` template, host tsconfig paths, CLI `dsh-tui-app` dependency, root `dsh-tui*` scripts, and the Ink patch next to pkg/node-pty.

TUI consume patches follow the new harness APIs: `snapshotEvents()`, `isSeeded` plus `inheritedEventCount`, settings namespace strings, `user-questions/request` waterfall, `healProfilesModuleFallback({ installAnchor, home })`, and `ToolCallId`. The tui-app overlay disables `command-goal` with the other preset-owned rows, drops duplicate storage inserts now owned by `dsh-base`, and mounts `@deepseek-ai/dsh-tool-subagent/model-selection-settings` on the host plane so standard/ptc/cordis presets can mount. `assemble-runtime` still copies the CLI dependency closure; it is not rewritten.

## Alternatives considered

### Why not `git merge` without a content ancestor?

The TUI public baseline rewrite has no merge-base with upstream. An unrelated-histories merge treats every file as add/add. Grafting `HEAD` onto `dsh-v0.1.1-rc.2` for the merge computation replays the actual 0.1.1-rc.2 → master delta against the TUI layer.

### Why not start plugin extraction now?

Removing `apps/tui-cli/runtime`, switching to peerDependencies-only, or splitting a separate repo would mix two migrations. This change is the last full bundled-runtime harness sync; extraction is a later change.

### Why not keep `session.events` and `seedLength` in TUI?

Those fields are gone from Session and CreateAgentOptions. Copying the old harness core would reject the upstream persistence and fork contracts.

## Consequences

The product tree's harness version is `0.1.2-rc.1` at `76fda729`. TUI-only paths remain. Shipped presets are `standard`, `ptc`, `minimal`, and `cordis` (`code` is gone). Fork children record `isSeeded` and `inheritedEventCount`. JSONL sessions stay `SESSION_FORMAT_VERSION = 0`. The published `dsh-tui` wrapper still assembles a bundled runtime.

## Testing

`pnpm exec tsc -b tsconfig.host.json` plus host/client tsdown, `pnpm exec vitest run packages/tui/tui packages/bundle/tui-app apps/tui-cli` (510 passed, 1 skipped), `node apps/tui-cli/scripts/assemble-runtime.mjs` (231 packages), and `node apps/tui-cli/bin/dsh-tui.js --version` cover the overlay and the consume patches (`preset-composition.e2e.spec.ts` fork/resume/jobs/workflows, `agent-plane-parity.spec.ts`).
