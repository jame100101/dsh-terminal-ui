/**
 * Dependency-free plain-text projection of one transcript row. Shared by the
 * non-TTY linear fallback; the Ink renderer uses the same glyph grammar with
 * colors added.
 * @module @deepseek-ai/dsh-tui/src/plain
 */

import { marked } from 'marked'
import stringWidth from 'string-width'
import { sanitizeTerminalText } from './sanitize'
import type { SessionStats, TuiNode } from './types'

/** One inline run with terminal styling intents. */
export interface MdRun {
  text: string
  bold?: boolean
  code?: boolean
  underline?: boolean
  dim?: boolean
}

/** One structural markdown line with a terminal color intent. */
export interface MdLine {
  /** Plain-text projection (the linear fallback and width math source). */
  text: string
  color?: 'cyan' | 'gray' | 'magenta' | 'yellow'
  /** Per-run styling for headings and paragraphs; absent for plain lines. */
  runs?: MdRun[]
}

/** Minimal structural view of one marked inline token. */
interface InlineToken {
  type?: string
  text?: string
  raw?: string
  tokens?: InlineToken[]
}

/** One GFM table cell. */
interface TableCell {
  text?: string
  raw?: string
}

/** Strip the inline markers a plain terminal does not restyle. */
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)]\(.+?\)/g, '$1')
    .replace(/^#{1,6}\s*/, '')
}

/** Walk marked inline tokens into styled runs (bold, code, links, emphasis). */
function inlineRuns(tokens: readonly InlineToken[] | undefined): MdRun[] {
  const out: MdRun[] = []
  const visit = (list: readonly InlineToken[] | undefined, style: Omit<MdRun, 'text'>): void => {
    if (list === undefined) return
    for (const token of list) {
      switch (token.type) {
        case 'text':
          if ((token.tokens?.length ?? 0) > 0) visit(token.tokens, style)
          else if (token.text !== undefined && token.text !== '') out.push({ ...style, text: token.text })
          break
        case 'codespan':
          out.push({ ...style, code: true, text: token.text ?? token.raw ?? '' })
          break
        case 'strong':
          visit(token.tokens ?? [], { ...style, bold: true })
          break
        case 'em':
        case 'del':
          visit(token.tokens ?? [], { ...style, dim: true })
          break
        case 'link':
          visit(token.tokens ?? [], { ...style, underline: true })
          break
        case 'br':
          out.push({ ...style, text: '\n' })
          break
        case 'html':
          // marked tokenizes `<br>` as inline HTML; project it as a break,
          // keep other inline HTML literal.
          if (/^<\/?br\s*\/?>$/i.test(token.raw ?? '')) out.push({ ...style, text: '\n' })
          else if (token.raw !== undefined && token.raw !== '') out.push({ ...style, text: token.raw })
          break
        default:
          if (token.raw !== undefined && token.raw !== '') out.push({ ...style, text: token.raw })
          break
      }
    }
  }
  visit(tokens, {})
  return out
}

/** Split runs on embedded newlines (marked renders `<br>` as '\n'). */
function splitRuns(runs: readonly MdRun[]): MdRun[][] {
  const lines: MdRun[][] = []
  let current: MdRun[] = []
  const pushLine = (): void => {
    lines.push(current)
    current = []
  }
  for (const run of runs) {
    if (!run.text.includes('\n')) {
      if (run.text !== '') current.push(run)
      continue
    }
    run.text.split('\n').forEach((part, index) => {
      if (part !== '') current.push({ ...run, text: part })
      if (index < run.text.split('\n').length - 1) pushLine()
    })
  }
  pushLine()
  return lines
}

/** Plain-text join of runs. */
function runsText(runs: readonly MdRun[]): string {
  return runs.map(run => run.text).join('')
}

/** Fit one cell value into `width` cells, truncating the tail with `…`. */
function fitCell(value: string, width: number): string {
  const safe = sanitizeTerminalText(stripInline(value))
  if (width < 1) return ''
  if (stringWidth(safe) <= width) return safe
  // Reserve one cell for the ellipsis so the truncated cell never outgrows
  // its column (the CJK truncation boundary otherwise adds a cell).
  const budget = Math.max(1, width - 1)
  let out = ''
  let used = 0
  for (const character of safe) {
    const next = Math.max(1, stringWidth(character))
    if (used + next > budget) break
    out += character
    used += next
  }
  return `${out}…`
}

