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
- **DeepSeek 会话费用**：权限行右边缘以 `$N.NNN` 显示估算金额，使用与 pi-ai 0.82.1 相同的每百万 token 美元费率和精度。fold 根据每个已完成 step 自己的耐久 `request/header` 路由和互斥 usage bucket 分别计价，因此 `/model` 变化不会重算先前 step，reasoning 也不会重复计费。
- **Retry rows**: one muted, collapsible row per retry chain — `⟳ retry n/max · 12s 后` with a client-anchored countdown (ceil, 1s floor), shimmer while waiting, `∞` in always mode; the expand body shows provider/policy/failure code/HTTP status/latest delay and never the failure message (credential safety, Web parity).
- **Markdown inline styling**: assistant prose renders bold, inline code (cyan), links (underline), and emphasis as per-run colored segments, wrapped cell-accurately so styles survive line breaks; code fences, lists, and blockquotes stay structural, and GFM tables render as CJK-width-aligned `│` grids that shrink to the terminal width.
- **Busy-stream input safety**: Ink flushes a lone `\x1b` as Escape after 20ms, so a split arrow sequence under a busy stream used to wipe the draft and dismiss the picker; the renderer now confirms every Escape (60ms) and re-synthesizes the split key tail, keeping the picker open and arrow-navigable while a turn streams. Streaming `assistant/chunk` UI publishes coalesce at 40ms，live assistant 折行按增量更新，可见 live Thinking 正文只保留一个按单元格限制的增量尾部，不再每帧切分并测量全部累积 reasoning 文本。键盘与粘贴提交会请求一次即时绘制，不再排在动画节流之后。Thinking、compaction 与状态动画共用 Ink scheduler 并留在隔离子树中，tick 不会重新投影稳定历史（fold 保持 settled 数组引用稳定，tool card 正文限制为 400 行、每行 300 cells）。每次新的 `/` 按键都会重新启用 picker，任一按键都会清除过期 dismissal，因此 `/` 不会被静默抑制。
- **离散权限输入**：Shift+Tab 每次物理按下只切换一次文件权限。Kitty 增强键盘协议的 repeat 和 release report 会被消费但不会再次切换，因此提交提示词或 busy 回合重绘不会应用延迟到达的权限变化。
- **忙碌状态界面**：实时 Thinking 行使用稳定的洋红色 braille spinner，compaction 使用黄色 spinner，二者都不做色相扫动。`/trajectory` 中模型轮次为蓝色、工具活动为红色、用户输入为青色。状态栏的活动文字及前导图标在忙碌和 idle 时都使用精确的 `#61D6D6` TrueColor；忙碌星形字形（`✶✸✹✺`）在有 live 输出时每 250ms 更新一次，静默等待工具时每 400ms 更新一次。todo dock 整行使用 `#8A8A8A`，goal dock 整行使用 `#61D6D6`。紧凑欢迎卡片使用 `#A99B45`。物理 composer 光标在 busy 时使用不闪烁的竖线，idle 或退出时恢复终端默认样式，不会在长工具输出期间持续闪烁。用户提示使用灰色块背景（Grok `bg = light`），上下各保留一行空白。助手 Markdown 的块之间保留一行空白，think/tool/assistant 节点保持相邻。
- **Fullscreen caret contract**: the composer passes `measureElement()` coordinates unchanged to Ink's `useCursor`; the pinned Ink patch derives every suffix origin, including cursor-only updates, from the output's actual final row, so first paint, whitespace input, navigation, and repeated fullscreen repaint share one zero-based row model.
- **Tool render-intent cards**: every tool row projects its `presentCall`/`presentResult` view (generic / terminal / diff / search / read / web) into terminal blocks, collapsed by default.
- **`/settings` five pages**: a Claude Code-style chrome (search field, clickable tab strip, Tab / ←→ to cycle, Esc to close) over general (busyEnter Queue/Steer, thinking default display — persisted to the `tui` namespace of `$DSH_HOME/settings.yaml`, live), models (provider names as cyan section titles, default selection, value-free credential rows that write through `ctx.credentials` with masked input and a confirm gate), plugins (complete read-only Loader status list; enable/disable changes belong in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, which the user can edit directly or ask the Agent to update), inventory (settings namespaces + credential refs + inspect providers), presets (agent presets: `Enter` recomposes the BLANK session in place — the Web mechanism; once the conversation starts its preset is fixed; the current preset is `●`-marked, broken presets are dimmed).
- **`/jobs` panel**: live registry rows (id/kind/label/status/elapsed/detail) refreshed every second while open; Enter requests a kill for running jobs. **`/subagents` panel**: the durable descendant tree (depth-indented, mode/activity/label, diagnostics). **`/workflows` panel**: event-driven run rows (status/phase/log/agent-count/error).
- **`/model`** opens the models settings page (select the default with Enter). **`/sessions`** loads the live agent plus the newest 50 persisted sessions (titles/filter) on first open rather than scanning persisted logs during startup; `Enter` resumes one with full history replay — exactly ONE live session exists at a time (switches dispose the previous agent; `/fork` yields a persisted, resumable artifact). 面板刷新彼此隔离：`/jobs` 的一秒轮询只读取 job registry，session/title 读取只在打开 `/sessions` 时执行。**`/new`** starts a fresh session。**`--continue` / `-c`** 通过 `$DSH_HOME/tui/session-recency.json` 选择当前 cwd 中最后一次在 TUI 前台使用的持久化会话，而不是选择创建时间最新的会话；索引默认保留 1,000 个会话生命周期记录，可用 `sessionRecencyMaxEntries` 调整上限。某个 cwd 尚无匹配记录时，仅按创建时间迁移顶层会话，因此新建的后台 subagent 不会接管继续目标。
- **有界 transcript 工作集**：完整日志恢复会在磁盘读取前发布第零阶段加载状态，因此读取权威日志期间 Escape 取消和进度界面已经生效，随后再使用私有线性 replay builder。已稳定的显示行按 immutable node、终端宽度、展开状态、feedback 与 locale 缓存。composer 和斜杠选择器复用这些投影，并切出可见 viewport，不复制完整折行列表。完整 idle turn 的投影缓存在 `$DSH_HOME/tui/projections/`；replay 时当前 session 保持可见、draft 仍可编辑，完成后再一起切换 session 与 fold。
- **Collapsible rows** (context `◆`/Thinking/tool/retry): click the trailing `▶`/`▼` directly. Context/tool/retry retain per-node expansion; clicking any Thinking arrow changes the persisted global Thinking display, updates every Thinking row together, and keeps the header's `thinking on/off` label synchronized. Idle Tab 没有 transcript 选中模式；输入框有文字时方向键移动光标（含折行），空草稿时 ↑/↓ 回忆提交历史；Space 仍是普通输入。
- **斜杠选择器**（`/`）按字母顺序列出 Host 命令和 TUI 本地命令。`/skills` 会打开第二级选择器，列出当前 agent scope 中允许用户调用的 skill；同名时命令优先，选择 skill 会插入字面量 `/name `，继续由现有 skill pre-step 插件处理。`@` 选择器先列工作区文件，再列其他会话；会话项插入规范 `dsh-session:` mention，由官方 session-reference 插件准备有界上下文。
- **审批与 ask_user 接管区**支持 allow-once / deny、批量问题、单选、多选、自定义文本和 Shift+Enter 换行。**`/trajectory`** 提供结构化视图；**todo 与 queue dock** 保持在 transcript 尾部。
- **`Ctrl+Enter` steers** a running turn (`busyEnter` assigns plain Enter while busy); `Esc` cancels; `Ctrl+D` quits when idle; `Ctrl+L` clears; double `Ctrl+C` within 2s exits. 输入框里有选区时 `Ctrl+C` 复制该选区，不取消任务。
- **复制与反馈**（和 Grok 一样，默认就能用）：在提示词或回复上拖选即可高亮并自动复制；松开鼠标即复制并清掉高亮。单击且没有拖动不会选中整条消息。消息之间的空行可以起选或继续拖选，但不会进入剪贴板。拖到会话顶部或底部会滚动，以便继续选中当前看不见的历史。输入框是 TUI 自己的编辑器：拖选或 `Ctrl+A` 用蓝色背景选中，`Ctrl+C` 复制，`Ctrl+V`（或终端粘贴）插入，输入或粘贴会替换当前选区。每一折行都画一格 `›`/缩进，并在绘制盒子末尾保留一格。选中行把未选前缀、蓝色选区和后缀保留在同一个 Ink 文本布局中，选区样式不会裁切或错开第一折行的字符。一次粘贴达到 1,000 个 Unicode 字符或 20 个逻辑行时，会收成一个可原子删除的 `[Pasted text #N +M lines]` token；LF、CRLF 与单独 CR 的剪贴板行会按相同规则计数，提交时使用保留并规范为 LF 的完整文本。普通手动输入的多行草稿继续使用五行光标窗口。`/copy` 复制最近一条回复；`/copy n` 是第 n 条最近回复。`/rate up|down [n]` 可切换倒数第 n 条助手回复的耐久评价，不占用 Tab、方向键或 Space。滚轮、滚动条、disclosure 仍由 TUI 处理。线性/print 模式不实现剪贴板快捷键。

