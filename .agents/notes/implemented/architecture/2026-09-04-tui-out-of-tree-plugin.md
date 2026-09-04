# Agent Note: Out-of-tree TUI plugin extraction

Status: implemented

English | [中文](2026-09-04-tui-out-of-tree-plugin.zh.md)

## Problem

The published `dsh-tui` 0.1.0 wrapper copied the entire Harness runtime, so each upstream change required a full source sync. Official dsh already installs packages that declare `dsh.bundle` into ordered profile layers. The TUI needed an independently packed bundle without changing its renderer, fold, viewport, projection sidecar, or input architecture.

## Decision

Package `@jame100101/dsh-tui@0.2.0-rc.1` as an out-of-tree bundle for official `@deepseek-ai/dsh@0.1.2-rc.1`. Its patch layers the TUI composition after `@deepseek-ai/dsh-base`, and its launcher only translates arguments to `dsh --profile tui`. The launcher resolves compatible official dsh from `DSH_BIN` or PATH and never installs or upgrades packages.

Keep Harness lifecycle calls behind `packages/tui/tui/src/harness/`. The existing preset, fork, resume, jobs, and workflow modules remain the implementation; rendering, fold, viewport, and projection state retain their existing data path.

Bundle the patched `ink@7.1.1` package inside the npm tarball through `bundledDependencies`. Declare Ink's runtime dependencies normally so Ink and the TUI share the profile's React. The staged Ink build carries a patch hash marker, and an opt-in runtime diagnostic records the resolved Harness, Ink, and React paths from the loaded plugin process.

Remove the bundled runtime assembler and launcher mode after the official clean-room install proves profile initialization, module identity, patched Ink resolution, and PTY boot. The published 0.1.0 artifact remains the historical standalone release.

## Alternatives considered

### Why not retain both launcher modes?

A bundled fallback can hide a broken official-plugin installation and preserves the full repository synchronization cost. Version 0.2 reports a missing or incompatible official dsh directly.

### Why not add a backend abstraction?

The plugin and the official profile run in one Cordis process. An RPC or provider layer would add another session-history representation without replacing a real backend choice.

### Why not use registry Ink?

Registry Ink lacks the fullscreen terminal-coordinate patch. An npm bundled dependency preserves the patched package, while ordinary runtime dependencies avoid a second React instance.

## Consequences

Production packaging contains the TUI build, bundle patch, thin launcher, and patched Ink. It contains no Harness source tree, workspace dependency, repository path, `runtime/`, or `assemble-runtime`. Harness upgrades change the supported package version and rerun compatibility tests instead of merging Harness source.

## Testing

`apps/tui-cli/scripts/verify-official-plugin.mjs` installs official dsh outside the repository, creates a fresh `DSH_HOME`, installs the packed plugin, checks the two profile bundles, asserts Harness package paths and Cordis identity, verifies the Ink marker and shared React path, and boots direct dsh plus the launcher under a PTY. The TUI composition suite uses the out-of-tree patch for preset, model route, jobs, and workflow regressions.
