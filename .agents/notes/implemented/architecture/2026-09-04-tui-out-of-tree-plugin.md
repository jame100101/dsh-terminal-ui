# Agent Note: Dual-path out-of-tree TUI plugin extraction

Status: implemented

English | [中文](2026-09-04-tui-out-of-tree-plugin.zh.md)

## Problem

The published `dsh-tui` 0.1.0 wrapper copies the entire Harness runtime. Every upstream Harness change required a full source sync. Official dsh already loads out-of-tree packages that declare `dsh.bundle` into a profile. The TUI still had no plugin-mode pack or launcher path, and lifecycle calls were spread across the surface module.

## Decision

Keep the bundled runtime and `assemble-runtime` until plugin mode has parity. Add a Harness integration seam at `packages/tui/tui/src/harness/` that re-exports the existing preset, fork, resume, jobs, and workflow modules so rendering, fold, and the projection sidecar do not grow new Agent/Session calls. Ship a second assembler, `assemble-plugin`, that stages `@jame100101/dsh-tui@0.2.0-rc.1` with the TUI `lib/`, launcher bin, plugin `cordis.patch.yml` (TUI row named `@jame100101/dsh-tui`), and vendored patched Ink. Plugin-mode launch (`DSH_TUI_MODE=plugin` or fallback after bundled resolution fails) spawns a compatible official dsh (`0.1.2-rc.1`) from `DSH_BIN` or PATH and never installs packages. Historical `0.1.0` stays the bundled npm release.

## Alternatives considered

### Why not delete the bundled runtime in the same change?

Plugin mode still needs a clean-profile install against a dsh that does not carry `PROFILE_TEMPLATES.tui`. Removing `runtime/` before that path is proven would break the 0.1 launcher.

### Why not a generic backend interface?

There is one backend. An abstract provider, RPC, or remote protocol would copy session history through extra buffers and risk the long-session fold path.

### Why vendor Ink in the plugin pack?

The fullscreen terminal-coordinate patch is not on registry Ink. A profile `npm install` of stock `ink@7.1.1` would drop that patch. The plugin tarball carries `vendor/ink` as `file:./vendor/ink`.

## Consequences

`dsh plugin --profile tui add` on official dsh 0.1.2-rc.1 is the 0.2 install. Bundled `assemble-runtime` remains. Plugin extraction is not complete until that install path reaches parity and the bundled closure is removed in a later change.

## Testing

`packages/tui/tui/tests/harness-seam.spec.ts`, `apps/tui-cli/tests/assemble-plugin.spec.ts`, and the existing preset/jobs/workflow suites cover the seam, the plugin pack layout, and #33–#36. Plugin-mode launch is unit-tested for `DSH_BIN` and version rejection.
