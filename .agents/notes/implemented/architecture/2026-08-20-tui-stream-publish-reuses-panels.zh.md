# Agent Note: 流式 UI publish 复用面板快照字段

Status: implemented

[English](2026-08-20-tui-stream-publish-reuses-panels.md) | 中文

## Problem

Issue #14 Phase 4：每次合并后的 `assistant/chunk` UI publish 都会重建 `/sessions`、`/jobs`、`/workflows`、sandbox 模式、occupancy 和模型列表，即使这些行在 text/reasoning delta 上不变。React memo 过的 chrome 仍会看到新的数组身份。

## Decision

合并后的流式 publish（`createUiPublishScheduler` 延迟调用的 `publish(true)`）保留上一份快照的 `sessions`、`jobs`、`workflows`、`models`、`sandbox`、`occupancy` 引用。交互和结构事件取消合并窗口（`dispose`）并调用 `publish()`，重新计算面板字段。fold 的 nodes、live buffer、stats、busy 两条路径都会更新。

## Alternatives considered

### Why not split the store into several `useSyncExternalStore` slices?

Ink 树现在只有一份 `App` 快照。复用面板引用，就够让依赖这些字段的 `React.memo` 子树跳过。多个 store 要改所有消费者。

### Why not skip `store.set` when only live text changed?

`ChatTranscript` 和状态栏必须看到 live 文本。publish 仍会发生；只是不再分配面板行。

## Consequences

一个流式 token 不再重映射 agent 列表或 job 已用时间。流式回合中打开 `/jobs` 仍显示上一次完整 publish 的行，直到非 chunk 事件（status、tool、turn end）刷新。因此纯流式回合里 job 计时会停住，到下一次结构事件再追上。

## Testing

`packages/tui/tui/tests/ui-publish.spec.ts` 仍覆盖合并 vs 立即。`startup.spec.ts` 会启动插件的 subscribe 路径。流式复用就是 `packages/tui/tui/src/index.ts` 里延迟 scheduler 回调的 `publish(true)`。
