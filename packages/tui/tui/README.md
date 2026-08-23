# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

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
- **Busy chrome**: the live Thinking row leads with a braille spinner in a stable magenta; compaction uses a yellow spinner row; neither row sweeps hues. `/trajectory` colors model turns blue, tool activity red, and user input cyan. The status-bar activity text uses soft cyan-blue while Thinking, replying, calling tools, or awaiting work, and muted blue while idle; only the busy star glyph (`✶✸✹✺`) animates. User prompts use a gray block background (Grok `bg = light`) plus one blank row above and below. Assistant markdown keeps one blank row between blocks; think/tool/assistant nodes stay flush.
- **Fullscreen caret contract**: the composer passes `measureElement()` coordinates unchanged to Ink's `useCursor`; the pinned Ink patch derives every suffix origin, including cursor-only updates, from the output's actual final row, so first paint, whitespace input, navigation, and repeated fullscreen repaint share one zero-based row model.
- **Tool render-intent cards**: every tool row projects its `presentCall`/`presentResult` view (generic / terminal / diff / search / read / web) into terminal blocks, collapsed by default.
- **`/settings` five pages**: a Claude Code-style chrome (search field, clickable tab strip, Tab / ←→ to cycle, Esc to close) over general (busyEnter Queue/Steer, thinking default display — persisted to the `tui` namespace of `$DSH_HOME/settings.yaml`, live), models (provider names as cyan section titles, default selection, value-free credential rows that write through `ctx.credentials` with masked input and a confirm gate), plugins (complete read-only Loader status list; enable/disable changes belong in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, which the user can edit directly or ask the Agent to update), inventory (settings namespaces + credential refs + inspect providers), presets (agent presets: `Enter` recomposes the BLANK session in place — the Web mechanism; once the conversation starts its preset is fixed; the current preset is `●`-marked, broken presets are dimmed).
- **`/jobs` panel**: live registry rows (id/kind/label/status/elapsed/detail) refreshed every second while open; Enter requests a kill for running jobs. **`/subagents` panel**: the durable descendant tree (depth-indented, mode/activity/label, diagnostics). **`/workflows` panel**: event-driven run rows (status/phase/log/agent-count/error).
- **`/model`** opens the models settings page (select the default with Enter). **`/sessions`** loads the live agent plus the newest 50 persisted sessions (titles/filter) on first open rather than scanning persisted logs during startup; `Enter` resumes one with full history replay — exactly ONE live session exists at a time (switches dispose the previous agent; `/fork` yields a persisted, resumable artifact). **`/new`** starts a fresh session.
- **Bounded transcript work**: complete-log resume uses a private linear replay builder, while settled display rows are cached per immutable node, terminal width, expansion, feedback, and locale. Composer and slash-picker updates reuse those projections and slice the visible viewport without copying the complete wrapped-line list.
- **Collapsible rows** (context `◆`/Thinking/tool/retry): click the trailing `▶`/`▼` directly. Context/tool/retry retain per-node expansion; clicking any Thinking arrow changes the persisted global Thinking display, updates every Thinking row together, and keeps the header's `thinking on/off` label synchronized. Idle Tab has no transcript-selection mode, arrows move the composer caret when the draft is nonempty (including across wrap rows) and recall input history when it is empty, and Space remains ordinary draft input.
- **Slash picker** (`/`) lists host and TUI-local commands **alphabetically (a–z)** in the DamnatioX palette style. `/skills` opens a second picker for the current agent scope's user-invocable skills; commands win same-name conflicts, and selecting a skill inserts its literal `/name ` invocation for the existing skill pre-step plugin. The `@` picker lists workspace files before other sessions and inserts canonical `dsh-session:` mentions whose bounded context is prepared by the official session-reference plugin.
- **Approval and ask_user takeovers** support allow-once / deny, batched questions, single- and multi-select options, custom text, and Shift+Enter newlines. **`/trajectory`** provides the structured view; **todo and queue docks** stay at the transcript tail.
- **`Ctrl+Enter` steers** a running turn (`busyEnter` assigns plain Enter while busy); `Esc` cancels; `Ctrl+D` quits when idle; `Ctrl+L` clears; double `Ctrl+C` within 2s exits. `Ctrl+C` copies the composer selection when one exists (and does not cancel).
- **Copy and feedback** (Grok-style, always on): drag across a prompt or reply to highlight and auto-copy; mouse-up copies and clears the highlight. A click without a drag does not select a message. Blank spacer rows between messages can start or continue a drag but are omitted from the clipboard. Dragging to the top or bottom edge scrolls so the selection can continue through off-screen history. The composer is a TUI-owned editor: drag or `Ctrl+A` selects with a blue highlight, `Ctrl+C` copies, `Ctrl+V` (or terminal paste) inserts, and typing or paste replaces the selection. Every wrap row paints a 2-cell `› `/indent prefix so line 0 uses the same wrap budget as later rows, and wrap stops one cell before the painted box so a full row cannot clip its last glyph. A paste of at least 1,000 Unicode characters or 20 logical lines becomes one atomic `[Pasted text #N +M lines]` token while LF, CRLF, and bare-CR clipboard lines are counted consistently and the normalized complete text is retained for submission; ordinary typed multi-line drafts keep the five-row caret window. `/copy` copies the latest assistant reply; `/copy n` is the Nth-latest. `/rate up|down [n]` toggles durable feedback on the Nth-latest assistant reply without taking over Tab, arrows, or Space. Wheel, scrollbar, and disclosure clicks stay TUI-owned. Linear/print mode does not implement clipboard shortcuts.

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
| 交付文件 chips、@引用 | ✅ 每轮成功 mutation 的 locations 汇总为产出行；composer `@` 补全工作区相对路径和其他会话的规范 mention |
| Ctrl+K 命令面板 | ⚠ 由 `/` 选择器覆盖（等价语义） |
| 图片粘贴 | ✅ Web 整批拒图 + Grok `[Image #N]`：多路径粘贴经 `attachments.saveImages` 整批校验后一次加入，拖入单图、跨平台位图剪贴板、`/attach` 与 `/image [N]` 保留；纯文本模型提交前拒绝 |
| MessageList 虚拟化 | ⚠ fold 工作集最近 3000 节点（assistant ≤32 KiB，think/tool/context ≤4 KiB，user ≤8 KiB）+ 视口切片 + 节点行缓存；session log 仍是全文；尚未采用 Web 的 50-message 向前分页 |
| 对话复制（拖选 / 输入框 / `/copy`） | ✅ 默认拖选复制提示词和回复；输入框 TUI 选区（Ctrl+A/C/V）；`/copy`；剩余项见 [bug.md](./bug.md) |

