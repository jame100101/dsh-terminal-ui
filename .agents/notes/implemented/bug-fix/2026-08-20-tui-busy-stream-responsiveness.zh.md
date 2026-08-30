# Agent Note: TUI busy-stream responsiveness and chrome contrast

Status: implemented

[English](2026-08-20-tui-busy-stream-responsiveness.md) | 中文

## Problem

Agent 正在回答时，Ink 把事件循环花在逐 token 的 `store.set`、整段 live 文本 wrap，以及 App 级 100ms tick（会重建 history 投影）上。滚轮和按键被卡住。live reasoning chunk 以 CR 或 LF 结尾时，还会清空唯一投影出来的 Thinking 正文行，直到下一个非换行 chunk 到达。user 与 assistant 行贴在一起；深色主题把 dim/gray 用在主文本上；状态栏忙碌标记是静止的 `●`。composer 在 wrap 预算前为 `› ` 保留两格，使首行在终端右边界处无谓变窄。选中行还把未选前缀、高亮和后缀放进三个独立的精确宽度 Yoga 盒子；Windows Terminal 重绘这些带样式的相邻盒子时可能错开第一行的首字符。todo/goal 分段配色也让紧凑 dock 显得杂乱。

## Decision

TUI 插件仍使用 Ink 7。fold 仍然立刻应用每条 session 事件。`assistant/chunk` 的 text/reasoning delta 的 UI `store.set` 按 40ms 合并（`createUiPublishScheduler`）；tool/call、tool/result、turn/end、assistant/message 以及 agent status 立即发布。live assistant wrap 复用已完成行（`wrapLiveAssistantText`）。单行 live Thinking 投影保留按显示单元有界的后缀，把 CR/LF 显示为紧凑的 `↵` 分隔符，并另存 64 个原始代码单元的后缀来识别纯追加更新；chunk 正好结束于换行时因此仍会保留可见内容，而不是移除正文行。Thinking/compaction 的 tick 放在 `ChatTranscript` 里；状态栏星号（`✶✸✹✺`）有自己的 100ms timer；等待中的 retry 标题在 `Transcript` 内闪烁。user 节点采用 Grok 风格的 prompt 块：更深的灰色 Ink 背景（dark 下 `#2d2d2d`，light 下具名 `gray`），白色 prompt 字（dark remap 后为 `whiteBright`），上下各一空行，连续 user 之间合并。assistant markdown 在块之间保留一空行（marked 的 `space` token）；think/tool/assistant 节点仍然紧贴。深色调色板把 assistant 正文保持为 `whiteBright`，chrome 数据（`gray`、turn 尾、权限条、composer `›`）不再提亮。composer 让 `›` 与续行缩进各占一格，同时保留独立的一格右边界 wrap gutter；所有行因此共享同一文本起点，首行多得到一格可用空间，且不会触碰终端自动换行列。选中行保留一个 Ink 文本布局，把未选前缀、高亮和后缀作为嵌套 span，而不是三个精确宽度的相邻盒子；源码 offset 和蓝色选区样式都保持不变。todo 整行统一使用精确色 `#8A8A8A`，goal 整行统一使用精确色 `#61D6D6`。hex/`black` 仍改成具名色，以免 Windows Terminal 画出看不见的黑字。设置页没有主题切换，终端固定深色调色板。live Thinking 在标签上扫灰色高亮（`thinkingShimmerLevel` 映到 `gray` / `whiteBright`）；不盖 hex 灰阶，因为 Windows Terminal 会把它画成黑字。忙碌状态栏在稳定的 yellow 上循环星号字形。设置页用 Claude Code 风格 chrome：搜索框、可点击 tab 条、Tab / ←→ 切换、Esc 关闭。models 页的 provider 是青色分节标题，没有 `▸`。`TUI_PERF=1` 在 stderr 打印 publish/s 和 render/s。

## Alternatives considered

### Why not `@tanstack/react-virtual`?

它虚拟化的是 DOM 节点。TUI 已经在 `selectTranscriptViewport` 里切片可见行。DOM virtualizer 不能驱动 Ink。

### Why not React `startTransition` / `requestAnimationFrame`?

Ink 不是 React DOM。并发调度不能让终端输入排在 wrap 工作前面。合并 publish 加上增量 wrap 缩短的是阻塞工作本身。

### Why not an App-level tick for the status-bar star?

App 里 100ms 的 `setTick` 会重建 `historyLines`。星号只属于 StatusBar；Thinking 动画只属于 `ChatTranscript`。

### Why not reset live Thinking at every line break?

重置只会保留最新逻辑行，但流式 chunk 经常正好结束于分隔符。这样在下一个正文 chunk 到达前，只剩动画标题而没有正文，看起来就像模型流停止了。可见分隔符既维持单行上限，也能表达进度仍在继续。

### Why not retain per-status colors in the compact dock?

计数和 phase 标签已经表达状态语义。为每个片段单独着色，会让这个频繁变化的小行出现过多互相竞争的强调色；统一精确色不依赖终端主题映射，也能保持文字清晰。

## Consequences

忙碌回合里滚轮和按键与更少、更便宜的帧共享事件循环。被取消的流仍然立刻 fold，因为 `assistant/message` 不合并。live Thinking 预览在单个可见行内把逻辑换行压成 `↵`，durable reasoning 文本保持原样。composer 文本紧接 `›` 开始，保留右边界安全 gutter，选区重绘也会保留每个源字符。todo/goal phase 变化不会改变 dock 色相。线性/plain 模式不插入 vpad。`TUI_PERF` 默认关闭。

## Testing

`packages/tui/tui/tests/wrap.spec.ts`、`viewport.spec.ts`、`status-color.spec.ts`、`ui-publish.spec.ts`、`busy-star.spec.ts` 和 `render-frame.spec.ts` 覆盖增量 wrap、结尾与跨 chunk 换行、composer 对齐、CJK 鼠标选区下的第一行字符保留、选中源码的精确替换、dock 统一配色、合并发布、深色 remap、prompt vpad、忙碌星号以及 Thinking 灰阶扫光。
