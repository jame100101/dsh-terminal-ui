# Agent Note: TUI fold 只保留 preview 尺寸的工具行；原始 payload 留在会话日志

Status: implemented

[English](2026-08-20-tui-fold-tool-preview-working-set.md) | 中文

## Problem

Issue #14 Phase 3：长 coding 会话会同时保留 jsonl 日志、fold 后的 `TuiNode`、解析后的 `args`，以及 `presentCall`/`presentResult` 视图。巨大的 shell 日志、读文件和 diff 因此常驻 TUI 工作集，即使渲染器已经截断卡片行。最近 3000 节点的显示窗口不会缩小这些对象。

## Decision

会话日志仍是持久副本。fold 后的工具行是 preview 工作集。`tool/call` 仍解析 `args`，以便 `presentResult` 能跑。`enrichToolCards` 写入压过的 call/result 视图（`card-project.ts` 的 `compactCallCard` / `compactResultCard`，与投影器相同的 4000 字符 / 200 行上限）。`tool/result` 随后丢掉 `args` 和 pending call 视图，保留截断后的 `text`，只存压过的 result card。`foldFromLog` 恢复时不会把原始 arguments 再灌进已结束的行。

渲染器仍窗口化最近 3000 个节点做 wrap。它不再进一步切 `fold.nodes`：按序号复制和滚动条长度需要这份紧凑索引，而且不从日志再 fold 就把旧行丢掉会藏起历史。

## Alternatives considered

### Why not `nodes = nodes.slice(-1000)`?

Issue #14 禁止为了省内存从 fold 删除历史。滚动、恢复、`/copy n` 会丢掉日志里还在的行，除非再做一套按需 fold。那不是这次的改动。

### Why not project cards to `CardLine[]` at fold time?

和 locale 相关的标签（`truncated`、`共 N 项`）在渲染时才选。压缩视图字段后仍走 `projectResultCard(view, text, locale)`，同时限制常驻字符串。

### Why not a smaller LRU over `cachedNodeLines`?

`historyBlocks` 每一帧仍向每个保留节点要行数。比这个窗口更小的 LRU 会让其余节点每帧重新 wrap。

## Consequences

已结束的工具行不再持有解析后的 arguments 或整文件 result 视图。展开的卡片仍显示同一份截断 preview。对工具行做 `/copy` 复制的是截断后的 `text`，不是 jsonl payload。user / assistant / think 正文保持全长，因为它们就是对话。

## Testing

`packages/tui/tui/tests/fold.spec.ts` 断言 running 时还有 args，result 之后消失，结果文本上限 4000。`card-project.spec.ts` 断言 `compactResultCard` 截断 terminal 输出并丢掉重复的 read `content`。
