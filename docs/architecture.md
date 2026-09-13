# Plugin architecture

English | [中文](architecture.zh.md)

## Summary

This standalone out-of-tree plugin repository owns the terminal interface. Official `@deepseek-ai/dsh@0.1.5-rc.1` owns agents, tools, presets, session persistence, jobs and workflows.

## Composition

Official dsh loads the plugin through public Harness/Cordis APIs. The Harness adapter drives TUI state and projections, which feed the React/Ink frontend. The bundle patch selects the TUI profile composition; the optional thin launcher translates flags to official dsh.

Only the TUI implementation and launcher/packaging workspaces are local. Harness packages are exact npm development dependencies and production peers. The tarball bundles patched Ink alone and installs its React dependency normally so both renderers share one React runtime.

## Development

`pnpm build:lib:host` typechecks and bundles the TUI, with Harness imports external. `pnpm build:lib:client` checks the complete TUI declaration context and builds the React/Ink frontend into an unpublished verification directory. There is no Harness web client build. `pnpm typecheck` checks production TypeScript; Vitest executes all TUI and launcher fixtures.

Vitest resolves public const-enum declarations with the TypeScript checker before isolated transpilation. This reproduces normal TypeScript inlining without a runtime shim or copied enum implementation. Tests load official CLI and base-patch assets through package exports, use public profile initialization, and flush durable fixtures explicitly.

## Maintenance

This repository does not vendor or synchronize full Harness source. A future Harness update changes dependencies and adapter compatibility evidence, not an upstream merge. The [dependency audit](dependency-audit.json) records every baseline package and directory classification. The [extraction decision](../.agents/notes/implemented/architecture/2026-09-05-standalone-plugin-repo.md) owns the rationale.

## Local latest compatibility notes

The adapter consumes public `agent/assistant-stream` frames only for the active Agent. Durable assistant settlements replace transient text and expand their embedded stream for deterministic replay; transient frames are never appended to Session storage. Nested tool cards use the current `tool/ptc-dispatch*` events. The projection cache version changes with these semantics.

The development lockfile is regenerated when upgrading Harness, including auto-installed peers. Repository closure rejects pre-0.1.5 Harness entries so the JSONL backend cannot bind to a stale persistence API. The welcome whale uses static antialiased blue/white cells; the one-cell `❯` prefix and deduplicated counters do not change input handling.

Official CLI compatibility remains `@deepseek-ai/dsh@0.1.5-rc.1`. Its npm ranges currently select Harness subpackages `0.1.5-rc.2`; development dependencies and plugin peers match that graph. Cold fork reads use public `observeSession`, copy the immutable cut, and dispose the lease, avoiding the seed-construction path of `readSession`. The official `minimal` preset now exposes only its persistent shell; the standard preset retains file tools.
