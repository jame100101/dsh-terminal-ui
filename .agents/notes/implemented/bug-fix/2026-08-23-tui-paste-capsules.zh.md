# Agent Note: 跨终端剪贴板模式的 TUI 粘贴折叠

Status: implemented

[English](2026-08-23-tui-paste-capsules.md) | 中文

## Problem

终端剪贴板输入不一定总是带 bracketed-paste 标记，剪贴板 provider 也可能使用 LF、CRLF 或单独 CR 分隔各行。只把 Ink `usePaste` 事件视为粘贴，会让普通输入事件收到的大段文本在 composer 中完整展开。若在规范行尾前先清理单独 CR，则所有行分隔符都会消失，多行折叠 token 可能只显示一行。

## Decision

Ink bracketed paste 仍是主要路径。一个完整普通输入事件达到 1,000 个 Unicode 字符或 20 个逻辑行时，也会进入粘贴处理；更小的输入事件继续保持普通输入和 IME 语义。粘贴处理会在清理终端控制符前把 CRLF 和单独 CR 规范为 LF，以规范后的文本计算逻辑行数，把完整的已清理文本保存在可见草稿之外，并在折叠 token 仍存在时提交所保留的文本。

深色主题的活动状态行在所有忙碌阶段使用 `#4FC3F7`，idle 使用 `#4A90C4`。浅色主题继续使用现有的具名蓝色对比方案。权限颜色保持独立。

## Alternatives considered

### Why not require bracketed paste?

应用会启用 bracketed mode，但某些终端剪贴板操作或中间层仍会交付一个普通输入事件。只接收带标记的事件，会让折叠行为取决于终端的交付路径。

### Why not preserve carriage returns in the general sanitizer?

同一个 sanitizer 还保护 transcript 和工具输出渲染，而 carriage return 能重新定位终端输出。只在粘贴入口规范行尾，可以修正剪贴板语义而不削弱其他文本位置。

## Consequences

大段会话复制会稳定折叠，同时不改变小段粘贴、IME、选区替换、原子删除、图片路径接收或提交所有权。剪贴板行尾会在提交文本中变为 LF，与现有 CRLF 行为一致。一个刻意生成且达到任一阈值的单次输入事件会被视为粘贴。

## Testing

单元测试固定两个阈值和三种行尾形式。Ink 全屏测试输入一个不带 bracketed 标记、包含 187 行且只用 CR 分隔的事件，检查折叠 token 和准确行数，并确认提交完整的 LF 规范化文本。现有 bracketed-paste 测试继续覆盖 628 行与原文提交。
