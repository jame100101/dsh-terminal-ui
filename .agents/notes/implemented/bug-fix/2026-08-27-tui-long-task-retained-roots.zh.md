# Agent Note: 为 TUI 长任务的驻留根加上界

Status: implemented

[English](2026-08-27-tui-long-task-retained-roots.md) | 中文

## Problem

一次长 TUI 会话在 dsh 子 Node 进程上以约 4 GB 的 V8 heap 和 `Ineffective mark-compacts near heap limit` 结束。截图确认驻留 heap 就在该进程里，随后原生 fatal 跳过了 Ink 清理，把 mouse tracking、bracketed paste、隐藏光标和备用屏幕留在父进程 PowerShell 上。

有四条 TUI 自有驻留路径可以随进程寿命无限增长，且没有产品上限：

1. Ink 的输入 parser 只用一个 `pending` 字符串。缺少 `ESC[201~` 的 `ESC[200~` 会把后续按键和 SGR mouse report 全部拼进该字符串，没有体积或空闲上限。
2. 交互帧写入 stdout 时不看 `write()` / `drain`。Windows 全屏还会清屏并重写整帧，因此缓慢的 ConPTY 可以排队过期画面。
3. composer 的 optimistic draft 是完整字符串的 `Set`；live fold 在可见正文已经顶到 cap 之后仍对每个 assistant/reasoning delta 做拼接。
4. wrapper 启动 React 时没有设置 `NODE_ENV`。React 19 development reconciler 会为每个变化的 component 和 prop 写 User Timing measure，Node 会保留这些记录；运行 20 秒后的 heap snapshot 中已有约 30,000 个 `PerformanceMeasure` 对象和重复的 `Changed Props` 记录。

调高 `--max-old-space-size` 只会推迟同一种驻留 heap 崩溃。官方 session log 仍是 append-only；这次改动不改写它们。

## Decision

TUI 的 Ink 补丁拥有有界 paste 状态机：`normal` / 未完成 CSI / `paste`。paste 字节留在 chunk 列表里，结束标记跨 chunk 做增量匹配。产品上限是未完成 paste 1 MiB、未完成 CSI 64 个字符，以及 Ink App 里 2 秒无进展超时。体积 abort 会记录 `limit`、释放已累计正文，只保留结束标记的跨 chunk 重叠，并持续丢弃输入直到 `ESC[201~`；该标记之后的字节才回到普通按键解析。空闲超时与 `reset()` 记录各自 abort 原因后直接回到普通输入，焦点和挂起走同一条 reset 路径。

`runInk` 打开 `incrementalRendering`、`windowsFullscreenDiff` 和 `coalesceBackpressuredFrames`。最后一列留空已经让 Windows 行差分安全；补丁因此在该选项开启且终端尺寸未变时跳过 Windows 全屏 `clearTerminal` 路径。列数或行数变化会把 `pendingTerminalResets` 设为 2，丢掉增量行缓存且不写 `eraseLines`，并对 resize 监听器里那次旧树绘制和随后匹配尺寸的 React commit 各做一次 `clearTerminal`。同尺寸且变化 1–8 行的帧用绝对 CUP 和 ASCII cell 前缀重写那些行。高度变化或更大增量在 Windows 上仍用 CUP 1;1 加 erase-down，不再相对 `eraseLines` 或 `cursorNextLine` 逐行走，因此 ConPTY 折行和滚动不会留下重叠单元格。`write()` 返回 false 时只保留一次待重绘；`drain` 相对最后一张已被接受的帧绘制当前树。

log-update 会保留最后一次已挂载的光标，直到 `useCursor` cleanup 提交 `undefined`，因此 Transcript 或 StatusBar 的 timer 帧不会把 IME 光标藏掉。Thinking、compaction、pulse 和 status motion 共用 Ink animation scheduler。键盘与 paste 事件会取消待执行的动画节流绘制，并请求一次即时绘制。busy 状态只在切换时写一次不闪烁的竖线光标，idle、unmount 和 launcher cleanup 都会恢复终端默认样式。

