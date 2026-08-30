# Agent Note: TUI DeepSeek session cost

Status: implemented

English | [中文](2026-08-30-tui-deepseek-session-cost.zh.md)

## Problem

The terminal surface already shows session token totals but does not translate those provider-reported buckets into the dollar amount a user needs while monitoring a long run. Multiplying the whole session by the currently selected model would misprice sessions that switch models, and adding reasoning tokens to completion tokens would charge DeepSeek reasoning twice.

## Decision

The TUI folds an estimated US-dollar cost from durable request routes and completed-step usage without changing Harness events, the Agent Loop, or provider adapters. Each `step/start` captures the latest route, and a `request/header` within that step replaces it before the usage sample commits. The fold prices each completed step separately and accumulates the result in `SessionStats.costUsd`, so later model changes do not reprice earlier work. A content-less completion still commits its usage and cost while leaving unavailable timing samples at zero.

The initial rate table mirrors pi-ai 0.82.1 for `deepseek-v4-flash` and `deepseek-v4-pro`: uncached input, output, cache-read, and cache-write buckets use pi's USD-per-million-token arithmetic. DeepSeek completion usage already includes reasoning tokens, so the reasoning bucket remains informational and is not billed again. Only the `deepseek` and `deepseek-official` routes with a known exact model id contribute cost.

The permission row renders the total at its right edge as `$N.NNN`, matching pi's session-footer precision. Narrow terminals omit the amount before they compress the permission control below a usable width. Projection sidecars use projection version 2 because the persisted fold statistics now include `costUsd`; version-1 files fall back to authoritative log replay.

## Alternatives considered

**Multiply accumulated tokens by the current model.** This is shorter but silently rewrites historical spend after `/model` changes and cannot assign distinct steps to distinct rate tables.

**Import pi-ai's runtime catalog and cost helper into the TUI bundle.** That would make two catalog rows pull the provider catalog and its dependency graph into a latency-sensitive terminal package. Keeping the two DeepSeek rows local preserves the small render closure; the source version is named so a pi-ai catalog update has an explicit synchronization point.

**Persist a new billing event or restore pi-ai's discarded cost object in the adapter.** Cost is a TUI presentation derived from already durable route and usage facts. Changing shared events or adapters would expand the Harness surface for no additional replay authority.

## Consequences

Long and resumed sessions show a stable dollar total without an API call or per-frame work. The amount is a local estimate at the pinned pi-ai rates rather than a provider invoice, and a newly introduced provider route or model remains unpriced until its rate is added deliberately. A rate update must keep the calculator tests and this note synchronized. Old TUI projection caches replay once under version 2 and are then rewritten.

## Testing

`deepseek-cost.spec.ts` pins both pi-ai rate rows, the reasoning non-duplication rule, unknown-route behavior, and three-decimal formatting. `fold.spec.ts` prices two steps across a model change and a content-less usage-only completion. `render-frame.spec.ts` verifies the formatted total occupies the right edge of the permission row, and `projection-sidecar.spec.ts` exercises the new projection version through normal round-trip validation.
