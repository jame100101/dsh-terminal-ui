# Agent Note: TUI 的 Grok 图片 chip 与 Web 准入

Status: implemented

[English](2026-08-21-tui-image-chips.md) | 中文

## Problem

Web 能粘贴、拖放图片，并经 `attachments.saveImage` 和 `commands.execute(..., images)` 发给模型。TUI 只有 `/attach <路径>` 和张数 dock。纯文本模型路由会拒绝图片内容。Grok TUI 用无路径的 `[Image #N]` chip，Windows 用 Alt+V，因为 Windows Terminal 的 Ctrl+V 会丢掉位图。

## Decision

待发送图片是 surface 上的耐久 `ImageAttachmentRef`。composer 粘贴单条图片路径，或 Alt+V（win32）/ Ctrl+V 位图工具（macOS/Linux），按 Web 顺序准入：类型、张数、单张大小、合计大小，然后 `saveImage`。Linux/macOS 的 Ctrl+V 在桌面剪贴板没有图片时回退到文本粘贴。剪贴板/路径粘贴成功后插入 host 分配的 `[Image #N]`；`/attach` 仍只进 dock，不改写斜杠行。Backspace/Delete 把 chip 当成一次编辑；删除 chip 会移除对应附件，剩余 chip 会重新编号，同时保留只由 `/attach` 加入的条目。提交时从模型文本里剥掉 chip，并按精确 provider/model 路由检查；`inputModalities` 不含 `image` 时拒绝。`/settings` models 使用同一条路由身份，并给识图行标 `· 图` / `· image`。`/image [N]` 显示待发送图片的名称、内蕴尺寸和字节数；Ink 继续占用备用屏，因此 fallback 不会在其 repaint 生命周期之外写入终端图形协议。

## Alternatives considered

### Why not put `/attach` chips in the slash-command draft?

`/attach` 在 composer 清空之后才跑。往那里插 chip 会吞掉接下来的 `/fork`，也不是斜杠命令该留下的提示符内容。

### Why not render a Kitty graphics preview?

Ink 每帧重画备用屏。图形协议写入会被盖掉或弄乱光标。dock 行加上附加 notice 带有 Grok overlay chrome 里的同一组事实。

## Consequences

官方目录把 `deepseek-v4-flash-vision-exp` 暴露为图片路由；`deepseek-v4-flash` 和 `deepseek-v4-pro` 仍是文本路由，除非 settings 替换它们声明的 modalities。非图片文件粘贴会变成绝对路径文本。session jsonl 保存与 Web 相同的耐久图片 block。

## Testing

`image-intake.spec.ts` 覆盖 chip 原子删除、chip/路径条目混合协调、provider/model 身份、路径分类、魔数和 Web 整批顺序。`image-clipboard.spec.ts` 覆盖平台命令和嗅探到的载荷。`image-submit.spec.ts` 证明普通 turn 会携带耐久图片 block，斜杠命令会读取并编码已存储字节。`settings-data.spec.ts` 覆盖精确路由的默认标记与识图标记。`render-frame.spec.ts` 保证 `/attach` 与其余本地命令路由彼此独立。