状态星号在有 live think/text 时每 250 ms 更新一次，安静 busy 时每 400 ms 更新一次，因此 reasoning 输出和长时间 PowerShell 等待都不会驱动 10 Hz 状态重绘。live Thinking 正文只保留一个按显示单元格限制的源文本后缀，并且只消费每次追加的 delta；新行或非追加替换会重置该后缀。`  │ ` 前缀计入行宽预算，所以 CJK 或 emoji 尾部不会让 Ink 把单行 Box 折行并覆盖相邻行。

`dsh-tui` 在每个交互 child 退出后（包括原生 fatal）写出幂等的父进程复位：关闭 mouse 1000/1002/1003/1006、关闭 bracketed paste、显示光标、离开备用屏幕、SGR reset。print 模式不写这些序列。

wrapper 会在任何 React 或 Ink import 之前给 dsh child 设置 `NODE_ENV=production`。React production entry 不会产生 development User Timing 流；自动化的 3,000 node、25 Hz ConPTY fixture 在两分钟内的 peak RSS 为 250.3 MB，warm-up 后进入平台期，而相同 source graph 之前两分钟达到 608.0 MB 且仍持续上升。仓库评估器留在发布 launcher 与 package runtime 之外。

composer 显示读取本地 draft。由 App 赋值的草稿会增加 `draftSeq`，因此提交、历史、选择器和 chip 回写仍然生效。`onChange` 按键不增加该计数器，滞后的父层回显不能替换最新 draft，也不会把光标跳走。live fold 在正文已经顶到 cap 后跳过 text/reasoning delta 的拼接；当 `live` 和 `nodes` 仍是同一对象时，合帧 UI publish 也会跳过。todo 和 goal dock 在按单元格安全截断后仍保留样式分段：待办/已完成使用 `#C9B84A` / `#3FB950`，分隔符使用 `#666666`，goal 标题/正文使用 `#61D6D6` / `#A7A7A7`。Shift+Tab 对每个传统 report 同步切换权限，Kitty 的 press/repeat/release report 只接受 `press`，因此物理按键不会排队一个在后续提示词提交或 busy 重绘时才显现的权限切换。resume 会在权威 session log 读取前发布第零阶段进度并安装取消处理，读取完成后再更新总量并开始 fold replay。

## Alternatives considered

**提高 V8 `--max-old-space-size`。** 这只会放大同一批驻留对象和整机压力，不是上界。

**在这次改动里把 Ink 换成 pi-tui 或 OpenTUI。** 那些 renderer 同样需要有界 paste parser、只保留最新帧的输出，以及父进程复位。换树关不上这些崩溃驻留根。

**体积 abort 后立刻回到普通按键。** 持续到达的超大 paste 会把后续每个 chunk 变成 composer 输入，在 parser 外重新制造同一份内存压力。体积 abort 会保持零正文的丢弃模式直到 bracketed-paste 结束标记；timeout 和 reset 才会直接回到普通输入。

**继续用 `Set` 保存每一份 in-flight draft。** 那正是无界中间字符串驻留器。一份本地 draft 加上 `draftSeq` 就足以区分回显和权威覆盖。

**对已经饱和的 assistant chunk 仍做 publish。** 可见正文没有变化，这次 publish 只是在长任务已经饿死的同一条输出路径上浪费 React/Ink 工作。

**继续用 Ink 在宽度变窄时 `eraseLines`，并在 resize 监听器里立刻绘制。** ConPTY 会先回流已有单元格。`eraseLines` 再用上一帧的行数去擦已经回流的缓冲区，于是 permission/status 碎片会落到 transcript 中间。立刻绘制还会用仍持有旧 Box 宽高的 React 树。

**因为叠字而关掉 `windowsFullscreenDiff`。** 那会让每次 busy 帧都整屏 clear，重新打开 4 GB 的 stdout 队列路径。

**在 Windows 全屏上继续用 `cursorNextLine` 逐行走或相对 `eraseLines`。** 更早一帧的 CJK 或折行偏差会让之后每一次 skip 都错位，也就是 Thinking/permission 叠在正文上。绝对 CUP + ED 不继承那个光标。

