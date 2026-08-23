# Agent Note: Overlay the upstream Harness tree by exact changed paths

Status: implemented

English | [中文](2026-08-22-tui-overlay-upstream-master.zh.md)

## Problem

The TUI product contains the complete DeepSeek Harness tree plus TUI-owned packages, a bundled CLI, documentation, terminal patches, and performance records. The fork has no usable merge base with the official repository. Copying an entire tree can overwrite uncommitted TUI work, while copying a few image packages mixes incompatible Harness contracts.

## Decision

The Harness source matches official `deepseek-ai/deepseek-harness` master `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`0.1.1-rc.2`). Synchronization applies the official `141eb6fef8..b150a55` name-status list: added and modified paths come from an archive of the exact official commit, and deleted paths are removed only after their resolved workspace path passes a containment check. The operation does not use `git merge`, `robocopy`, or a recursive mirror.

TUI-owned paths remain local: `packages/tui`, `packages/bundle/tui-app`, `apps/tui-cli`, `assets`, the Ink patch, root TUI documentation, TUI Agent Notes, and `evaluation`. Shared manifests start from the official commit and reapply only the TUI integration: root launch scripts, the CLI dependency on `@deepseek-ai/dsh-tui-app`, the `tui` profile template, host TypeScript references, and the Ink patched dependency. `pnpm install --no-frozen-lockfile` records those additions over the official lockfile.

The official `node-pty@1.2.0-beta.15` patch remains the dependency baseline. The published package references `lib/eventEmitter2.js` without including that runtime file, so the local patch also restores the compiled MIT-licensed helper from the upstream source. This keeps the official Windows PTY fixes while making a clean installation importable.

The TUI consumes the current attachment contracts without an Agent Loop change. Its user messages carry durable image references; slash commands use the four-argument image form; the DeepSeek adapter owns normalized request variants and Files API offload.

## Alternatives considered

**Merge official master.** The rewritten histories do not provide a trustworthy merge base, so a merge would manufacture ancestry and conflict resolution.

**Copy the complete official tree.** A whole-tree copy cannot distinguish official files from local TUI packages and uncommitted work.

**Update only attachment and DeepSeek packages.** The attachment store, LLM request preparation, session projection, settings, app bundles, and generated contracts changed together; a partial update creates a version mixture that the repository typecheck does not model.

## Consequences

The core Harness version and package graph match the official master commit while the TUI remains an overlay rather than a forked Agent Loop. The synchronization touches a large source area, so the local checkpoint commit is the rollback point. Future updates repeat the exact-path procedure from the recorded upstream base and inspect shared-manifest intersections before writing.

The one-off rc.8 procedure is retained as a frozen historical record in [the archived overlay note](../../archived/architecture/2026-08-20-tui-overlay-harness-rc8.md).

## Testing

Repository typecheck builds the host face and checks the client contracts. Focused TUI tests cover image intake, model-route identity, rendering, PTY behavior, and performance acceptance. The narrow-terminal PTY assertion derives the composer top row from its separators when the five-row cap clips the prompt glyph; it still compares the terminal cursor with the measured caret row after every edit. The bundled CLI build and smoke test verify that the TUI packages remain reachable through the assembled runtime.
