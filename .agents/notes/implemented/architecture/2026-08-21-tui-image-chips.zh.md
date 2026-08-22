# Agent Note: TUI 的 Grok 图片 chip 与 Web 准入

Status: implemented

[English](2026-08-21-tui-image-chips.md) | 中文

## Problem

Web 能粘贴、拖放图片，并经 `attachments.saveImage` 和 `commands.execute(..., images)` 发给模型。TUI 只有 `/attach <路径>` 和张数 dock。DeepSeek 默认目录模型是纯文本；不检查就发图会在适配器上变成 `UNSUPPORTED_CONTENT`。Grok TUI 用无路径的 `[Image #N]` chip，Windows 用 Alt+V，因为 Windows Terminal 的 Ctrl+V 会丢掉位图。

## Decision

待发送图片是 surface 上的耐久 `ImageAttachmentRef`。composer 粘贴单条图片路径，或 Alt+V（win32）/ macOS Linux 的位图剪贴板工具，按 Web 顺序准入：类型、张数、单张大小、合计大小，然后 `saveImage`。剪贴板/路径粘贴成功后插入 `[Image #N]`；`/attach` 仍只进 dock，不改写斜杠行。提交时从模型散文里剥掉 chip；当前路由的 `inputModalities` 不含 `image` 则拒绝。`/settings` models 给这类路由标 `· 图` / `· image`。像素预览是带文件名、内蕴尺寸和字节的 notice；Ink 占用备用屏，不画 Kitty/iTerm 内联图。

## Alternatives considered

### Why not put `/attach` chips in the slash-command draft?

`/attach` 在 composer 清空之后才跑。往那里插 chip 会吞掉接下来的 `/fork`，也不是斜杠命令该留下的提示符内容。

### Why not render a Kitty graphics preview?

Ink 每帧重画备用屏。图形协议写入会被盖掉或弄乱光标。dock 行加上附加 notice 带有 Grok overlay chrome 里的同一组事实。

## Consequences

默认 `deepseek-v4-flash` / `deepseek-v4-pro` 仍拒图，直到目录或 `settings.yaml` 声明 `input: [text, image]`。非图片文件粘贴仍是路径文本。session jsonl 不变。

## Testing

`image-intake.spec.ts` 覆盖 chip、路径分类、魔数和 Web 整批顺序。`image-clipboard.spec.ts` 覆盖平台命令和嗅探到的载荷。`settings-data.spec.ts` 覆盖识图标记。`render-frame.spec.ts` 仍路由 `/attach`。