**只认 `cursorDirty` 为光标意图。** StatusBar 或 Transcript 的 timer 帧会把 IME 光标藏掉，直到下一次按键。

## Consequences

缺少 paste-end、缓慢 stdout、React development measure 和长 live 流不再拥有 TUI 自有的无界驻留字符串、measurement list 或帧队列。TUI 显式启用 `windowsFullscreenDiff` 后，同尺寸且变化 1–8 行的帧用绝对 CUP 加 ASCII cell 前缀，高度变化或更大增量在 Windows 上从 CUP 1;1 加 erase-down 重写，因此 ConPTY 折行不会留下旧单元格；其他 Ink incremental surface 保留上游 relative renderer。工具行按 `callId` 配对，失败位取自 tool-result 的 `isError`；Code Mode 子调用折成子行。transcript 滚轮复用 memoized 高度前缀和，并在一个 microtask 里合并 ticks。面板刷新按目标隔离，一秒一次的 jobs 轮询不再读取 subagent 后代或持久化 session/title corpus。官方 session event log 仍是进程内存下限，TUI 不改写它。TUI projection sidecar 只把完整 idle turn 的 fold 存在 `$DSH_HOME/tui/projections/`，每个 session 最多保留一份待写快照。恢复期间旧 session 保持可见，缓存 suffix 或完整日志折叠完成后再同时切换 session 和 fold；第零阶段可在初次读取期间取消，取消会 dispose 预备 handle，composer draft 留在本地直到 replay 结束。Shift+Tab 先画本地 pending 权限 chip，等 sandbox snapshot 对账。todo/goal dock 保留 glyph 和文字，颜色跟 status/phase。生产 launcher 与 bundled TUI 不含性能 logger 或 viewer。仓库专用 `evaluation/tui/run-with-perf.mjs` 对普通启动采样并写临时日志，`conpty-soak.mjs` 自动执行 Windows terminal/build campaign，`soak.mjs` 持续推进同一个 fold、parser 和 append-only event list；runtime assembly 会拒绝旧诊断 chunk 与 marker。

## Testing

权限回归会输入 Kitty Shift+Tab 的 press/repeat/release report，并要求只切换一次。真实 PTY busy fixture 随后提交中文 composer 文本并继续以 25 Hz 更新 Thinking/todo/goal，同时要求选中的权限保持不变。

`packages/tui/tui/tests/ink-input-parser.spec.ts` 覆盖完整 paste、跨 chunk 结束标记、缺少结束标记加按键/鼠标、体积 abort 后零正文排空、超限完整 paste、CSI 溢出和 reset。`ink-output-arbiter.spec.ts` 覆盖背压合帧、每秒一帧动画节流下的输入即时绘制、稳定尺寸下 Windows 全屏不写 `ESC[2J`、resize reset 和同尺寸 CJK 行差分。`wrap.spec.ts` 钉住无换行增量 Thinking 尾部、替换检测、换行重置、单元格上限和有界驻留后缀。`render-frame.spec.ts` 覆盖密集 transcript resize、CJK 重绘、单行长 live-Thinking 尾部、延迟裸 `[Z` 与 replay 期间本地 draft。`terminal-pty.spec.ts` 通过真实 PTY 驱动 25 Hz busy fixture，钉住中文编辑与提交、Thinking/todo/goal 实时绘制、Shift+Tab、PageUp/PageDown、输出体积和交互延迟。`status-color.spec.ts`、`cursor-style.spec.ts` 与权限测试分别钉住截断后的精确 dock 分段、busy/退出光标序列和同步单次切换。`soak-budget.spec.ts` 驱动累计 fold、parser 与 session-log 工作。launcher 测试覆盖终端复位、production child environment、普通诊断和 package 排除性能 marker。`process-tree.spec.ts` 钉住仓库 evaluator 的解析、有界后代遍历和去重后的进程树总量。`evaluation/tui/conpty-soak.mjs` 自动执行输入、删除、历史翻页、权限切换、Thinking cadence、进程内存和重复真实构建。fold 与 projection-sidecar 测试保留饱和 live、tool callId/result、Code Mode、replay abort、checkpoint、corruption 和 size-cap 覆盖。