/** Pad a cell value to `width` cells per its alignment. */
function padCell(value: string, width: number, align: 'left' | 'center' | 'right'): string {
  const gap = Math.max(0, width - stringWidth(value))
  if (align === 'right') return `${' '.repeat(gap)}${value}`
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return `${' '.repeat(left)}${value}${' '.repeat(gap - left)}`
  }
  return `${value}${' '.repeat(gap)}`
}

/**
 * Render one GFM table as an aligned `│` grid: a cyan header row, a `├─┼─┤`
 * separator, then the body rows. Column widths come from display widths
 * (CJK-safe), capped so the whole grid fits `maxWidth` cells; oversized
 * columns shrink longest-first and their cells truncate with `…`.
 */
function tableLines(table: { header: TableCell[]; rows: TableCell[][]; align?: (string | null)[] }, maxWidth: number): MdLine[] {
  const align: Array<'left' | 'center' | 'right'> = (table.align ?? []).map(value =>
    value === 'center' ? 'center' : value === 'right' ? 'right' : 'left')
  const header = table.header.map(cell => fitCell(stripInline(cell.text ?? cell.raw ?? ''), Infinity))
  const rows = table.rows.map(row => row.map(cell => fitCell(stripInline(cell.text ?? cell.raw ?? ''), Infinity)))
  const columns = header.length
  if (columns === 0) return []
  const natural = Array.from({ length: columns }, () => 0)
  for (let column = 0; column < columns; column++) {
    natural[column] = stringWidth(header[column] ?? '')
    for (const row of rows) natural[column] = Math.max(natural[column] ?? 0, stringWidth(row[column] ?? ''))
  }
  // Border overhead: `│ ` + ` │` per column plus the trailing `│`.
  const overhead = columns * 3 + 1
  const available = Math.max(columns * 3 + 1, Math.floor(maxWidth))
  const widths = [...natural]
  let total = widths.reduce((sum, width) => sum + width, 0) + overhead
  while (total > available) {
    const widest = widths.reduce((best, width, index) => width > (widths[best] ?? 0) ? index : best, 0)
    const widestValue = widths[widest]
    if (widestValue === undefined || widestValue <= 1) break
    widths[widest] = widestValue - 1
    total -= 1
  }
  const trim = (cell: string, column: number): string => padCell(fitCell(cell, widths[column] ?? 0), widths[column] ?? 0, align[column] ?? 'left')
  const rowLine = (cells: readonly string[]): string =>
    `│ ${cells.map((cell, column) => trim(cell, column)).join(' │ ')} │`
  const out: MdLine[] = [{ text: rowLine(header), color: 'cyan' }]
  out.push({
    text: `├${widths.map(width => '─'.repeat(width + 2)).join('┼')}┤`,
    color: 'gray',
  })
  for (const row of rows) out.push({ text: rowLine(row) })
  return out
}

/** One wrapped line of styled runs, cell-accurate. */
export interface WrappedRunLine {
  /** Plain join, for width math and the linear fallback. */
  text: string
  runs: MdRun[]
}

/**
 * Wrap styled runs by terminal cell width, preserving each segment's style
 * across line breaks. `prefix` prepends the first line only (the assistant's
 * '● ' bullet).
 * @param runs - the unwrapped inline runs.
 * @param width - available cells per line.
 * @param prefix - text prepended to the first line.
 * @returns the wrapped lines.
 */
export function wrapRuns(runs: readonly MdRun[], width: number, prefix: string): WrappedRunLine[] {
  const lines: WrappedRunLine[] = []
  let current: MdRun[] = []
  let currentWidth = 0
  const flush = (): void => {
    if (current.length > 0) {
      lines.push({ text: runsText(current), runs: current })
      current = []
      currentWidth = 0
    }
  }
  const push = (text: string, style: Omit<MdRun, 'text'>): void => {
    let buffer = ''
    const emit = (): void => {
      if (buffer !== '') {
        current.push({ ...style, text: buffer })
        buffer = ''
      }
    }
    for (const character of text) {
      const characterWidth = Math.max(1, stringWidth(character))
      if (currentWidth + characterWidth > width) {
        emit()
        flush()
      }
      buffer += character
      currentWidth += characterWidth
    }
    emit()
  }
  if (prefix !== '') push(prefix, {})
  for (const run of runs) push(run.text, run)
  flush()
  return lines
}

