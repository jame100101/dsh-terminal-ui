# Agent Note: TUI 性能验收计数

Status: implemented

[English](2026-08-21-tui-perf-acceptance.md) | 中文

## Problem

Issue #14 Phase 1 和 v0.8 清单要求 busy 流式 UI 速率、滚轮到 offset 的延迟、100/500 轮 heap、以及构建产物启动再测。`TUI_PERF=1` 只打 publish/s、render/s 和 heap。没有无密钥门禁能在这些预算被突破时让 CI 失败。

## Decision

`TUI_PERF=1` 的一秒窗口带上 `wheel_avg` / `wheel_max`（从解析到写入滚动 offset）和 `lag`（一次 `setImmediate` 采样）。`render.tsx` 的滚轮处理总会记下这段时间；未设 `TUI_PERF` 时计数器空操作。`perf-acceptance.spec.ts` 是无密钥门禁：合并后的 publish 远低于 token 速率，后半段增量 wrap 仍比全文重 wrap 便宜，800 次滚轮 p99 低于 8 ms，100/500 轮 fold 常驻字符落在工作集上限内，构建产物的 `--version` / `--help` / `--dump-config` 走产品路径。该 spec 写入 `evaluation/performance/DSH_TUI_PERF_CURRENT.md`（不进 git）。

## Alternatives considered

### Why not require `--expose-gc` in every vitest worker?

这个旗标会改变整套测试。验收 spec 在可选 `global.gc` 下报告 `heapUsed`；fold 常驻字符才是确定性上限。

### Why not time a full TTY surface-ready in CI?

真正的 Ink 首帧需要 PTY 和带凭据的完整 Cordis 启动。对 `apps/cli/lib/bin.js` 测 `--version`、`--help`、`--dump-config` 就能对照 76 ms / 2.1 s 那一档构建路径，而不会挂住套件。

## Consequences

产品 busy 回合在 `TUI_PERF=1` 时会在 publish/s 旁边打出滚轮和 lag。活 Agent 内存里的 session log 仍可能增长；TUI fold 这份不会。follow 模式 offset 0 和上翻锚定留在 `viewport.spec.ts` 与 `render-frame.spec.ts`。

## Testing

`tui-perf.spec.ts` 覆盖静默模式、报告行、非有限滚轮延迟、以及清掉 `TUI_PERF` 之后的 `setImmediate` 采样。`perf-acceptance.spec.ts` 守住预算。
