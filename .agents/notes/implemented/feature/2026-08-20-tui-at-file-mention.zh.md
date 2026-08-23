# Agent Note: 输入框 `@` 工作区与会话补全

Status: implemented

[English](2026-08-20-tui-at-file-mention.md) | 中文

## Problem

Web 有 `@` 文件和会话提及菜单。TUI 原本要求用户手动输入工作区路径和跨会话标识，而 Harness 已经提供文件发现、规范会话 mention 和耐久的跨会话上下文准备能力。

## Decision

不是斜杠命令的末尾 `@token` 会打开现有 palette。工作区相对文件和目录排在前面；Tab 或 Enter 通过 `replaceAtToken` 替换 token，目录保留末尾 `/`，列表不会走到 cwd 之上（`pathIsInside`），文件最多显示 32 行。其他会话由当前 agent scope 的 `sessionReferenceResolver.listCandidates` 在短暂防抖后异步提供。选择会话会插入 Host 格式化的 `@[label](dsh-session:...)` mention。

TUI bundle 挂载 `@deepseek-ai/dsh-session-reference`。现有 pre-step 插件负责解析规范会话 mention，并准备有界、耐久、只读的会话上下文。TUI 只负责发现和草稿插入，不解析会话日志，也不增加另一条模型输入路径。

## Alternatives considered

### Why not add TUI-specific cross-session parsing or Agent Loop injection?

session-reference 服务已经负责标识编码、候选上限、取消、快照准备、耐久性和模型可见上下文。第二套实现会与 Web 和其他入口分叉。

### Why not merge session candidates into filesystem traversal?

文件是 cwd 范围内的路径，会话则是带标题和可选工作区的耐久标识。分开候选来源能保持各自所有权，也能让较慢的持久元数据查询继续异步执行。

## Consequences

提交后的文件 mention 仍是普通草稿字符。规范会话 mention 由已挂载的 Harness 插件识别，并生成可重建的 session-reference 上下文。过期的异步会话搜索结果会被丢弃，因此迟到结果不会覆盖较新输入的候选项。

## Testing

`file-mention.spec.ts` 覆盖 token 解析、替换、包含关系和列举。`render-frame.spec.ts` 覆盖工作区候选和官方会话 mention 插入。session-reference 包测试继续负责规范 URI 解析和耐久上下文准备。
