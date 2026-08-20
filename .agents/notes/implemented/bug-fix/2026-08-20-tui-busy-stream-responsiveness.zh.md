# Agent Note: TUI busy-stream responsiveness and chrome contrast

Status: implemented

[English](2026-08-20-tui-busy-stream-responsiveness.md) | 中文

## Problem

Agent 正在回答时，Ink 把事件循环花在逐 token 的 `store.set`、整段 live 文本 wrap，以及 App 级 100ms tick（会重建 history 投影）上。滚轮和按键被卡住。user 与 assistant 行贴在一起；深色主题把 dim/gray 用在主文本上；状态栏忙碌标记是静止的 `●`。

## Decision

TUI 插件仍使用 Ink 7。fold 仍然立刻应用每条 session 事件。`assistant/chunk` 的 text/reasoning delta 的 UI `store.set` 按 40ms 合并（`createUiPublishScheduler`）；tool/call、tool/result、turn/end、assistant/message 以及 agent status 立即发布。live assistant wrap 复用已完成行（`wrapLiveAssistantText`）。Thinking/compaction 的 tick 放在 `ChatTranscript` 里；状态栏星号（`✶✸✹✺`）有自己的 100ms timer；等待中的 retry 标题在 `Transcript` 内闪烁。user 节点采用 Grok 风格的 prompt 块：灰色 Ink 背景（`bg = light`），上下各一空行，连续 user 之间合并。assistant markdown 在块之间保留一空行（marked 的 `space` token）；think/tool/assistant 节点仍然紧贴。深色调色板把 assistant 正文保持为 `whiteBright`，user prompt 用灰色块上的 `blue`，chrome 数据（`gray`、turn 尾、权限条、composer `›`）不再提亮。hex/`black` 仍改成具名色，以免 Windows Terminal 画出看不见的黑字。设置页没有主题切换，终端固定深色调色板。live Thinking 只改 spinner 字形。忙碌状态栏在稳定的 yellow 上循环星号字形。设置页用 Claude Code 风格 chrome：搜索框、可点击 tab 条、Tab / ←→ 切换、Esc 关闭。models 页的 provider 是青色分节标题，没有 `▸`。`TUI_PERF=1` 在 stderr 打印 publish/s 和 render/s。

## Alternatives considered

### Why not `@tanstack/react-virtual`?

它虚拟化的是 DOM 节点。TUI 已经在 `selectTranscriptViewport` 里切片可见行。DOM virtualizer 不能驱动 Ink。

### Why not React `startTransition` / `requestAnimationFrame`?

Ink 不是 React DOM。并发调度不能让终端输入排在 wrap 工作前面。合并 publish 加上增量 wrap 缩短的是阻塞工作本身。

### Why not an App-level tick for the status-bar star?

App 里 100ms 的 `setTick` 会重建 `historyLines`。星号只属于 StatusBar；Thinking 动画只属于 `ChatTranscript`。

## Consequences

忙碌回合里滚轮和按键与更少、更便宜的帧共享事件循环。被取消的流仍然立刻 fold，因为 `assistant/message` 不合并。线性/plain 模式不插入 vpad。`TUI_PERF` 默认关闭。

## Testing

`packages/tui/tui/tests/wrap.spec.ts`、`ui-publish.spec.ts`、`busy-star.spec.ts` 和 `render-frame.spec.ts` 覆盖增量 wrap、合并发布、深色 remap、prompt vpad 以及忙碌星号。
