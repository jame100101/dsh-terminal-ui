# Agent Note: Overlay harness 0.1.0-rc.8 onto the TUI fork without git merge

Status: implemented
Archived: 2026-08-22

English | [中文](2026-08-20-tui-overlay-harness-rc8.zh.md)

## Problem

The TUI product is a full harness tree plus a TUI-only layer (`packages/tui`, `packages/bundle/tui-app`, `apps/tui-cli`, the Ink patch). Its public history was rewritten, so `git merge` from `deepseek-ai/deepseek-harness` has no usable merge-base. Staying on 0.1.0-rc.5 leaves TUI calling `commands.execute` with three arguments, dropping cancelled-stream prefixes, and refusing `/effort low` after rc.8.

## Decision

Copy the already-updated original tree (`dsh-v0.1.0-rc.8`, `141eb6fef8`) onto this repository with `robocopy /E`. Never `/MIR` or `/PURGE` (those delete the TUI layer). Never copy `.dsh/`. Restore TUI-only paths after the copy: `packages/tui`, `packages/bundle/tui-app`, `apps/tui-cli`, `patches/ink@7.1.1.patch`, TUI README screenshots, and `TUI-WEB-COMPARISON.md`. Keep the upstream `node-pty@1.2.0-beta.15` patch; drop `node-pty@1.1.0`. Put `dsh-tui` and `dsh-tui:assemble-runtime` back on the root `package.json` scripts. Keep `@deepseek-ai/dsh-tui-app` as a CLI dependency so `$DSH_HOME/profiles/node_modules` heals to the workspace TUI, not a globally installed `@jame100101/dsh-tui`. `PROFILE_TEMPLATES` includes `tui`. Host typecheck references the TUI package and excludes `packages/tui/tui/tests/**` because that aggregate has no `jsx`. Delete leftover pre-rc.8 client packages that robocopy cannot remove (`schema-form`, `web-react`) and leftover `packages/client/web` files that are not in rc.8.

TUI consumes rc.8 without changing Agent Loop: `commands.execute(agent, line, images, signal)`; `assistant/message.interrupted` becomes a visible prefix; user/tool image blocks render as `📎` plus the file name; `/effort` accepts `low` and otherwise follows `snapshot.reasoning.levels`. `tui-app` does not mount experimental Agent Teams. JSONL sessions stay `SESSION_FORMAT_VERSION = 0`. SQLite session files at schema 15 are refused; there is no compatibility layer.

## Alternatives considered

### Why not `git merge` upstream?

The TUI public baseline rewrite (`4dc33d8`) has no merge-base with `deepseek-ai/deepseek-harness`. A merge would invent history, not replay rc.8.

### Why not copy only llm / agent-loop?

`commands.execute`, attachments, plan images, and client package splits all move together. A partial copy fails typecheck on the rest of the tree.

### Why not keep globally installed `dsh-tui` as the launch path?

`pnpm dsh --profile tui` resolves bare plugin names through `$DSH_HOME/profiles/node_modules`. Without a CLI dependency on `dsh-tui-app`, that fallback stays a junction to the published runtime and the workspace `lib/` never loads.

## Consequences

The product tree's harness version is 0.1.0-rc.8. TUI-only paths remain. `pnpm dsh --profile tui` from this checkout loads workspace `@deepseek-ai/dsh-tui`. Cancelled streams keep their prefix. Slash commands can carry composer images. `/effort low` is a valid argument. Old JSONL sessions resume; old SQLite session files do not.

## Testing

`pnpm exec tsc -b tsconfig.host.json`, `pnpm run typecheck:contracts-ready`, `pnpm run build`, and `pnpm exec vitest run packages/tui/tui` cover the overlay plus the TUI consume patches (`fold.spec.ts` interrupted/image rows, `render-frame.spec.ts` `/effort low`).
