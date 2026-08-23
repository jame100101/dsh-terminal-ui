/**
 * Render-intent card projection: the pure functions that turn a tool's
 * `presentCall`/`presentResult` views into terminal lines. One projector per
 * card family (generic / terminal / diff / search / read / web); unknown
 * views fall back to the documented default (opaque text). Pure of the
 * session context and of Ink.
 * @module @deepseek-ai/dsh-tui/src/card-project
 */

import type {
  DiffCallView,
  DiffResultView,
  GenericCallView,
  GenericResultView,
  ReadResultView,
  SearchMatchesResultView,
  SearchPathsResultView,
  TerminalCallView,
  TerminalResultView,
  ToolCallView,
  ToolResultView,
  WebFetchResultView,
  WebSearchResultView,
} from '@deepseek-ai/dsh-tools/presentation'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** One colored line of a projected card. */
export interface CardLine {
  text: string
  color?: 'green' | 'red' | 'yellow' | 'cyan' | 'gray' | 'magenta'
}

/** Cap on projected card lines, so a giant card cannot flood the transcript. */
const MAX_CARD_LINES = 200
/** Cap on one card source line: a single-line JSON blob must not wrap into hundreds of rows. */
const MAX_CARD_LINE_LENGTH = 300
/** Cap on retained tool-card payload strings (matches the fold's tool-text cap). */
const MAX_CARD_PAYLOAD = 4000

/** Truncate one over-long source line so wrapping stays bounded. */
function capLine(text: string): string {
  return text.length <= MAX_CARD_LINE_LENGTH ? text : `${text.slice(0, MAX_CARD_LINE_LENGTH)}…`
}

/** Flatten harness content blocks into plain text (tool-result blocks recurse). */
function blocksText(blocks: readonly ContentBlock[] | undefined): string {
  if (blocks === undefined) return ''
  let out = ''
  for (const block of blocks) {
    if (block.type === 'text') out += block.text
    else if (block.type === 'tool-result') out += blocksText(block.content)
  }
  return out
}

/** Split text into card lines without width-aware wrapping (the renderer wraps). */
function lines(text: string, cap = MAX_CARD_LINES): CardLine[] {
  const split = text === '' ? [] : text.split('\n')
  return split.slice(0, cap).map(line => ({ text: capLine(line) }))
}

/** Color one +/- diff line. */
function diffLine(text: string): CardLine {
  if (text.startsWith('+') && !text.startsWith('+++')) return { text, color: 'green' }
  if (text.startsWith('-') && !text.startsWith('---')) return { text, color: 'red' }
  if (text.startsWith('@@')) return { text, color: 'cyan' }
  return { text, color: 'gray' }
}

/**
 * Project one pending-call view into card lines.
 * @param view - normalized tool call presentation, or null.
 * @param fallbackDetail - text used when the presentation omits detail.
 * @returns terminal card lines.
 */
export function projectCallCard(view: ToolCallView | null, fallbackDetail: string): CardLine[] {
  if (view === null) return []
  switch (view.card) {
    case 'terminal': {
      const terminal = view as TerminalCallView
      const out: CardLine[] = []
      if (terminal.description !== undefined && terminal.description !== '') out.push({ text: terminal.description, color: 'gray' })
      if (terminal.cwd !== undefined) out.push({ text: `cwd: ${terminal.cwd}`, color: 'gray' })
      out.push({ text: `$ ${terminal.title}`, color: 'cyan' })
      return out
    }
    case 'diff': {
      const diff = view as DiffCallView
      const out: CardLine[] = []
      for (const file of diff.diffs) {
        out.push({ text: `── ${file.path}${file.oldText === null ? ' (new)' : ''}`, color: 'gray' })
        for (const line of lines(file.newText).slice(0, 80)) out.push(diffLine(`+${line.text}`))
      }
      return out.slice(0, MAX_CARD_LINES)
    }
    case 'generic': {
      const generic = view as GenericCallView
      const out: CardLine[] = [{ text: `${generic.title}${generic.kind !== undefined ? ` [${generic.kind}]` : ''}`, color: 'gray' }]
      if (generic.rawInput !== undefined) {
        const rendered = typeof generic.rawInput === 'string' ? generic.rawInput : JSON.stringify(generic.rawInput)
        out.push(...lines(rendered).map(line => ({ text: `  ${line.text}`, color: 'gray' as const })))
      }
      if (generic.content !== undefined) {
        out.push(...lines(blocksText(generic.content)).map(line => ({ text: `  ${line.text}`, color: 'gray' as const })))
      }
      if (generic.locations !== undefined && generic.locations.length > 0) {
        out.push({
          text: `  files: ${generic.locations.map(location => `${location.path}${location.line === undefined ? '' : `:${location.line}`}`).join(', ')}`,
          color: 'gray',
        })
      }
      return out
    }
    default:
      return [{ text: fallbackDetail, color: 'gray' }]
  }
}