/**
 * Client-anchored retry countdown: whole seconds until the anchored wait
 * ends, rounded up with a 1s floor. Returns null once the row settled or was
 * never anchored (replayed history, pure-fold states).
 * @param retryAt - epoch ms the wait ends.
 * @param now - current epoch ms.
 * @returns remaining seconds or null.
 */
export function retryCountdownSeconds(retryAt: number, now: number): number | null {
  if (retryAt <= 0) return null
  return Math.max(1, Math.ceil((retryAt - now) / 1000))
}

/**
 * Project GFM source into structural terminal lines (headings, code fences,
 * blockquotes, lists, aligned tables, paragraphs) using marked's token
 * stream. Headings and paragraphs carry per-run inline styling (bold, inline
 * code, links, emphasis); the remaining structural lines stay plain.
 * @param source - the assistant markdown.
 * @param maxWidth - terminal cells available for one line; tables scale their
 *   column widths to fit (Infinity keeps natural widths).
 * @returns the structural lines.
 */
export function markdownLines(source: string, maxWidth: number = Number.POSITIVE_INFINITY): MdLine[] {
  const out: MdLine[] = []
  const startBlock = (): void => {
    if (out.length > 0 && out[out.length - 1]?.text !== '') out.push({ text: '' })
  }
  let tokens
  try {
    tokens = marked.lexer(source)
  } catch {
    return source === '' ? [] : source.split('\n').map(text => ({ text }))
  }
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        startBlock()
        const inlineTokens = (token as { tokens?: InlineToken[] }).tokens
        const runs = inlineTokens === undefined
          ? [{ text: stripInline(token.text) }]
          : inlineRuns(inlineTokens)
        for (const line of splitRuns(runs)) {
          out.push({ text: runsText(line), runs: line, color: token.depth <= 2 ? 'cyan' : 'magenta' })
        }
        break
      }
      case 'code': {
        startBlock()
        for (const line of token.text === '' ? [''] : token.text.split('\n')) {
          out.push({ text: `│ ${line}`, color: 'gray' })
        }
        break
      }
      case 'blockquote':
        startBlock()
        for (const line of token.text === '' ? [''] : token.text.split('\n')) {
          out.push({ text: `▎ ${stripInline(line)}`, color: 'gray' })
        }
        break
      case 'list': {
        startBlock()
        for (const item of token.items) {
          const body = item.text === '' && item.tokens !== undefined
            ? (item.tokens as { type: string; text?: string; raw?: string }[])
              .map(inner => inner.type === 'text' ? (inner.text ?? '') : (inner.raw ?? '')).join(' ')
            : item.text
          out.push({ text: `• ${stripInline(body)}` })
        }
        break
      }
      case 'table':
        startBlock()
        out.push(...tableLines(token as never, maxWidth))
        break
      case 'paragraph': {
        startBlock()
        const inlineTokens = (token as { tokens?: InlineToken[] }).tokens
        const runs = inlineTokens === undefined
          ? [{ text: stripInline(token.text) }]
          : inlineRuns(inlineTokens)
        for (const line of splitRuns(runs)) {
          out.push({ text: runsText(line), runs: line })
        }
        break
      }
      case 'space':
        break
      case 'html':
        // Raw HTML never renders in the terminal.
        break
      default:
        for (const line of token.raw === '' ? [''] : token.raw.split('\n')) {
          out.push({ text: stripInline(line).trimEnd(), color: 'gray' })
        }
        break
    }
  }
  if (out.length > 0 && out[out.length - 1]?.text !== '') out.push({ text: '' })
  return out
}

/**
 * Translate renderer-owned labels embedded in deterministic fold status rows.
 * User, model, tool, and command payload text is returned untouched.
 * @param text - one settled status row from the fold.
 * @param locale - UI chrome language.
 * @returns localized status text.
 */
