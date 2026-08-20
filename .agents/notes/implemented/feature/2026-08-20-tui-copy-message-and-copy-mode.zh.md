# Agent Note: TUI 用默认拖选复制提示词和回复

Status: implemented

[English](2026-08-20-tui-copy-message-and-copy-mode.md) | 中文

## Problem

滚轮和滚动条需要鼠标跟踪（`ENABLE_WHEEL_MOUSE`），宿主终端因此不能原生拖选 transcript。单独的 Copy Mode 要先关跟踪，多一层仪式。Grok 的默认是拖选高亮并自动复制，不用切换模式。单击不得选中或复制一条消息。Issue #12 的 Copy Mode / Tab / `y` 和这个不一致。

## Decision

复制是 transcript 上的默认鼠标路径，不是一种模式。左键在已绘制的行上拖选会反色高亮，松开时通过 `clipboard.ts` 复制（stdin 喂给 `clip` / `pbcopy` / `xclip` / `wl-copy`，OSC 52 兜底）。松开即复制并立刻清掉高亮（Grok 默认）。选区两个方向都包含头尾整字。拖到顶部或底部会自动滚动，以便选中当前看不见的历史；拖选过程中的滚轮忽略。绘制按字形起始列切分，CJK 不会在断点重复，也不会把已折好的行再折成两行。Windows 的 `clip.exe` 吃 UTF-16 LE（带 BOM）；UTF-8 stdin 在中文 Windows 上会变成系统代码页乱码。消息之间的空行可以起选或继续拖选，但不会进入剪贴板。composer 是 TUI 自己的编辑器（不是宿主终端的选区）：拖选或 `Ctrl+A` 用蓝色背景选中，`Ctrl+C` 复制该范围，`Ctrl+V` 或终端粘贴插入，输入或粘贴会替换当前选区。composer 松开鼠标会保留高亮，不会自动复制。每一折行在分配的盒子里画 2 格的 `› `/缩进，第一行和后面的行共用同一折行宽度；提示符只作为第一行的兄弟节点时，该行末字会从绘制和拖选复制里消失。折行比绘制盒子少 1 格，满行不会把末字裁掉（Ink 在宽度相等时 truncate、Windows Terminal 的 pending-wrap）。换行和鼠标命中共用这个文本宽度。输入框有文字时方向键移动光标（含折行），空草稿时 ↑/↓ 回忆提交历史。硬换行达到 4 行及以上时收成一行预览加行数。单击且没有拖动不会选中或复制消息。`Esc` 仍可清掉 transcript 高亮或 composer 选区。滚轮、滚动条、disclosure 箭头、回到底部按钮在命中时仍优先。

`/copy` 复制最近一条助手回复；`/copy n` 是第 n 条最近回复（Grok 编号）。提示词和回复靠拖选复制，不是靠单击。没有 `/select`，没有 `Ctrl+Y` Copy Mode，应用运行期间鼠标跟踪保持开启。输入框有选区时 `Ctrl+C` 复制该选区，否则仍是取消 / 连按退出。线性/print 模式不实现剪贴板快捷键。

## Alternatives considered

### Why not keep Copy Mode (`DISABLE_WHEEL_MOUSE` + host-terminal selection)?

那是多出来的模式。Grok 在鼠标上报仍然开启时就能拖选复制。用户复制提示词和回复时不需要记一套进入组合键。

### Why not restore Tab message selection and `y`?

Idle Tab 给 slash palette 和设置。`y` 会吃掉 composer 里 `yesterday` 的首字符。

### Why not implement a grapheme engine over the raw session log?

屏幕上的行已经 wrap 过。拖选读这些格子（CJK 走 `string-width`），只有范围包含行首时才去掉 `▸ ` / `● `。行尾填充空格不可选；跨一行且只动一列视为单击抖动，不是拖选。高亮的相邻切片按起始列归属，拼接后等于原行。

## Consequences

滚轮和滚动条继续可用，但正在拖选文本时忽略滚轮，改为指针顶住会话边缘时自动滚动。单击提示或回复不会选中或复制。拖选复制高亮片段、写入剪贴板并清掉反色。`/copy` 只针对助手回复。

## Testing

`packages/tui/tui/tests/selection.spec.ts` 覆盖显示列切片、CJK 无重叠切分、反向拖选包含头尾整字、chrome 剥离、跳过空行、范围顺序，以及单击抖动与拖选的区分。`copy-text.spec.ts` 覆盖语义提取和第 n 条最近 `/copy`。`clipboard.spec.ts` 覆盖 OSC 52、双失败、stdin 管道、Windows `clip` 的 UTF-16 LE（带 BOM），以及剪贴板读取。`render-frame.spec.ts` 覆盖单击不复制也不高亮、拖选复制并在松开时清掉反色、纵向拖选既不重复一行也不移动其他行、拖到顶部自动滚出更早历史、折行后含第一行在内每个字形都还在、有草稿时方向键移动光标、空草稿才回忆历史、Ctrl+A 后输入替换 composer 草稿、`/copy` 不调用 `submit`，以及复制后滚轮仍可用。
