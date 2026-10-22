/** UTF-16 source range of the mention containing the caret. */
export interface MentionRange { start: number; end: number; query: string }

/**
 * Mentions begin at a whitespace boundary. Quoted paths may contain spaces;
 * backslashes remain path separators except when escaping a quote.
 */
export function mentionAtCaret(text: string, caret: number): MentionRange | null {
  if (text.startsWith('/')) return null
  const bounded = Math.max(0, Math.min(caret, text.length))
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '@' || (start > 0 && !/\s/u.test(text[start - 1] ?? ''))) continue
    const quoted = text[start + 1] === '"'
    const contentStart = start + (quoted ? 2 : 1)
    let end = contentStart
    while (end < text.length) {
      if (quoted ? text[end] === '"' && text[end - 1] !== '\\' : /\s/u.test(text[end] ?? '')) break
      end += 1
    }
    const contentEnd = end
    if (quoted && text[end] === '"') end += 1
    if (bounded >= contentStart && bounded <= end) {
      const query = text.slice(contentStart, Math.min(bounded, contentEnd)).replace(/\\"/gu, '"')
      return { start, end, query }
    }
    start = Math.max(start, end - 1)
  }
  return null
}

/** Replace only the active token; the suffix and its whitespace remain intact. */
export function completeMention(text: string, range: MentionRange, mention: string, directory = false): { text: string; caret: number } {
  const suffix = text.slice(range.end)
  const insert = `${mention}${directory || /^\s/u.test(suffix) ? '' : ' '}`
  const next = text.slice(0, range.start) + insert + suffix
  // Keep the caret inside a quoted directory so another path segment extends it.
  const caret = range.start + insert.length - (directory && mention.endsWith('"') ? 1 : 0)
  return { text: next, caret }
}

/** A path mention has explicit quoting when whitespace would split its token. */
export function pathMention(path: string): string {
  return /\s|"/u.test(path) ? `@"${path.replace(/"/gu, '\\"')}"` : `@${path}`
}

/** All state that makes an asynchronous completion result usable. */
export interface CompletionIdentity {
  sessionId: string
  cwd: string
  revision: number
  caret: number
}

export function sameCompletionIdentity(left: CompletionIdentity, right: CompletionIdentity): boolean {
  return left.sessionId === right.sessionId && left.cwd === right.cwd
    && left.revision === right.revision && left.caret === right.caret
}

/** Slash tokens at whitespace boundaries; completion never consumes arguments or suffix prose. */
export function slashAtCaret(text: string, caret: number): MentionRange | null {
  for (const match of text.matchAll(/(?:^|\s)(\/[^\s]*)/gu)) {
    const token = match[1]!
    const start = match.index + match[0].length - token.length
    const end = start + token.length
    if (caret >= start + 1 && caret <= end) return { start, end, query: text.slice(start + 1, caret) }
  }
  return null
}