export function localizeFoldStatus(text: string, locale: 'zh' | 'en'): string {
  if (locale === 'zh') return text
  if (text === '◈ plan 模式开启') return '◈ plan mode on'
  if (text === '◈ plan 模式关闭') return '◈ plan mode off'
  if (text === '◆ goal 已清除') return '◆ goal cleared'
  const goal = /^◆ goal ([^·]+) · (进行中|已暂停|已阻塞|已完成) · ([\s\S]*)$/.exec(text)
  if (goal !== null) {
    const phase = goal[2] === '进行中'
      ? 'active'
      : goal[2] === '已暂停'
        ? 'paused'
        : goal[2] === '已阻塞'
          ? 'blocked'
          : 'complete'
    return `◆ goal ${goal[1]?.trim() ?? ''} · ${phase} · ${goal[3] ?? ''}`
  }
  return text.startsWith('└ turn ') ? text.replace(' · 工具 ', ' · tools ') : text
}

/**
 * Render one row as terminal text (glyph prefix plus body).
 * @param node - the settled row.
 * @param locale - UI chrome language.
 * @returns the plain line(s).
 */
export function renderNodePlain(node: TuiNode, locale: 'zh' | 'en' = 'zh'): string {
  switch (node.kind) {
    case 'user':
      return `▸ ${node.text}`
    case 'context':
      return `${locale === 'en' ? '◆ context injected' : '◆ 上下文注入'} · ${node.producer}\n${node.text}`
    case 'assistant': {
      const mark = locale === 'zh' ? ' · 已中断' : ' · interrupted'
      if (node.text === '') return node.interrupted === true ? `●${mark}` : ''
      return `● ${node.text}${node.interrupted === true ? mark : ''}`
    }
    case 'think':
      return node.text.split('\n').map(line => `  │ ${line}`).join('\n')
    case 'tool': {
      if (node.status === 'running') return `○ ${node.detail} …`
      const head = `◇ ${node.detail} · ${node.status}`
      return node.text === '' ? head : `${head}\n${node.text}`
    }
    case 'retry': {
      const max = node.maxRetries === null ? '∞' : String(node.maxRetries)
      const state = locale === 'en'
        ? (node.started ? 'fired' : 'waiting')
        : (node.started ? '已触发' : '等待重试')
      return `⟳ retry ${node.retry}/${max} · ${state}`
    }
    case 'status':
      return `${node.error ? '×' : '◆'} ${localizeFoldStatus(node.text, locale)}`
  }
}

/**
 * Render the assistant-result portion of settled rows for `--print` stdout:
 * only assistant message texts, joined, with no glyph prefixes, tool rows,
 * status rows, or banners — the output must be safe for scripts, pipelines,
 * and command substitution.
 * @param nodes - the settled rows produced by the run.
 * @returns the joined assistant texts, or '' when the run produced none.
 */
export function renderAssistantResultPlain(nodes: readonly TuiNode[]): string {
  return nodes
    .filter(node => node.kind === 'assistant')
    .map(node => node.text)
    .filter(text => text !== '')
    .join('\n')
    .trimEnd()
}

/** The v0.0.13 linear-mode welcome line for one UI locale. */
export function welcomeText(locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'en'
    ? 'dsh-tui v0.0.13 — type a task to begin; / lists commands, /help shows help, /quit exits.'
    : 'dsh-tui v0.0.13 — 输入任务开始工作；/ 查看命令，/help 帮助，/quit 退出。'
}

/** The zh welcome text retained for the default linear fallback. */
export const WELCOME = welcomeText('zh')

/** One `┃ text ┃` row padded to the panel's inner width. */
function panelLine(text: string, innerWidth: number): string {
  const padding = Math.max(0, innerWidth - 2 - stringWidth(text))
  return `┃ ${text}${' '.repeat(padding)} ┃`
}

/** Wrap one source line by terminal cells (DamnatioX's _wrap_cells). */
function wrapCells(text: string, width: number): string[] {
  if (text === '') return ['']
  const lines: string[] = []
  let current = ''
  let currentWidth = 0
  for (const character of text) {
    const characterWidth = Math.max(1, stringWidth(character))
    if (current !== '' && currentWidth + characterWidth > width) {
      lines.push(current)
      current = ''
      currentWidth = 0
    }
    current += character
    currentWidth += characterWidth
  }
  lines.push(current)
  return lines
}

/**
 * The welcome block: a `┏━┓` panel listing the model, workspace, session,
 * and the starter hint. `width` is the CONTENT width available to the panel
 * (the renderer passes terminal width minus its padding), so the borders
 * always fit one row even on narrow windows.
 * @param width - available content cells for the panel.
 * @param model - the active model id.
 * @param cwd - the workspace path.
 * @param sessionId - the full session id.
 * @param locale - UI chrome language.
 * @returns the rendered lines.
 */
