# Agent Note: 把最新 harness master 接到 TUI fork，且不开始插件化抽离

Status: implemented

[English](2026-09-04-tui-sync-harness-master.md) | 中文

## Problem

TUI 公开历史被重写过，所以对 `deepseek-ai/deepseek-harness` 做 `git merge` 没有原生 merge-base。产品树上次对齐的是 harness `dsh-v0.1.1-rc.2`。停在那条基线会让 TUI 继续调用 `session.events`、`settingsNamespace`、`healProfilesModuleFallback(anchor, home)`、`meta.seedLength` 和 `CallId`，这些都已被当前 harness 替换。把 dsh-tui 抽成 out-of-tree 插件是后续变更；这次同步必须保留 bundled runtime。

## Decision

把 `dsh-v0.1.1-rc.2`（`b150a551b8`）当作本地 `main` 的内容祖先，并 merge `upstream/master`（`76fda729`，工作区 `0.1.2-rc.1` 加上 http-proxy RC 版本修复）。保留 TUI 独有层（`packages/tui`、`packages/bundle/tui-app`、`apps/tui-cli`、Ink 补丁、TUI README）。Harness core 采用 upstream。把 TUI 集成补丁改写成当前 API：`PROFILE_TEMPLATES.tui` 为 `{ bundles, patchReload: 'live' }` 模板、host tsconfig paths、CLI 对 `dsh-tui-app` 的依赖、根脚本里的 `dsh-tui*`，以及与 pkg/node-pty 并列的 Ink 补丁。

TUI 消费补丁跟随新 harness API：`snapshotEvents()`、`isSeeded` 加 `inheritedEventCount`、settings 命名空间字符串、`user-questions/request` waterfall、`healProfilesModuleFallback({ installAnchor, home })`，以及 `ToolCallId`。tui-app overlay 与其他 preset-owned 行一起禁用 `command-goal`，删掉现已由 `dsh-base` 拥有的重复 storage insert，并在 host 平面挂上 `@deepseek-ai/dsh-tool-subagent/model-selection-settings`，这样 standard/ptc/cordis preset 才能 mount。`assemble-runtime` 仍复制 CLI 依赖闭包；没有重写 assembler。

## Alternatives considered

### Why not `git merge` without a content ancestor?

TUI 公开基线重写与 upstream 没有 merge-base。不相关历史的 merge 会把每个文件当成 add/add。为 merge 计算把 `HEAD` graft 到 `dsh-v0.1.1-rc.2`，才能把真正的 0.1.1-rc.2 → master 增量重放到 TUI 层上。

### Why not start plugin extraction now?

现在删除 `apps/tui-cli/runtime`、改成只保留 peerDependencies，或拆独立仓库，会把两次迁移混在一起。这次是最后一次完整的 bundled-runtime harness 同步；抽离是后续变更。

### Why not keep `session.events` and `seedLength` in TUI?

这些字段已经从 Session 和 CreateAgentOptions 消失。把旧 harness core 搬回来会拒绝 upstream 的持久化和 fork 契约。

## Consequences

产品树的 harness 版本是 `76fda729` 上的 `0.1.2-rc.1`。TUI 独有路径仍在。随附 preset 是 `standard`、`ptc`、`minimal` 和 `cordis`（`code` 已不在）。fork 子会话记录 `isSeeded` 和 `inheritedEventCount`。JSONL 会话仍是 `SESSION_FORMAT_VERSION = 0`。已发布的 `dsh-tui` wrapper 仍组装 bundled runtime。

## Testing

`pnpm exec tsc -b tsconfig.host.json` 加上 host/client tsdown、`pnpm exec vitest run packages/tui/tui packages/bundle/tui-app apps/tui-cli`（510 通过，1 跳过）、`node apps/tui-cli/scripts/assemble-runtime.mjs`（231 个包）以及 `node apps/tui-cli/bin/dsh-tui.js --version` 覆盖这次 overlay 和消费补丁（`preset-composition.e2e.spec.ts` 的 fork/resume/jobs/workflows，`agent-plane-parity.spec.ts`）。