/**
 * Project one completed-call view into card lines.
 * @param view - structured result presentation, when available.
 * @param fallbackText - plain result text used by generic/unknown cards.
 * @param locale - language for renderer-owned labels.
 * @returns bounded terminal card lines.
 */
export function projectResultCard(view: ToolResultView | null, fallbackText: string, locale: 'zh' | 'en' = 'zh'): CardLine[] {
  if (view === null) {
    return fallbackText === '' ? [] : lines(fallbackText).map(line => ({ text: `  ${line.text}`, color: 'gray' as const }))
  }
  switch (view.card) {
    case 'terminal': {
      const terminal = view as TerminalResultView
      const out: CardLine[] = []
      if (terminal.output !== undefined && terminal.output !== '') out.push(...lines(terminal.output))
      const status: CardLine = terminal.exitCode !== undefined
        ? { text: `exit ${terminal.exitCode}`, color: terminal.exitCode === 0 ? 'green' : 'red' }
        : terminal.signal !== undefined
          ? { text: `killed by ${terminal.signal}`, color: 'yellow' }
          : { text: 'done', color: 'green' }
      out.push(status)
      return out.slice(0, MAX_CARD_LINES)
    }
    case 'diff': {
      const diff = view as DiffResultView
      const out: CardLine[] = []
      for (const file of diff.diffs) {
        out.push({ text: `── ${file.path}${file.oldText === null ? ' (new)' : ''}`, color: 'gray' })
        if (file.oldText !== null) {
          for (const line of lines(file.oldText).slice(0, 80)) out.push(diffLine(`-${line.text}`))
        }
        for (const line of lines(file.newText).slice(0, 80)) out.push(diffLine(`+${line.text}`))
      }
      return out.slice(0, MAX_CARD_LINES)
    }
    case 'search': {
      const search = view as SearchMatchesResultView | SearchPathsResultView
      const out: CardLine[] = []
      if (search.shape === 'matches') {
        for (const file of search.files) {
          out.push({ text: `── ${file.path}`, color: 'gray' })
          for (const match of file.matches) {
            out.push({ text: `  ${match.lineNumber}: ${match.line}`, color: 'gray' })
          }
        }
      } else {
        for (const path of search.paths) out.push({ text: `  ${path}`, color: 'gray' })
      }
      out.push({
        text: search.truncated
          ? (locale === 'en'
            ? `… truncated (showing ${search.shape === 'matches' ? search.files.length : search.paths.length}/${search.total})`
            : `… 已截断（显示 ${search.shape === 'matches' ? search.files.length : search.paths.length}/${search.total}）`)
          : (locale === 'en' ? `${search.total} items` : `共 ${search.total} 项`),
        color: 'yellow',
      })
      return out.slice(0, MAX_CARD_LINES)
    }
    case 'read': {
      const read = view as ReadResultView
      const out: CardLine[] = [{
        text: `── ${read.path} (${read.offset}–${read.offset + read.lines.length - 1} of ${read.totalLines}${locale === 'en' ? ' lines' : ' 行'})`,
        color: 'gray',
      }]
      for (const line of read.lines) out.push({ text: `${line.number}: ${line.text}`, color: 'gray' })
      if (read.lines.length === 0) out.push({ text: '  (empty window)', color: 'gray' })
      if (read.content !== undefined && read.lines.length === 0) out.push(...lines(blocksText(read.content)))
      return out.slice(0, MAX_CARD_LINES)
    }
    case 'web': {
      const web = view as WebSearchResultView | WebFetchResultView
      const out: CardLine[] = []
      if (web.kind === 'search') {
        if (web.answer !== undefined && web.answer !== '') out.push(...lines(web.answer))
        for (const source of web.sources) {
          out.push({
            text: `· ${source.title ?? source.url}${source.snippet !== undefined && source.snippet !== '' ? ` — ${source.snippet}` : ''}`,
            color: 'cyan',
          })
          out.push({ text: `  ${source.url}`, color: 'gray' })
        }
        if (web.truncated) out.push({ text: locale === 'en' ? '… source list truncated' : '… 来源列表已截断', color: 'yellow' })
      } else {
        out.push({ text: `${web.url} → HTTP ${web.statusCode}`, color: 'cyan' })
        if (web.truncated) out.push({ text: locale === 'en' ? '… content truncated' : '… 内容已截断', color: 'yellow' })
      }
      return out.slice(0, MAX_CARD_LINES)
    }
    case 'generic': {
      const generic = view as GenericResultView
      const content = generic.content === undefined ? fallbackText : blocksText(generic.content)
      return content === '' ? [] : lines(content).map(line => ({ text: `  ${line.text}`, color: 'gray' as const }))
    }
    default:
      return fallbackText === '' ? [] : lines(fallbackText).map(line => ({ text: `  ${line.text}`, color: 'gray' as const }))
  }
}

