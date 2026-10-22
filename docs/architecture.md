# Plugin architecture

English | [中文](architecture.zh.md)

## Summary

This standalone out-of-tree plugin repository owns the terminal interface. Official `@deepseek-ai/dsh@0.2.1-rc.2` owns agents, tools, presets, session persistence, jobs and workflows.

## Composition

Official dsh loads the plugin through public Harness/Cordis APIs. The Harness adapter drives TUI state and projections, which feed the React/Ink frontend. The bundle patch selects the TUI profile composition; the optional thin launcher translates flags to official dsh.

Only the TUI implementation and launcher/packaging workspaces are local. Harness packages are exact npm development dependencies and production peers. The tarball bundles patched Ink alone and installs its React dependency normally so both renderers share one React runtime.

## Development

`pnpm build:lib:host` typechecks and bundles the TUI, with Harness imports external. `pnpm build:lib:client` checks the complete TUI declaration context and builds the React/Ink frontend into an unpublished verification directory. There is no Harness web client build. `pnpm typecheck` checks production TypeScript; Vitest executes all TUI and launcher fixtures.

Vitest resolves public const-enum declarations with the TypeScript checker before isolated transpilation. This reproduces normal TypeScript inlining without a runtime shim or copied enum implementation. Tests load official CLI and base-patch assets through package exports, use public profile initialization, and flush durable fixtures explicitly.

## Maintenance

This repository does not vendor or synchronize full Harness source. A future Harness update changes dependencies and adapter compatibility evidence, not an upstream merge. The [dependency audit](dependency-audit.json) records every baseline package and directory classification. Runtime ownership and package boundaries are described above.

## Exact development compatibility notes

The adapter consumes public `agent/assistant-stream` frames only for the active Agent. Durable assistant settlements replace transient text and expand their embedded stream for deterministic replay; transient frames are never appended to Session storage. Nested tool cards use the current `tool/ptc-dispatch*` events. The projection cache version changes with these semantics.

The development lockfile is regenerated when upgrading Harness, including auto-installed peers. Repository closure rejects every Harness version outside the exact rc.2 graph so the JSONL backend cannot bind to a stale persistence API. The welcome whale uses static antialiased blue/white cells; the one-cell `❯` prefix and deduplicated counters do not change input handling.

Official CLI compatibility is `@deepseek-ai/dsh@0.2.1-rc.2`. Its npm ranges currently select Harness subpackages `0.2.1-rc.2`; development dependencies and plugin peers match that graph. Cold fork reads use public `observeSession`, copy the immutable cut, and dispose the lease, avoiding the seed-construction path of `readSession`. The official `minimal` preset exposes its persistent shell and image reader; the host supplies working-directory control and the standard preset retains the broader file tools.

The welcome whale keeps its 52 × 20 half-cell canvas and transparent silhouette. Solid cells paint matching foreground/background colors to cover font leading on macOS. On macOS, the scrollbar uses the same technique in its existing anchored column, with a muted track in both themes; Windows/Linux keep the original dim track and themed thumb. Art remains precomputed; no timers, image dependencies, or full-frame redraws are added.

On macOS, the Ink serializer emits a background-colored space for a colored scrollbar marker, eliminating block-font edge overhang. The original absolute column, style and geometry remain intact. Windows/Linux retain their exact block-glyph output, and monochrome macOS keeps the visible block fallback. Platform-table tests exercise the installed serializer, with PTY tests checking the painted cell and blank safety column.

## Harness rc.2 integration / 宿主适配

The exact development target is `0.2.1-rc.2`, with Cordis `4.0.5`. The default npm channel remains a separate, unverified target. Preset declarations come from the public MIT-licensed `@deepseek-ai/dsh-web-app/presets/*.patch.yml` exports. Packaging copies declarative YAML only and disables `tool-schedule`, whose official service requires the browser Connection; scheduling is unsupported in this terminal composition. Runtime implementations remain external. The registry selects presets atomically; jobs are scoped by Session ID. Settings use volatile plugin Config and the official profile editor. Session directory changes use `workingDirectory.set`; they never mutate the process directory or sandbox roots. The obsolete no-op runtime invariant companion is removed, while lifecycle and isolation regression tests remain.

Install the unpublished local tarball with a temporary host; [validation and rollback](../README.md#isolated-development) do not upgrade a global installation or production home. Published npm `0.2.2` is a different artifact and does not establish alpha compatibility.

Phase 2 UI imports the pure `harness/adapter.ts` contract; recursive tests reject official runtime imports from the UI value graph. Terminal appearance is independent from keymap and execution modes. New themes retain native cursor positioning and shared hit-test geometry; legacy appearance values project to `claude-terminal-dark` in this version without rewriting the old installation; classic is not selectable.

Session-list titles retain at most 50 detached results, keyed by the official persistence service identity, Session ID and opaque revision from its metadata listing. Only unchanged cold sessions reuse a result; live sessions, missing metadata, read failures and replaced backends require fresh official title reads. The cache holds neither event logs nor observation leases and never writes persistence. Cancellation and surface-owner checks still prevent replaced requests from publishing.
