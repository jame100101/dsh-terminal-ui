# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

The dsh terminal surface: an in-process TUI plugin restructured after the **DamnatioX TypeScript TUI** (Ink 7 + React 19).:

- **DamnatioX geometry**: a fixed-height root Box (`(terminal width - 1) × height` + `overflow="hidden"`) leaves the physical right-margin cell blank so DECAWM pending-wrap state cannot shift repaints. Layout: 4-row header (`🐋 DSH-TUI` / cwd / model · busyEnter + a separator) · transcript viewport · slash picker · composer · status bar (activity row + Web-stats strip).
- **Toolkit-native caret**: the composer caret anchors through Ink's own `useCursor()`/`measureElement()` (no manual ANSI CUP writes anywhere). The single-line input renders a horizontal viewport around the caret with `…` ellipses and reserves one cell for the native cursor — Windows Terminal IME composition anchors at the draft.
- **DamnatioX wheel semantics, verbatim**: SGR wheel reports are parsed from Ink's raw input stream (`parseMouseWheel`), each tick moves the transcript by 3 lines (`scrollOffsetForWheel`), offset 0 is follow mode (submits reset it), new content while scrolled keeps the view anchored (`updateTranscriptMaximumOffset`), and a positive offset shows the floating back-to-bottom button. A **browser-style right-edge scrollbar** uses one `█` glyph for both dim rail and cyan thumb in its own gutter column beside the blank autowrap column; patched Ink re-anchors that terminal cell with CHA so preceding emoji-width differences cannot move it. Click or drag jumps straight to any history position (2-cell target, 1002 button-motion tracking). PgUp/PgDn/Ctrl+Home/End page, `history paused` shows in the status bar.
- **Slash picker in the DamnatioX palette style**: `╭─` title / items / `╰─` hint rows, an 8-item window that follows the selection, ↑↓ cycles, Tab completes, Esc dismisses (until the input changes), Enter executes — no border-box rendering glitches. `/effort` opens a nested three-row `off` / `high` / `max` selector instead of requiring a memorized argument.
- **dsh extras kept**: render-intent tool cards, retry countdown rows, markdown inline runs, the Web-stats strip, `/settings` five pages + `/jobs` `/subagents` `/workflows` panels, approval/question takeovers, busyEnter queue/steer, the queue dock, and the linear non-TTY fallback.
- **Duplicate-free rendering**: transcript viewport rows are position-keyed (scrolling reorders rows every wheel tick; keyed reordering through Ink's reconciler can accumulate stale rows) and the live Thinking/notice rows carry stable keys, so rapid wheel scrolling plus streaming keeps the screen clean — guarded by a screen-emulator regression test.
- **One Thinking block per turn**: reasoning segments split by tool calls merge into a single collapsible `✓ Thinking` row per turn (the TS DamnatioX shows one thought block per message entry) — a long agentic turn no longer stacks one Thinking row per tool call.
- **Web-stats strip** below the composer, folded deterministically from the session log: 轮次 / 步数 / LLM 时间 / 工具时间 / TTFT / tok/s / 缓存命中率 / ↑↓C W R Σ token 计数 / 上下文占用 —— nothing from the Web strip is omitted, and each turn closes with a `└ turn N · LLM · 工具 · TTFT` tail row.
- **Retry rows**: one muted, collapsible row per retry chain — `⟳ retry n/max · 12s 后` with a client-anchored countdown (ceil, 1s floor), shimmer while waiting, `∞` in always mode; the expand body shows provider/policy/failure code/HTTP status/latest delay and never the failure message (credential safety, Web parity).
- **Markdown inline styling**: assistant prose renders bold, inline code (cyan), links (underline), and emphasis as per-run colored segments, wrapped cell-accurately so styles survive line breaks; code fences, lists, and blockquotes stay structural, and GFM tables render as CJK-width-aligned `│` grids that shrink to the terminal width.
- **Busy-stream input safety**: Ink flushes a lone `\x1b` as Escape after 20ms, so a split arrow sequence under a busy stream used to wipe the draft and dismiss the picker; the renderer now confirms every Escape (60ms) and re-synthesizes the split key tail, keeping the picker open and arrow-navigable while a turn streams. Streaming `assistant/chunk` UI publishes coalesce at 40ms and live assistant wrap is incremental. Thinking/compaction animation and the status-bar star live in isolated subtrees so a 100ms tick does not re-project settled history (the fold keeps settled arrays referentially stable, and tool-card bodies cap at 400 rows / 300 cells per line). Every fresh `/` keystroke re-arms the picker and each keystroke clears stale dismissals, so `/` can never stay silently suppressed.
- **Busy chrome**: the live Thinking row leads with a braille spinner in a stable magenta; compaction uses a yellow spinner row; neither row sweeps hues. `/trajectory` colors model turns blue, tool activity red, and user input cyan. The status-bar busy marker is a cycling star (`✶✸✹✺`) in stable yellow — the glyph changes, the color does not. User prompts use a gray block background (Grok `bg = light`) plus one blank row above and below. Assistant markdown keeps one blank row between blocks; think/tool/assistant nodes stay flush.
- **Fullscreen caret contract**: the composer passes `measureElement()` coordinates unchanged to Ink's `useCursor`; the pinned Ink patch derives every suffix origin, including cursor-only updates, from the output's actual final row, so first paint, whitespace input, navigation, and repeated fullscreen repaint share one zero-based row model.
- **Tool render-intent cards**: every tool row projects its `presentCall`/`presentResult` view (generic / terminal / diff / search / read / web) into terminal blocks, collapsed by default.
- **`/settings` five pages**: a Claude Code-style chrome (search field, clickable tab strip, Tab / ←→ to cycle, Esc to close) over general (busyEnter Queue/Steer, thinking default display — persisted to the `tui` namespace of `$DSH_HOME/settings.yaml`, live), models (provider names as cyan section titles, default selection, value-free credential rows that write through `ctx.credentials` with masked input and a confirm gate), plugins (complete read-only Loader status list; enable/disable changes belong in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, which the user can edit directly or ask the Agent to update), inventory (settings namespaces + credential refs + inspect providers), presets (agent presets: `Enter` recomposes the BLANK session in place — the Web mechanism; once the conversation starts its preset is fixed; the current preset is `●`-marked, broken presets are dimmed).
- **`/jobs` panel**: live registry rows (id/kind/label/status/elapsed/detail) refreshed every second while open; Enter requests a kill for running jobs. **`/subagents` panel**: the durable descendant tree (depth-indented, mode/activity/label, diagnostics). **`/workflows` panel**: event-driven run rows (status/phase/log/agent-count/error).
- **`/model`** opens the models settings page (select the default with Enter). **`/sessions`** loads the live agent plus the newest 50 persisted sessions (titles/filter) on first open rather than scanning persisted logs during startup; `Enter` resumes one with full history replay — exactly ONE live session exists at a time (switches dispose the previous agent; `/fork` yields a persisted, resumable artifact). **`/new`** starts a fresh session.
- **Bounded transcript work**: complete-log resume uses a private linear replay builder, while settled display rows are cached per immutable node, terminal width, expansion, feedback, and locale. Composer and slash-picker updates reuse those projections and slice the visible viewport without copying the complete wrapped-line list.
- **Collapsible rows** (context `◆`/Thinking/tool/retry): click the trailing `▶`/`▼` directly. Context/tool/retry retain per-node expansion; clicking any Thinking arrow changes the persisted global Thinking display, updates every Thinking row together, and keeps the header's `thinking on/off` label synchronized. Idle Tab 没有 transcript 选中模式；输入框有文字时方向键移动光标（含折行），空草稿时 ↑/↓ 回忆提交历史；Space 仍是普通输入。
- **Slash picker** (`/`) over host commands plus TUI-local ones, listed **alphabetically (a–z)** in the DamnatioX palette style; host commands get Chinese descriptions in the zh locale and dispatch through `ctx.commands` without a model turn.
- **Approval and ask_user takeovers** (allow-once / deny / options / custom answers); **`/trajectory`** structured view; **todo and queue docks** at the transcript tail.
- **`Ctrl+Enter` steers** a running turn (`busyEnter` assigns plain Enter while busy); `Esc` cancels; `Ctrl+D` quits when idle; `Ctrl+L` clears; double `Ctrl+C` within 2s exits. 输入框里有选区时 `Ctrl+C` 复制该选区，不取消任务。
- **复制**（和 Grok 一样，默认就能用）：在提示词或回复上拖选即可高亮并自动复制；松开鼠标即复制并清掉高亮。单击且没有拖动不会选中整条消息。消息之间的空行可以起选或继续拖选，但不会进入剪贴板。拖到会话顶部或底部会滚动，以便继续选中当前看不见的历史。输入框是 TUI 自己的编辑器：拖选或 `Ctrl+A` 用蓝色背景选中，`Ctrl+C` 复制，`Ctrl+V`（或终端粘贴）插入，输入或粘贴会替换当前选区。每一折行都画 2 格的 `› `/缩进，第一行和后面的行共用同一折行宽度；折行比绘制盒子少 1 格，满行不会把末字裁掉。一次粘贴达到 1,000 个 Unicode 字符时会收成一个可原子删除的 `[Pasted text #N +M lines]` token，提交时仍使用保留的完整原文；普通手动输入的多行草稿继续使用五行光标窗口。`/copy` 复制最近一条回复；`/copy n` 是第 n 条最近回复。滚轮、滚动条、disclosure 仍由 TUI 处理。线性/print 模式不实现剪贴板快捷键。

## Web 功能差距核对（v0.0.12 · packages/client/* 对照）

| Web 功能 | TUI 状态 |
|---|---|
| 对话流、steer/queue 发送、busyEnter | ✅ 同款语义（运行中 Enter 按 busyEnter 走 Queue/Steer，Ctrl+Enter 互补） |
| 转录折叠（思考/工具/上下文）、工具渲染意图卡 | ✅ 六种意图卡 + retry 行 + 内联 markdown 着色 |
| 审批 allow-once/deny、ask_user（多选/自定义答案） | ✅ composer 上方接管区 |
| 轨迹视图 | ✅ `/trajectory` 切换 |
| 统计条（轮/步/LLM/工具/TTFT/缓存/token/上下文） | ✅ 状态栏 + 统计行（每轮尾部 `└ turn` 行） |
| 设置五页（general/models/plugins/inventory/presets） | ✅ `/settings`：搜索框 + 可点击 tab（Tab / ←→ / 鼠标）；凭据 value-free + write-only；预设页与 Web 同机制（空白会话原地切换） |
| 后台任务（列表/杀掉） | ✅ `/jobs`；⚠ 输出内联读取未做（注册表读游标归工具通知） |
| 子代理树 | ✅ `/subagents`（持久化后代树） |
| workflow 运行进度 | ✅ `/workflows`（事件驱动） |
| 会话侧栏/搜索/恢复 | ✅ `/sessions` 面板：live + 持久化会话（最近 50 条，含标题/时间），`/sessions <关键词>` 按 id/标题/模型过滤，Enter 用 `ctx.agents.resume` 恢复并重建转录；同一时刻仅一个 live 会话（切换即销毁旧 agent） |
| Agent 预设切换 | ✅ `/settings` presets 页 + `/presets`：空白会话 Enter 原地 recompose（agent-preset/selected 记录），会话开始后预设锁定——与 Web 同一机制 |
| reasoning effort 选择 | ✅ /settings models 页「推理等级」行组（Enter 选择；`llm.resolveModel` 暴露等级时显示，当前项标注） |
| 插件清单 | ✅ 插件页恢复完整 Loader 插件状态清单并保持只读；启停插件由用户编辑 profile 的 `cordis.patch.yml`，也可以直接要求 Agent 修改该配置文件 |
| 主题 / locale | ✅ 终端固定深色调色板（无主题切换）；`locale`（中文/English）在 /settings general 页 Enter 切换 |
| plan 模式条 / goal 面板 | ✅ 状态栏 `◈ plan`（含 pending 状态）+ transcript 尾 goal dock + `/goal` 详情 |
| 消息反馈（feedback） | ⚠️ `message-feedback` sidecar 与已有评分展示保留；TUI 不再占用 Tab/↑↓/Space/g/b 组合键进入消息选择模式 |
| `/attach` 附件、`/workspace`/`/rename`、fork | ✅ `/rename <标题>`（sessionTitle.rename）、`/workspace <目录>`（chdir，新会话继承）、`/attach <图片>`（attachments.saveImage，随下一条消息发送 + dock）、`/fork [eventSeq]`（seed 分叉到新会话，可经 /sessions 恢复） |
| 交付文件 chips、@文件提及 | ✅ 工具卡 locations/files 行；输入框 `@` 补全工作区相对路径（Tab 插入，目录保留 `/`） |
| Ctrl+K 命令面板 | ⚠ 由 `/` 选择器覆盖（等价语义） |
| 图片粘贴 | ✅ Web 整批拒图 + Grok `[Image #N]`：拖入/粘贴图片路径升级为 chip；Windows **Alt+V**、macOS/Linux Ctrl/Meta+V 读位图剪贴板；`/attach` 仍可用；`/image [N]` 显示 fallback 预览信息；提交走 `attachments.saveImage`；纯文本模型提交前拒绝 |
| MessageList 虚拟化 | ⚠ fold 工作集最近 3000 节点（assistant ≤32 KiB，think/tool/context ≤4 KiB，user ≤8 KiB）+ 视口切片 + 节点行缓存；session log 仍是全文；尚未采用 Web 的 50-message 向前分页 |
| 对话复制（拖选 / 输入框 / `/copy`） | ✅ 默认拖选复制提示词和回复；输入框 TUI 选区（Ctrl+A/C/V）；`/copy`；剩余项见 [bug.md](./bug.md) |

## Status

| Item | State |
|---|---|
| 拖选复制提示词和回复；输入框 Ctrl+A/C/V；`/copy` | 已完成 |
| 输入框第一折行仍吞一格 | 待办 — [bug.md](./bug.md) |
| 大段终端粘贴折叠 token 与完整原文提交 | 已完成 |
| 流式合并发布、增量折行、独立微光、窗口化命中、视口局部节点缓存、流式发布跳过面板重算（[#14](https://github.com/jame100101/deepseek-harness-tui/issues/14)） | 已完成 |
| fold 工作集（3000 行、正文封顶）+ 首帧后再加载目录/设置/反馈；`pnpm dsh:tui` 走构建产物 | 已完成 |
| 无密钥性能验收：40 ms 合并发布、增量折行、滚轮 p99、100/500 轮 fold heap、构建产物 `--version`/`--help`（[#14](https://github.com/jame100101/deepseek-harness-tui/issues/14)） | 已完成 |
| Grok `[Image #N]` chip、跨平台图片粘贴、原子删除、Web 整批上限、精确路由识图检查 | 已完成 |

## Model Experience

### 用户图片 block

#### What the model sees

本包不注册工具、prompt section、动态 context 或 title provider。用户选择的图片经 `ctx.attachments` 持久化，并以图片 block 进入 user message；`[Image #N]` 只属于 composer chrome，提交前会从文本 block 中移除。

大段粘贴 token 同样只属于 composer chrome。提交时会先展开成保留的完整粘贴文本，再交给模型或已注册的斜杠命令。

#### Token effect

TUI 自身不增加文本 token。图片 token 计量由具体模型和 provider 决定。

#### KV Cache effect

纯文本请求与不挂载表层时保持字节一致。图片请求会按设计携带用户选择的耐久图片 block；当前 Harness adapter 负责请求图片投影和 provider 上传复用。

## Known Limitations and Deferred Work

- **Non-TTY fallback is fail-closed**: the linear REPL mounts no answerer, so approval asks deny and `ask_user` fails — headless-strict semantics, matching `phi run`. TUI-local slash commands print a "linear mode" notice instead of leaking into a model turn.
- **输入框折行**使用最多五行的光标窗口。尚未修好的第一折行单元格问题见 [bug.md](./bug.md)。
- **Pending steering has no transcript bubble yet** (the queue dock shows the queued steer previews).
- **Mouse clicks are wired for transcript controls**: trailing disclosure arrows, the right-edge scrollbar (click/drag jump), the back-to-bottom button, and default drag-copy of prompt/reply text.
- **图片预览使用终端安全的元数据**：`/image [N]` 显示待发送文件名、内蕴尺寸和字节数。TUI 不在 Ink 的备用屏 repaint 生命周期之外写 Kitty/iTerm 图形协议。
- **Markdown styling covers headings, paragraphs, and GFM tables**: list items and blockquote interiors stay plain text (remaining GFM pass).
- **Resume still reads the complete authoritative session log** because the resumed Agent requires complete replay; the TUI fold is a 3000-row working set with capped bodies, and the display projection is windowed, but history transport is not yet Web-style backward paging.
- **日常启动走构建产物。** `pnpm run build` 之后用 `pnpm dsh:tui`（单进程、`apps/cli/lib/bin.js --profile tui`）或 `pnpm dsh-tui`。`pnpm dsh --profile tui` 是 tsx 源码路径。