/** Truncate one over-long retained payload string. */
function capPayload(text: string): string {
  return text.length <= MAX_CARD_PAYLOAD ? text : `${text.slice(0, MAX_CARD_PAYLOAD)}…`
}

/** Replace content blocks with one capped text block. */
function capContent(blocks: readonly ContentBlock[]): ContentBlock[] {
  return [{ type: 'text', text: capPayload(blocksText(blocks)) }]
}

/** Cap a generic `rawInput` value; large objects collapse to truncated JSON. */
function capRawInput(value: unknown): unknown {
  if (typeof value === 'string') return capPayload(value)
  try {
    const rendered = JSON.stringify(value)
    if (rendered.length > MAX_CARD_PAYLOAD) return `${rendered.slice(0, MAX_CARD_PAYLOAD)}…`
  } catch {
    return value
  }
  return value
}

/**
 * Cap file diffs so a write/edit card cannot keep whole-file strings in the
 * TUI working set after the session log already stored the raw event.
 */
function capDiffs(diffs: DiffCallView['diffs']): DiffCallView['diffs'] {
  return diffs.slice(0, MAX_CARD_LINES).map(file => ({
    path: file.path,
    oldText: file.oldText === null ? null : capPayload(file.oldText),
    newText: capPayload(file.newText),
  }))
}

/**
 * Shrink a pending-call view to display-sized fields. Raw `presentCall`
 * objects can hold whole-file diffs or large `rawInput`; the renderer only
 * needs a preview.
 * @param view - the tool's `presentCall` result, or null.
 * @returns a compacted view, or null.
 */
export function compactCallCard(view: unknown): unknown {
  if (view === null || view === undefined || typeof view !== 'object') return view ?? null
  const card = view as ToolCallView
  switch (card.card) {
    case 'generic':
      return {
        ...card,
        ...(card.rawInput !== undefined ? { rawInput: capRawInput(card.rawInput) } : {}),
        ...(card.content !== undefined ? { content: capContent(card.content) } : {}),
      }
    case 'diff':
      return { ...card, diffs: capDiffs(card.diffs) }
    case 'terminal':
      return card
    default:
      return view
  }
}

/**
 * Shrink a completed-call view to display-sized fields so giant tool outputs
 * (shell logs, file reads, diffs) are not retained beside the session log.
 * @param view - the tool's `presentResult` result, or null.
 * @returns a compacted view, or null.
 */
export function compactResultCard(view: unknown): unknown {
  if (view === null || view === undefined || typeof view !== 'object') return view ?? null
  const card = view as ToolResultView
  switch (card.card) {
    case 'generic':
      return {
        ...card,
        ...(card.content !== undefined ? { content: capContent(card.content) } : {}),
      }
    case 'terminal':
      return {
        ...card,
        ...(card.output !== undefined ? { output: capPayload(card.output) } : {}),
      }
    case 'diff':
      return { ...card, diffs: capDiffs(card.diffs) }
    case 'search':
      if (card.shape === 'matches') {
        return {
          ...card,
          files: card.files.slice(0, MAX_CARD_LINES).map(file => ({
            path: file.path,
            matches: file.matches.slice(0, 40).map(match => ({
              lineNumber: match.lineNumber,
              line: capLine(match.line),
            })),
          })),
        }
      }
      return { ...card, paths: card.paths.slice(0, MAX_CARD_LINES) }
    case 'read':
      return {
        ...card,
        lines: card.lines.slice(0, MAX_CARD_LINES).map(line => ({
          number: line.number,
          text: capLine(line.text),
        })),
        content: undefined,
      }
    case 'web':
      if (card.kind === 'search') {
        return {
          ...card,
          ...(card.answer !== undefined ? { answer: capPayload(card.answer) } : {}),
          sources: card.sources.slice(0, MAX_CARD_LINES).map(source => ({
            ...source,
            ...(source.snippet !== undefined ? { snippet: capLine(source.snippet) } : {}),
          })),
        }
      }
      return card
    default:
      return view
  }
}

/** Re-exported for the renderer's pending/result dispatch. */
export type { ToolCallView, ToolResultView }