export function welcomeBlock(width: number, model: string, cwd: string, sessionId: string, locale: 'zh' | 'en' = 'zh'): string[] {
  const panelWidth = Math.max(20, Math.min(Math.max(20, width), 112))
  const innerWidth = panelWidth - 2
  const fullLabel = ' dsh-tui v0.0.13 · DeepSeek Harness '
  const leftRule = 3
  // The label must fit between the rules or the top border overflows its
  // panel (the deformation seen when the window shrinks).
  const labelSpace = Math.max(1, innerWidth - leftRule)
  const label = stringWidth(fullLabel) <= labelSpace
    ? fullLabel
    : `${fullLabel.slice(0, Math.max(1, labelSpace - 1))}…`
  const rightRule = Math.max(0, labelSpace - stringWidth(label))
  const lines: string[] = [`┏${'━'.repeat(leftRule)}${label}${'━'.repeat(rightRule)}┓`]
  const details = locale === 'en'
    ? [
      `Model: ${model}`,
      `Workspace: ${cwd}`,
      `Session: ${sessionId}`,
      '',
      'Type a task below; /help lists commands.',
    ]
    : [
      `Model: ${model}`,
      `Workspace: ${cwd}`,
      `Session: ${sessionId}`,
      '',
      '在底部输入任务；输入 /help 查看命令。',
    ]
  for (const detail of details) {
    for (const part of wrapCells(detail, Math.max(1, innerWidth - 2))) {
      lines.push(panelLine(part, innerWidth))
    }
  }
  lines.push(`┗${'━'.repeat(innerWidth)}┛`)
  return lines
}

/** Format a count like phi/panda: 999, 1.2k, 15k, 1.5M. */
function formatCount(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  return `${(count / 1000000).toFixed(1)}M`
}

