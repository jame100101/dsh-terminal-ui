# Agent Note: 输入框 `@` 工作区路径补全

Status: implemented

[English](2026-08-20-tui-at-file-mention.md) | 中文

## Problem

Web 有 `@` 文件和会话提及菜单。TUI 只有 `/` 命令和图片 `/attach`，提工作区路径只能手打。

## Decision

不是斜杠命令的、落在末尾的 `@token` 会打开现有 palette，列出 cwd 相对的文件和目录。Tab 或 Enter 通过 `replaceAtToken` 换掉该 token。目录保留末尾 `/`，选择器保持打开。列表不会走到 cwd 之上（`pathIsInside`）。最多 32 行。

## Alternatives considered

### Why not port the Web mention graph (sessions, skills, `#`)?

终端没有可点 chips，也没有会话侧栏。路径补全才是 TUI 形态的提及。会话 `@[title](dsh-session:…)` 和 `#` 菜单不做。

## Consequences

提交的文本里 `@path` 就是普通草稿字符。模型看见路径；除非用户再 `/attach` 图片，否则没有另一份附件。

## Testing

`file-mention.spec.ts` 覆盖 token 解析、替换、包含关系和列举。`render-frame.spec.ts` 在 `process.cwd()` 下输入 `@`，期望出现文件 palette 标题。
