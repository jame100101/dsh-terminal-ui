# TUI composer bugs (open)

Conversation copy/paste is accepted (transcript drag-copy, composer Ctrl+A/C/V, `/copy`). This composer defect remains. Do not treat it as a blocker for [#14](https://github.com/jame100101/deepseek-harness-tui/issues/14).

## 1. First wrap line still swallows a cell

On Windows Terminal, the last cell of the **first** composer wrap row can still drop a glyph. A typical case is CJK punctuation at the wrap (`一段时间（小时…` painting as `一段时间 (`). Later wrap rows are usually intact.

Already tried, still not enough:

- Paint `› ` / two-space indent on every wrap row so line 0 shares the wrap budget with later rows.
- Wrap one cell sooner than the painted text box (`COMPOSER_WRAP_GUTTER`).

Likely leftovers: East-Asian ambiguous width of `›`, Ink `truncate` when content width meets the box, Windows Terminal pending-wrap on that physical row.
