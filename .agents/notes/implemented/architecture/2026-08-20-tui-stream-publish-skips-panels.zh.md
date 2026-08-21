# Agent Note: 流式发布复用面板快照字段

Status: implemented

[English](2026-08-20-tui-stream-publish-skips-panels.md) | 中文

## Problem

合并后的 `assistant/chunk` 发布已经跳过 sessions/jobs/workflows/sandbox/occupancy 的重算，但仍会在每次 40ms 刷新时重建 queued、settings、subagents、feedback、reasoning 和 attachmentCount。Header 和权限行也会因为拿到新的 snapshot 对象而重绘。

## Decision

`reusePanels` 为 true 时，`selectPanelSnapshot` 返回上一份面板字段的同一引用，并且不调用 compute。立即发布仍会计算这些字段。Header 和 PermissionBar 用 `React.memo`，比较器忽略 live 文本和 stats。

## Alternatives considered

### Why not split the store into TranscriptStore and PanelStore?

拆 store 能让 App 在 live 文本变化时不醒，但每个布局消费者都要再订一份。复用字段身份加上 memo 比较器，仍是一份 snapshot，并跳过昂贵的 chrome 子树。

## Consequences

流式 chunk 仍发布 live、stats、nodes（稳定）和 busy。直到非 chunk 事件之前，sessions、jobs、settings、occupancy 保持上一份对象。

## Testing

`publish-snapshot.spec.ts` 证明 `reusePanels` 会跳过 compute 并保持引用。
