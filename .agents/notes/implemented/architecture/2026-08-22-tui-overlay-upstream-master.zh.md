# Agent Note: 按上游精确变更路径覆盖 Harness 树

Status: implemented

[English](2026-08-22-tui-overlay-upstream-master.md) | 中文

## Problem

TUI 产品包含完整 DeepSeek Harness 树，以及 TUI 自有包、捆绑 CLI、文档、终端补丁和性能记录。这个 fork 与官方仓库之间没有可用的 merge base。复制整棵树可能覆盖尚未提交的 TUI 工作，而只复制少数图片包会混用彼此不兼容的 Harness 契约。

## Decision

Harness 源码与官方 `deepseek-ai/deepseek-harness` master `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`0.1.1-rc.2`）一致。同步按官方 `141eb6fef8..b150a55` name-status 清单执行：新增和修改路径来自精确官方提交的 archive；删除路径只有在解析后的工作区路径通过包含关系检查后才会移除。这个过程不使用 `git merge`、`robocopy` 或递归镜像。

以下 TUI 自有路径保留本地版本：`packages/tui`、`packages/bundle/tui-app`、`apps/tui-cli`、`assets`、Ink 补丁、根 TUI 文档、TUI Agent Notes 和 `evaluation`。共享 manifest 先采用官方提交，再只加回 TUI 集成：根启动脚本、CLI 对 `@deepseek-ai/dsh-tui-app` 的依赖、`tui` profile 模板、host TypeScript 引用和 Ink patched dependency。`pnpm install --no-frozen-lockfile` 在官方 lockfile 上记录这些增量。

官方 `node-pty@1.2.0-beta.15` 补丁继续作为依赖基线。已发布的包引用 `lib/eventEmitter2.js`，但没有包含这个运行时文件，因此本地补丁还从上游源码恢复了编译后的 MIT 许可 helper。这样既保留官方 Windows PTY 修复，也使 clean installation 能够正常 import。

TUI 在不修改 Agent Loop 的前提下消费当前附件契约。用户消息携带持久图片引用；斜杠命令使用四参数图片调用；DeepSeek adapter 负责规范化请求图片版本和 Files API offload。

## Alternatives considered

**合并官方 master。** 重写过的历史没有可信 merge base，merge 会编造祖先关系和冲突决议。

**复制完整官方树。** 整树复制区分不了官方文件、本地 TUI 包和尚未提交的工作。

**只更新 attachment 和 DeepSeek 包。** attachment store、LLM 请求准备、session projection、settings、应用 bundle 和生成契约一起变化；局部更新会产生仓库 typecheck 未建模的版本混合。

## Consequences

核心 Harness 版本和包图与官方 master 提交一致，TUI 仍然是 overlay，不是分叉的 Agent Loop。同步涉及大范围源码，因此本地 checkpoint commit 是回滚点。后续更新从记录的上游基线重复精确路径流程，并在写入前检查共享 manifest 交集。

一次性的 rc.8 流程保存在冻结的[历史 overlay 记录](../../archived/architecture/2026-08-20-tui-overlay-harness-rc8.md)中。

## Testing

仓库 typecheck 构建 host face 并检查 client contracts。TUI focused tests 覆盖图片 intake、模型路由身份、渲染、PTY 行为和性能验收。窄终端达到五行 composer 上限而裁掉 prompt 字形时，PTY 断言根据上下分隔线推导 composer 首行；它仍在每次编辑后比较终端光标与测量得到的 caret 行。捆绑 CLI build 与 smoke test 验证 TUI 包仍可由 assembled runtime 解析。
