# Agent Note: TUI fold 工作集与推迟启动加载

Status: implemented

[English](2026-08-21-tui-fold-working-set-and-deferred-boot.md) | 中文

## Problem

Ink 视口已经只画可见尾部，但 `FoldState.nodes` 和 `trace` 会为进程寿命保留每一条事件，user/assistant/think 正文也没有上限。长会话因此在 TUI 里握着会话日志的第二份、无界拷贝。目录、设置、反馈、子代理列表还在 Cordis 启动期间开 I/O，和首帧抢 CPU。日常 `pnpm dsh --profile tui` 仍走 tsx（发布基线约 19 s），尽管构建产物路径已经存在。

## Decision

fold 工作集只留最新 3000 条转录行和最新 512 条轨迹行。已结算正文硬切到 32 KiB（assistant）、8 KiB（user）、4 KiB（think / tool / context）。流式 live 缓冲用同一套上限。被挤掉的前缀事件仍计入 stats。session jsonl 不变，仍是全文记录。目录、设置、推理档位、反馈在 boot yield 之后的 `setImmediate` 再加载；print 模式不加载；子代理行在打开 `/subagents` 时加载。`TUI_PERF=1` 每秒报告 `heapUsed`。`pnpm dsh:tui` 跑 `node apps/cli/lib/bin.js --profile tui`（单 Node 进程、构建产物）。

## Alternatives considered

### Why not drop the in-memory session event log?

Agent 和恢复路径需要完整日志。改那个存储超出 TUI 包，也会动会话格式或 loop 契约。

### Why not keep full assistant text for `--print`?

`--print` 读的是同一份 fold。32 KiB 覆盖常见脚本输出。print 不封顶会把工作集要去掉的第二份拷贝加回来。

### Why not in-process-exec the `dsh-tui` wrapper?

Windows 上没有 `execve` 可替换包装进程。`pnpm dsh:tui` 已经跳过包装器。改已发布的 `dsh-tui` spawn 契约是另一项启动器改动。

## Consequences

无法滚到 3000 行 fold 之前的节点；这和之前的渲染切片一致。截断正文的 `/copy` 只复制前缀。更长的 assistant `--print` 在 32 KiB 截断。内存里的 session log 仍会随轮次增长；TUI 这份不会。

## Testing

`fold.spec.ts` 断言正文上限、1200 轮回放仍留 3000 行且 stats 为 1200、以及 `foldResidentChars` 低于未封顶体积。`tui-perf.spec.ts` 断言 stderr 行带 heap 字段。