## Web 功能差距核对（当前 `packages/client/*` 对照）

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
| 消息反馈（feedback） | ✅ `message-feedback` sidecar + 评分展示；`/rate up\|down [n]` 评价倒数第 n 条助手回复，不占用 Tab/↑↓/Space |
| `/attach` 附件、`/workspace`/`/rename`、fork | ✅ `/rename <标题>`（sessionTitle.rename）、`/workspace <目录>`（chdir，新会话继承）、`/attach <图片>`（走 attachments.saveImages 整批入口，随下一条消息发送 + dock）、`/fork [eventSeq]`（seed 分叉到新会话，可经 /sessions 恢复） |
| 交付文件 chips、@引用 | ✅ 每轮成功 mutation 的 locations 汇总为产出行；输入框 `@` 补全工作区相对路径和其他会话的规范 mention |
| Ctrl+K 命令面板 | ⚠ 由 `/` 选择器覆盖（等价语义） |
| 图片粘贴 | ✅ Web 整批拒图 + Grok `[Image #N]`：多路径粘贴经 `attachments.saveImages` 整批校验后一次加入，拖入单图、跨平台位图剪贴板、`/attach` 与 `/image [N]` 保留；纯文本模型提交前拒绝 |
| MessageList 虚拟化 | ⚠ fold 工作集最近 3000 节点（assistant ≤32 KiB，think/tool/context ≤4 KiB，user ≤8 KiB）+ 视口切片 + 节点行缓存；session log 仍是全文；尚未采用 Web 的 50-message 向前分页 |
| 对话复制（拖选 / 输入框 / `/copy`） | ✅ 默认拖选复制提示词和回复；输入框 TUI 选区（Ctrl+A/C/V）；`/copy` |

