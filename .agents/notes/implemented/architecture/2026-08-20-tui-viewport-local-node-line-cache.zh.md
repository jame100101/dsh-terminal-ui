# Agent Note: 视口局部的节点行缓存

Status: implemented

[English](2026-08-20-tui-viewport-local-node-line-cache.md) | 中文

## Problem

每次重建历史都会把保留的 3000 个节点投影成行数组，并挂在交给窗口化的块列表上。只要节点还在，WeakMap 条目就不会掉，长会话会为屏幕外卡片保留绘制行，包括多余的宽度/展开变体。

## Decision

行数留在 WeakMap 里，滚动条仍能走每一块。绘制行放在最多 256 个节点的 Map 中（外加当前 overscan 窗口碰到的每个节点）。窗口外的块只保留长度。若缓存里的节点与当前会话没有任何同一引用，则清空缓存。

## Alternatives considered

### Why not evict by WeakMap alone?

只要 `snapshot.nodes` 还握着最近 3000 个节点，WeakMap 就限制不了工作集。上限约束的是绘制行，不是持久 fold 状态。

### Why not skip counting off-window nodes?

滚动条滑块位置需要全部行数。行数记下来之后很便宜；只把绘制数组收成桩。

## Consequences

滚到被淘汰的节点会重新投影。follow 模式的流式输出把尾部留在缓存里。约束 `snapshot.nodes` 的 fold 工作集见[后续工作集说明](2026-08-21-tui-fold-working-set-and-deferred-boot.md)。

## Testing

`render-frame.spec.ts` 用窗口外的长度桩覆盖滚动、拖选复制和边缘自动滚动。