## Status

| Item | State |
|---|---|
| Drag-copy of prompts and replies; composer Ctrl+A/C/V; `/copy` | Done |
| Composer first wrap line swallowing a cell | Open — [bug.md](./bug.md) |
| Large terminal paste capsule with exact-text submission | Done |
| Streaming coalesce, incremental wrap, isolated shimmer, windowed hit-test, viewport-local node cache, stream publish skips panel recompute ([#14](https://github.com/jame100101/deepseek-harness-tui/issues/14)) | Done |
| Fold working set (3000 rows, capped bodies) + deferred catalog/settings/feedback after first paint; `pnpm dsh:tui` built launch | Done |
| Keyless perf acceptance: 40 ms coalesce, incremental wrap, wheel p99, 100/500-turn fold heap, built `--version`/`--help` ([#14](https://github.com/jame100101/deepseek-harness-tui/issues/14)) | Done |
| Grok `[Image #N]` chips, cross-platform image paste, atomic deletion, Web batch limits, exact-route vision check | Done |

## Model Experience

### User image blocks

#### What the model sees

The package registers no tools, prompt sections, dynamic context, or title providers. A user-selected image is persisted through `ctx.attachments` and enters the user message as an image block; `[Image #N]` is composer chrome and is removed from the text block before submission. Large-paste tokens are also composer chrome: the model and registered slash commands receive the retained pasted text after the token is expanded on submit.

#### Token effect

The TUI adds no text tokens of its own. Image token accounting is model- and provider-specific.

#### KV Cache effect

Text-only requests remain byte-identical to a surface-less composition. Image requests intentionally differ because the selected durable image blocks are model-visible; the current Harness adapter owns request-image projection and provider upload reuse.

## Known Limitations and Deferred Work

- **Non-TTY fallback is fail-closed**: the linear REPL mounts no answerer, so approval asks deny and `ask_user` fails — headless-strict semantics, matching `phi run`. TUI-local slash commands print a "linear mode" notice instead of leaking into a model turn.
- **Composer wrap** is multi-line with a five-row caret window. The remaining first-wrap-cell defect is tracked in [bug.md](./bug.md).
- **Pending steering has no transcript bubble yet** (the queue dock shows the queued steer previews).
- **Mouse clicks are wired for transcript controls**: trailing disclosure arrows, the right-edge scrollbar (click/drag jump), the back-to-bottom button, and default drag-copy of prompt/reply text.
- **Image preview uses terminal-safe metadata**: `/image [N]` shows the pending file name, intrinsic dimensions, and byte size. Kitty/iTerm graphics are not written outside Ink's alternate-screen repaint lifecycle.
- **Markdown styling covers headings, paragraphs, and GFM tables**: list items and blockquote interiors stay plain text (remaining GFM pass).
- **Resume still reads the complete authoritative session log** because the resumed Agent requires complete replay; the TUI fold is a 3000-row working set with capped bodies, and the display projection is windowed, but history transport is not yet Web-style backward paging.
- **Daily launch uses built artifacts.** After `pnpm run build`, `pnpm dsh:tui` runs `apps/cli/lib/bin.js --profile tui` in one Node process. `pnpm dsh-tui` is the wrapper over the same built bin. `pnpm dsh --profile tui` is the tsx source path.
