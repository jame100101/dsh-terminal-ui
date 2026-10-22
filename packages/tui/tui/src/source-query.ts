/** Full, masked source inspection is separate from the bounded transcript projection. */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { decodeToolResult } from './fold'
import { redactDisplayText, redactDisplayValue } from './display-redaction'

export interface ToolSourceIdentity { sessionId: SessionId; callId: string }
export interface ToolSourceDocument extends ToolSourceIdentity {
  cursor: number
  source: 'live' | 'prepared'
  status: 'complete' | 'incomplete' | 'missing' | 'ambiguous'
  /** Complete means the recorded call/result pair, never proof of complete workspace contents. */
  warnings: string[]
  text: string
}
export interface ToolSourceOptions {
  signal?: AbortSignal
  /** Only pure public ToolDefinition presenters; never execute the tool or read today's files. */
  present?: (name: string, args: unknown, result: ToolResult | undefined) => unknown
}

/** Re-read an immutable host cut, pair by identity, then release it even if presentation fails. */
export async function readToolSource(query: Pick<SessionQueryEngine, 'observeSession'>,
  identity: ToolSourceIdentity, options: ToolSourceOptions = {}): Promise<ToolSourceDocument> {
  if (!identity.callId.trim()) throw new Error('A tool call ID is required')
  const cut = await query.observeSession(identity.sessionId, {
    projectionMode: 'none', ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    if (cut.header.id !== identity.sessionId) throw new Error('Tool source session identity mismatch')
    options.signal?.throwIfAborted()
    const records: unknown[] = []
    let name = ''
    let args: unknown
    let result: ToolResult | undefined
    let calls = 0
    let results = 0
    for (const event of cut.events) {
      if (event.type === 'tool/call' && String(event.data.callId) === identity.callId) {
        calls++; name = event.data.name
        try { args = JSON.parse(event.data.arguments) } catch { args = event.data.arguments }
        records.push(event)
      } else if (event.type === 'tool/result') {
        const decoded = decodeToolResult(event)
        if (decoded?.callId !== identity.callId) continue
        results++
        result = { content: decoded.content, isError: decoded.isError,
          ...(event.data.meta === undefined ? {} : { meta: event.data.meta }) }
        records.push(event)
      } else if ((event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch')
        && String(event.data.subCallId) === identity.callId) {
        name = event.data.name; args = event.data.arguments
        if (event.type === 'tool/ptc-dispatch-start') calls++
        else {
          results++
          result = { content: event.data.content, isError: event.data.isError,
            ...(event.data.meta === undefined ? {} : { meta: event.data.meta }) }
        }
        records.push(event)
      }
    }
    const status = records.length === 0 ? 'missing' : calls > 1 || results > 1 ? 'ambiguous'
      : calls === 1 && results === 1 ? 'complete' : 'incomplete'
    const warnings = ['Recorded source only; upstream truncation cannot be recovered. Diff positions are relative to supplied snapshots, not current files.', 'Display masking and terminal sanitization apply: control codes are removed and CRLF is normalized.']
    if (status === 'missing') warnings.push('No matching tool events exist in this session cut.')
    if (status === 'incomplete') warnings.push('The call or result is absent from this cut; execution may still be running or the record may be incomplete.')
    if (status === 'ambiguous') warnings.push('Duplicate call identity: records retained separately; no inferred pairing or Diff.')
    let presentation: unknown
    if (options.present && name && status !== 'ambiguous') {
      try { presentation = options.present(name, structuredClone(args), structuredClone(result)) }
      catch { warnings.push('Presentation unavailable; original recorded payloads remain below.') }
    }
    // Redact whole values before pagination; a secret crossing a page boundary must stay hidden.
    const safeRecords = redactDisplayValue(records)
    const safeResult = redactDisplayValue(result)
    const output = safeResult?.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n') ?? ''
    const text = [
      'DSH-TUI masked tool source — complete recorded payloads, not a workspace archive',
      `Session: ${redactDisplayText(String(identity.sessionId))} · Call: ${redactDisplayText(identity.callId)}`,
      `Cut: ${cut.cursor} · ${cut.source} · ${status}`, ...warnings,
      '\nOUTPUT\n', output,
      ...(presentation === undefined ? [] : ['\nPRESENTATION (supplied snapshots)\n', JSON.stringify(redactDisplayValue(presentation), null, 2)]),
      '\nRECORDED EVENTS\n', JSON.stringify(safeRecords, null, 2),
    ].join('\n')
    options.signal?.throwIfAborted()
    return { ...identity, cursor: cut.cursor, source: cut.source, status, warnings, text }
  } finally { cut[Symbol.dispose]() }
}

/** Fixed-size pages preserve every UTF-16 unit, including huge lines, without splitting a surrogate pair. */
export function pageToolSource(document: ToolSourceDocument, offset = 0, size = 8000): {
  text: string; offset: number; nextOffset: number | null; totalChars: number
} {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > document.text.length) throw new Error('Invalid source offset')
  if (!Number.isSafeInteger(size) || size < 2 || size > 64000) throw new Error('Source page size must be 2–64000')
  if (offset > 0 && /[\uDC00-\uDFFF]/.test(document.text[offset] ?? '') && /[\uD800-\uDBFF]/.test(document.text[offset - 1] ?? '')) throw new Error('Source offset splits a Unicode character')
  let end = Math.min(document.text.length, offset + size)
  if (end < document.text.length && /[\uD800-\uDBFF]/.test(document.text[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(document.text[end] ?? '')) end--
  return { text: document.text.slice(offset, end), offset, nextOffset: end === document.text.length ? null : end, totalChars: document.text.length }
}

/** Private, fresh export: no production home, no overwrite, no unmasked reveal path. */
export async function exportToolSource(document: ToolSourceDocument): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-source-'))
  const path = join(directory, 'tool-source.txt')
  await writeFile(path, document.text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return path
}

/** Explicit full-session inspection bypasses display eviction without changing the model context. */
export async function readSessionSource(query: Pick<SessionQueryEngine, 'observeSession'>,
  sessionId: SessionId, signal?: AbortSignal): Promise<ToolSourceDocument> {
  const cut = await query.observeSession(sessionId, { projectionMode: 'none', ...(signal ? { signal } : {}) })
  try {
    signal?.throwIfAborted()
    if (cut.header.id !== sessionId) throw new Error('Session source identity mismatch')
    const warnings = ['Complete recorded session cut; display masking and terminal sanitization apply. Missing upstream data cannot be recovered.']
    const text = ['DSH-TUI masked session source', ...warnings, JSON.stringify(redactDisplayValue({
      header: cut.header, cursor: cut.cursor, source: cut.source, events: cut.events,
    }), null, 2)].join('\n')
    return { sessionId, callId: '', cursor: cut.cursor, source: cut.source, status: 'complete', warnings, text }
  } finally { cut[Symbol.dispose]() }
}

/** Latest explicit inspection wins even when older public queries finish out of order. */
export class SourceInspectionCache {
  private generation = 0
  private document: ToolSourceDocument | undefined
  async read(sessionId: SessionId, callId: string, fresh: boolean,
    load: () => Promise<ToolSourceDocument>): Promise<ToolSourceDocument> {
    if (!fresh && this.document?.sessionId === sessionId && this.document.callId === callId) return this.document
    const generation = ++this.generation
    const document = await load()
    if (document.sessionId !== sessionId || document.callId !== callId) throw new Error('Source inspection identity mismatch')
    if (generation === this.generation) this.document = document
    return document
  }
}