## Status

| Item | State |
|---|---|
| 拖选复制提示词和回复；输入框 Ctrl+A/C/V；`/copy` | 已完成 |
| 输入框选区保留第一折行的全部字符 | 已完成 |
| 大段终端粘贴折叠 token 与完整原文提交 | 已完成 |
| 流式合并发布、增量折行、独立微光、窗口化命中、视口局部节点缓存、流式发布跳过面板重算（[#14](https://github.com/jame100101/deepseek-harness-tui/issues/14)） | 已完成 |
| fold 工作集（3000 行、正文封顶）+ 首帧后再加载目录/设置/反馈；`pnpm dsh-tui` 走构建产物 | 已完成 |
| 无密钥性能验收：40 ms 合并发布、增量折行、滚轮 p99、100/500 轮 fold heap、构建产物 `--version`/`--help`（[#14](https://github.com/jame100101/deepseek-harness-tui/issues/14)） | 已完成 |
| Grok `[Image #N]` chip、跨平台图片粘贴、原子删除、Web 整批上限、精确路由识图检查 | 已完成 |
| 有界 paste parser、stdout 只保留最新帧、child fatal 后 launcher 复位终端 | 已完成 |

## Model Experience

### 用户图片 block

#### What the model sees

本包不注册工具、prompt section、动态 context 或 title provider。用户选择的图片经 `ctx.attachments` 持久化，并以图片 block 进入 user message；`[Image #N]` 只属于 composer chrome，提交前会从文本 block 中移除。大段粘贴 token 同样只属于 composer chrome；提交时会先展开成保留的完整粘贴文本，再交给模型或已注册的斜杠命令。

#### Token effect

TUI 自身不增加文本 token。图片 token 计量由具体模型和 provider 决定。

#### KV Cache effect

纯文本请求与不挂载表层时保持字节一致。图片请求会按设计携带用户选择的耐久图片 block；当前 Harness adapter 负责请求图片投影和 provider 上传复用。

## Known Limitations and Deferred Work

- **Non-TTY fallback is fail-closed**: the linear REPL mounts no answerer, so approval asks deny and `ask_user` fails — headless-strict semantics, matching `phi run`. TUI-local slash commands print a "linear mode" notice instead of leaking into a model turn.
- **Pending steering has no transcript bubble yet** (the queue dock shows the queued steer previews).
- **Mouse clicks are wired for transcript controls**: trailing disclosure arrows, the right-edge scrollbar (click/drag jump), the back-to-bottom button, and default drag-copy of prompt/reply text.
- **图片预览使用终端安全的元数据**：`/image [N]` 显示待发送文件名、内蕴尺寸和字节数。TUI 不在 Ink 的备用屏 repaint 生命周期之外写 Kitty/iTerm 图形协议。
- **Markdown styling covers headings, paragraphs, and GFM tables**: list items and blockquote interiors stay plain text (remaining GFM pass).
- **Resume still reads the complete authoritative session log** because the resumed Agent requires complete replay; the TUI fold is a 3000-row working set with capped bodies, and the display projection is windowed, but history transport is not yet Web-style backward paging.
- **日常启动统一使用一个构建产物命令。** `pnpm run build` 之后使用 `pnpm dsh-tui`；wrapper 会以 production environment 启动 `apps/cli/lib/bin.js --profile tui` 并负责终端清理。`pnpm dsh --profile tui` 保留为 tsx 源码开发路径，不属于产品性能基线。
- **长任务的 TUI 驻留路径有上界。** 未完成的 bracketed paste、背压下的终端帧、composer 的 optimistic draft 和已经封顶的 live fold 正文都有产品上限。超大 paste 会释放正文并持续排空到 bracketed end marker，而不是转成普通 composer 输入；官方 session log 仍是进程内存下限。
- **长任务评估留在发布 CLI 之外。** 仓库专用的 `pnpm dsh-tui:perf -- <args>` wrapper 会对普通启动做进程树采样并写入临时旁路日志，`pnpm dsh-tui:evaluate:conpty` 执行自动化 30 分钟 Windows ConPTY/构建评估，`pnpm dsh-tui:evaluate:soak` 执行投影 soak。runtime assembly 会拒绝旧诊断 marker，因此 npm launcher 与 bundled TUI 不含性能 logger 或 viewer。launcher 还会强制使用 React production entry；否则 Node 会在每次 busy repaint 时保留 React development User Timing measure。
