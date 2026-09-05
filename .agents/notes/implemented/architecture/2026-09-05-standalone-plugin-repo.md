# Agent Note: Standalone plugin repository

Status: implemented

English | [中文](2026-09-05-standalone-plugin-repo.zh.md)

## Decision

The repository owns only the TUI implementation, adapter, thin launcher, bundle patch, patched Ink and their validation. Official Harness 0.1.2-rc.1 is an npm dependency for development and a production peer. The published v0.2.0-rc.1 tag remains on 77678ba72876f2dd7d556f5980a974ec1c8623de.

## Rationale

Keeping upstream sources lets tests accidentally validate private implementations instead of the published API. Exact npm imports and public package exports make compatibility failures observable before deletion. Preserving existing TUI source paths minimizes unrelated changes; two private workspaces separate implementation from the staged publishable package.

The baseline dependency audit classifies all 277 packages and 1472 directories before removal. Upstream CLI/core, Python, web/ACP, Cloudflare/E2B/native sandbox, providers, release tools and their exclusive fixtures/documentation are outside this repository. Git retains their source and historical decisions at the baseline commit. The existing out-of-tree decision remains the owner of packaging and singleton behavior; this note supersedes its monorepo CI/build assumptions.

## Compatibility fixtures

Const enums in public npm declarations need TypeScript checker inlining before Vite's isolated transpilation. This compiler fixture derives values from declarations rather than copying runtime code. Legacy-session fixtures append a completed turn and explicitly flush through the public persistence API before cold resume. Performance fixtures initialize a profile through the public API rather than relying on a locally shipped TUI template. All original behavior assertions remain.

## Verification

An isolated retained-files checkout proves clean install, host/frontend build, production typecheck and every TUI/launcher assertion without upstream sources. The exact packed tarball is audited and booted with official dsh in a separate clean room, checking Cordis, Agent/session/jobs/workflow, patched Ink and shared React identity. CI repeats official clean rooms on Windows/Linux/macOS with Node 22.19 and 24.

## Trade-offs

Upstream documentation and exhaustive Harness CI live upstream, not in this plugin repo. Harness upgrades require dependency upgrades and adapter regression evidence instead of source merges. No runtime architecture, UI or published artifact is changed by repository extraction.
