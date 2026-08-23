# Agent Note: TUI 大段粘贴 capsule

Status: implemented

[English](2026-08-23-tui-large-paste-capsules.md) | 中文

## Problem

终端 bracketed paste 和剪贴板快捷键会把大段正文直接放进可见 composer 草稿。五行光标窗口限制了绘制行数，但每次编辑和 repaint 仍会保留并重新折行完整正文。原来的硬换行预览还会隐藏普通手动输入的多行草稿，覆盖不到很长但依靠软折行的粘贴，而且没有在提交路径里替换输入。

## Decision

单次粘贴达到 1,000 个 Unicode 字符时，composer 只保留一个短的 `[Pasted text #N +M lines]` token。App 在可见草稿之外保留经过终端清理的准确文本，并在斜杠命令分发、queue/steer 处理、输入大小检查和模型提交之前展开完整 token。终端 bracketed paste 与显式剪贴板文本粘贴进入同一条路径。图片和文件路径分类优先执行，因此附件行为保持独立。

Backspace 和 Delete 把 token 视为一个删除单元。移除或编辑 token 会释放对应的保留文本，清空草稿会重置编号。普通输入和较小的粘贴继续使用标准五行光标窗口；硬换行数量不再触发第二套 composer 布局。

## Alternatives considered

**只按硬换行数量折叠。** 很长的压缩内容和软折行正文仍会承担完整草稿开销，而手写的四行短草稿会被无必要地隐藏。

**永久用摘要 token 替换粘贴。** 模型和已注册命令会丢失用户提供的原文。

**把完整正文保存在隐藏的草稿标记中。** 光标 offset、选区、宽度计算和图片 chip 协调仍需遍历大段文本，并要求编辑器再维护一套解析器。

## Consequences

Capsule 只属于呈现状态。Agent Loop、session event、runtime protocol 和持久化消息格式均不变化。提交以后，现有 host 路径收到的展开文本与普通粘贴一致，并继续受现有外层空白和输入大小规则约束。如果 token 只保留了一部分，就会作为普通可见文本处理，不会悄悄恢复已经脱离的正文。

## Testing

纯单元测试固定 Unicode 阈值、行数、token 展开、生命周期和原子删除。Ink 全屏渲染测试通过生产输入 hook 驱动 bracketed paste，验证 628 行 capsule，并验证 Enter 提交保留的正文。Composer viewport 测试固定移除硬换行预览后的普通多行行为。
