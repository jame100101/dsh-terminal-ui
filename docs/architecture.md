# Plugin architecture

English | [中文](architecture.zh.md)

## Summary

This standalone out-of-tree plugin repository owns the terminal interface. Official `@deepseek-ai/dsh@0.1.2-rc.1` owns agents, tools, presets, session persistence, jobs and workflows.

## Composition

Official dsh loads the plugin through public Harness/Cordis APIs. The Harness adapter drives TUI state and projections, which feed the React/Ink frontend. The bundle patch selects the TUI profile composition; the optional thin launcher translates flags to official dsh.

Only the TUI implementation and launcher/packaging workspaces are local. Harness packages are exact npm development dependencies and production peers. The tarball bundles patched Ink alone and installs its React dependency normally so both renderers share one React runtime.

## Development

`pnpm build:lib:host` typechecks and bundles the TUI, with Harness imports external. `pnpm build:lib:client` checks the complete TUI declaration context and builds the React/Ink frontend into an unpublished verification directory. There is no Harness web client build. `pnpm typecheck` checks production TypeScript; Vitest executes all TUI and launcher fixtures.

Vitest resolves public const-enum declarations with the TypeScript checker before isolated transpilation. This reproduces normal TypeScript inlining without a runtime shim or copied enum implementation. Tests load official CLI and base-patch assets through package exports, use public profile initialization, and flush durable fixtures explicitly.

## Maintenance

This repository does not vendor or synchronize full Harness source. A future Harness update changes dependencies and adapter compatibility evidence, not an upstream merge. The [dependency audit](dependency-audit.json) records every baseline package and directory classification. The [extraction decision](../.agents/notes/implemented/architecture/2026-09-05-standalone-plugin-repo.md) owns the rationale.