/** Format a millisecond duration like the Web strip. */
export function formatMs(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`
  return `${(milliseconds / 1000).toFixed(1)}s`
}

/**
 * The complete Web-stats strip, one group per required datum: turns, steps,
 * LLM wall time, tool wall time, TTFT, decode throughput, cache hit ratio,
 * token totals, and context occupancy. When the token-meter's Web-parity
 * occupancy projection is available it drives the occupancy group (it
 * answers for the NEXT request, so a compaction drops it live); otherwise
 * the fold's cumulative billed tokens over the newest context window is the
 * fallback.
 * @param stats - the folded whole-session statistics.
 * @param locale - UI chrome language.
 * @param occupancy - the projection pair, when available.
 * @returns the human-readable stats line.
 */
export function formatStats(
  stats: SessionStats,
  locale: 'zh' | 'en' = 'zh',
  occupancy: { projectedTokens: number; contextWindow: number } | null = null,
): string {
  const zh = locale === 'zh'
  const groups: string[] = [zh ? `轮 ${stats.turns}` : `turn ${stats.turns}`, zh ? `步 ${stats.steps}` : `step ${stats.steps}`]
  groups.push(`LLM ${formatMs(stats.llmMs)}`)
  groups.push(zh ? `工具 ${formatMs(stats.toolMs)}` : `tools ${formatMs(stats.toolMs)}`)
  if (stats.stepsWithTtft > 0) groups.push(`TTFT ${formatMs(stats.ttftMs / stats.stepsWithTtft)}`)
  if (stats.decodeMs > 0) {
    groups.push(`${Math.round(stats.tokens.output / (stats.decodeMs / 1000))} tok/s`)
  }
  const billed = stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite
  if (billed > 0) groups.push(zh ? `缓存 ${Math.round((stats.tokens.cacheRead / billed) * 100)}% 命中` : `cache ${Math.round((stats.tokens.cacheRead / billed) * 100)}% hit`)
  const tokens = [`↑${formatCount(stats.tokens.input)}`, `↓${formatCount(stats.tokens.output)}`]
  if (stats.tokens.cacheRead > 0) tokens.push(`C${formatCount(stats.tokens.cacheRead)}`)
  if (stats.tokens.cacheWrite > 0) tokens.push(`W${formatCount(stats.tokens.cacheWrite)}`)
  if (stats.tokens.reasoning > 0) tokens.push(`R${formatCount(stats.tokens.reasoning)}`)
  tokens.push(`Σ${formatCount(stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite + stats.tokens.reasoning)}`)
  groups.push(tokens.join(' '))
  if (occupancy !== null && occupancy.contextWindow > 0 && occupancy.projectedTokens > 0) {
    const percentage = Math.min(100, Math.round((occupancy.projectedTokens / occupancy.contextWindow) * 100))
    groups.push(zh
      ? `占用 ${percentage}%/${formatCount(occupancy.contextWindow)}`
      : `occupied ${percentage}%/${formatCount(occupancy.contextWindow)}`)
  } else if (stats.contextWindow > 0 && billed > 0) {
    groups.push(`${Math.min(100, Math.round((billed / stats.contextWindow) * 100))}%/${formatCount(stats.contextWindow)}`)
  }
  return groups.join(' · ')
}

/**
 * Fit a ` · `-joined stats strip to one row WITHOUT ellipses: groups drop
 * from the END (least recent datum first, the turn counter always stays)
 * until the strip fits the width.
 * @param strip - the full stats strip from {@link formatStats}.
 * @param width - the available cells.
 * @returns the strip shortened by whole groups, or the input when it fits.
 */
export function fitStatsStrip(strip: string, width: number): string {
  if (stringWidth(strip) <= width) return strip
  const groups = strip.split(' · ')
  while (groups.length > 1 && stringWidth(groups.join(' · ')) > width) {
    groups.pop()
  }
  return groups.join(' · ')
}

/** The help text for one chrome locale. */
export function helpText(locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'en'
    ? [
      '/help        show this help',
      '/clear       clear the display (session context kept)',
      '/copy        copy the latest assistant reply (/copy n = Nth-latest)',
      '/trajectory  toggle the structured trajectory view',
      '/settings    five pages: general/models/plugins/inventory/presets (Tab to switch)',
      '/jobs        background jobs panel (Enter kills the selected job)',
      '/subagents   subagent tree panel · /workflows workflow run progress',
      '/model       pick a model · /sessions live + persisted sessions · /new fresh session',
      '/presets     switch the agent preset (blank session, in place)',
      '/rename      rename the session title · /workspace <dir> switch directory',
      '/attach      attach png/jpg/gif/webp · /fork [seq] fork the session',
      '/effort      set the reasoning effort: off | low | high | max',
      '/goal        current goal details · /quit /exit save and exit',
      'Enter send · Ctrl+Enter steer · Shift+Enter newline · Esc cancel the running turn',
      'Shift+Tab cycle the file permission · PgUp/PgDn scroll history · ↑/↓ input history',
      'Click disclosure arrows to expand/collapse; any Thinking arrow toggles all Thinking rows',
      'Click the ▼ button to jump back to the newest lines · Ctrl+L clear · Ctrl+D exit when idle',
      'Drag in the transcript to copy; /copy copies the latest reply',
    ].join('\n')
    : [
      '/help        显示本帮助',
      '/clear       清空显示（保留会话上下文）',
      '/copy        复制最近一条回复（/copy n 为第 n 条最近回复）',
      '/trajectory  切换结构化轨迹视图',
      '/settings    设置五页：general/models/plugins/inventory/presets（Tab 换页）',
      '/jobs        后台任务面板（Enter 杀掉选中任务）',
      '/subagents   子代理树面板 · /workflows workflow 运行进度',
      '/model       选择模型 · /sessions 活动会话+持久化会话 · /new 新会话',
      '/presets     切换 agent 预设（空白会话原地生效）',
      '/rename      重命名会话标题 · /workspace <目录> 切换工作目录',
      '/attach      附加 png/jpg/gif/webp · /fork [seq] 分叉会话',
      '/effort      设置推理力度：off | low | high | max',
      '/goal        当前 goal 详情 · /quit /exit 保存并退出',
      'Enter 发送 · Ctrl+Enter 转向(steer) · Shift+Enter 换行 · Esc 取消当前轮',
      'Shift+Tab 切换文件权限 · PgUp/PgDn 滚动历史 · ↑/↓ 历史输入',
      '点击展开箭头展开/折叠；任一 Thinking 箭头统一切换全部 Thinking',
      '点击 ▼ 按钮回到最新消息 · Ctrl+L 清屏 · Ctrl+D 空闲退出',
      '在对话里拖选即可复制；/copy 复制最近一条回复',
    ].join('\n')
}

/** The zh help text (linear fallback default). */
export const HELP = helpText('zh')
