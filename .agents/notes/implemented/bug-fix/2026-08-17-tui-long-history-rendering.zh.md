# Agent Note: 有界的 TUI 长历史渲染

Status: implemented

[English](2026-08-17-tui-long-history-rendering.md) | 中文

## 问题

恢复较长的 TUI 会话时，每个持久化事件都通过数组展开发布。每添加一个 transcript 节点或 trajectory 条目就会复制已累积的整个数组，因此 replay 成本会随历史长度呈二次增长。挂载后，打开或筛选 slash picker 会改变 transcript 高度，而空会话 welcome 布局与非空历史共用同一个 memoization 范围，导致稳定历史投影失效。每次按键都会重新解析 Markdown 并重建所有可见历史行，然后 transcript 在选择底部 viewport 前又复制一次完整投影行列表。启动时还会在首帧前开始读取并折叠最多 50 个持久化会话日志以获取标题，虽然这些行只会被 `/sessions` 使用。

## 决定

`foldFromLog` 把其私有 scratch 标记为批量 replay，且只修改该次 replay 创建的节点和 trajectory 数组。replay 返回时移除标记；之后的实时 `applyEvent` 调用仍以不可变数组发布，因此 `useSyncExternalStore` 继续观察到已变化的 snapshot。

渲染器通过每个应用独立的 `WeakMap` 投影现有上限内的 3,000 个尾部节点。每个节点会缓存有界的行变体，key 包含每个会影响显示的输入：宽度、展开与选中状态、retry 动画状态、feedback rating 以及 locale。Welcome、history 和 trajectory 投影使用分离的 memoization 范围。memoized transcript 直接接受只读行列表，因此 composer 输入与 slash picker 高度变化会复用稳定行，而不是重新解析 Markdown 或复制整个列表。resize 与展开操作仍会计算所需变体。

持久化会话标题在首次打开 `/sessions` 时通过现有 panel refresh 路径加载。启动时不再在终端输入可交互之前扫描无关日志。直接 resume 仍会读取选定会话的完整日志，因为实时 agent 与 TUI 状态必须从同一事件前缀重建。

## 已考虑的替代方案

**减少 3,000 个节点的显示尾部。**不采用，因为这会移除当前可见的历史，并通过改变导航行为来掩盖投影成本。

**对 composer 和 slash picker 输入做 debounce。**不采用，因为它会增加输入延迟，同时 replay 以及最终的每次渲染仍执行相同的冗余工作。

**在本次修改中加入向后历史分页。**不采用，因为它会改变 transcript 导航，并且需要一套与 resume、selection、expansion 和 scroll anchoring 共享的持久化分页模型。当前优化保留这些行为，并把分页留作独立功能。

**按文本全局缓存已渲染 Markdown。**不采用，因为相同文本可以具有不同的节点状态、feedback、locale、宽度或 presentation，而进程级全局缓存会在 TUI 退出后仍保留历史。

## 后果

长会话 fold 对常见的 append-heavy 日志呈线性成本，而实时更新保留先前的不可变发布语义。Composer 输入和 slash 筛选不再使稳定历史工作量与显示历史大小成正比。缓存条目由一个已挂载应用拥有，会随节点对象消失，并且每个节点最多保留 8 个变体，超出后重置。

恢复时仍会读取并折叠选定会话的完整日志，且 TUI 仍然没有向后分页 API。打开 `/sessions` 会执行延后的标题工作，因此首次使用可能花费更长时间。功能覆盖会比较 replay 与逐事件 fold，执行 10,000 个事件的 replay 后再进行实时更新，并在稳定历史上打开与筛选 slash picker 时监测 Markdown 词法分析次数。模型可见行为和 Agent Loop 均保持不变。
