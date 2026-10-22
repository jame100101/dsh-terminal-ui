import type { EditorState } from './editor-state'
import { previousGraphemeBoundary } from './editor-state'
import type { PastedTextBlock } from '../pasted-text'
import { createPastedTextBlock } from '../pasted-text'

export interface DraftSnapshot {
  editor: EditorState
  resources: readonly string[]
  pasted: readonly PastedTextBlock[]
  sessionId: string
}
export type DraftEditAction = 'undo' | 'redo' | 'yank'
const words = new Intl.Segmenter(undefined, { granularity: 'word' })
const capsules = /\[Image #\d+\]|\[Pasted text #\d+ \+\d+ lines?\]/gu
export function atomicRange(text: string, start: number, end: number): { start: number; end: number } {
  let lo = Math.min(start, end), hi = Math.max(start, end)
  for (const match of text.matchAll(capsules)) {
    const a = match.index, b = a + match[0].length
    if (lo < b && hi > a) { lo = Math.min(lo, a); hi = Math.max(hi, b) }
  }
  return { start: lo, end: hi }
}
export function wordLeft(text: string, caret: number): number {
  let end = Math.min(text.length, Math.max(0, caret))
  while (end > 0 && /\s/u.test(text.slice(previousGraphemeBoundary(text, end), end))) end = previousGraphemeBoundary(text, end)
  if (end === 0) return 0
  for (const match of text.matchAll(capsules)) if (end > match.index && end <= match.index + match[0].length) return match.index
  return words.segment(text).containing(end - 1)?.index ?? 0
}
export function wordRight(text: string, caret: number): number {
  let start = Math.min(text.length, Math.max(0, caret))
  while (start < text.length && /\s/u.test(text[start]!)) start++
  for (const match of text.matchAll(capsules)) if (start >= match.index && start < match.index + match[0].length) return match.index + match[0].length
  const part = words.segment(text).containing(start)
  return part === undefined ? text.length : part.index + part.segment.length
}
export const logicalLineStart = (text: string, caret: number): number => caret <= 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1
export function logicalLineEnd(text: string, caret: number): number {
  const end = text.indexOf('\n', caret)
  return end < 0 ? text.length : end
}
const copy = (snapshot: DraftSnapshot): DraftSnapshot => ({ ...snapshot, editor: { ...snapshot.editor,
  selection: snapshot.editor.selection === null ? null : { ...snapshot.editor.selection } }, resources: [...snapshot.resources], pasted: [...snapshot.pasted] })
/** Complete snapshots, bounded independently from sent-input recall. Restore failures never consume a stack entry. */
export class DraftUndo {
  private previous: DraftSnapshot[] = []
  private next: DraftSnapshot[] = []
  clear(): void { this.previous = []; this.next = [] }
  record(snapshot: DraftSnapshot): void {
    this.previous.push(copy(snapshot)); this.next = []
    const retainedSize = (): number => [...new Set(this.previous.flatMap(entry => [entry.editor.text, ...entry.pasted.map(block => block.text)]))].reduce((sum, text) => sum + text.length, 0)
    while (this.previous.length > 80 || (this.previous.length > 1 && retainedSize() > 1_000_000)) this.previous.shift()
  }
  restore(direction: 'undo' | 'redo', current: DraftSnapshot, restore: (snapshot: DraftSnapshot) => void): boolean {
    const source = direction === 'undo' ? this.previous : this.next
    const target = direction === 'undo' ? this.next : this.previous
    const snapshot = source.at(-1)
    if (snapshot === undefined || snapshot.sessionId !== current.sessionId) return false
    restore(copy(snapshot)); source.pop(); target.push(copy(current)); return true
  }
}
/** Capsules are normalized inside the kill buffer, retaining immutable host resource identities. */
export function killFragment(snapshot: DraftSnapshot, start: number, end: number): DraftSnapshot {
  const range = atomicRange(snapshot.editor.text, start, end)
  const resources: string[] = []
  const text = snapshot.editor.text.slice(range.start, range.end).replace(/\[Image #(\d+)\]/gu, (_token, ordinal: string) => {
    const resource = snapshot.resources[Number(ordinal) - 1]
    if (resource === undefined) throw new Error('Image reference is unavailable')
    resources.push(resource); return `[Image #${resources.length}]`
  })
  return { ...snapshot, editor: { text, caret: text.length, selection: null }, resources,
    pasted: snapshot.pasted.filter(block => text.includes(block.token)) }
}
export function yankFragment(current: DraftSnapshot, fragment: DraftSnapshot): DraftSnapshot {
  if (current.sessionId !== fragment.sessionId) throw new Error('Deleted text belongs to another session')
  let text = fragment.editor.text.replace(/\[Image #(\d+)\]/gu, (_token, ordinal: string) => `[Image #${current.resources.length + Number(ordinal)}]`)
  let ordinal = Math.max(0, ...current.pasted.map(block => Number(/#(\d+)/u.exec(block.token)?.[1] ?? 0))) + 1
  const pasted = [...current.pasted]
  for (const block of fragment.pasted) {
    const next = createPastedTextBlock(block.text, ordinal++)
    text = text.replace(block.token, next.token); pasted.push(next)
  }
  const selection = current.editor.selection
  const range = selection === null ? { start: current.editor.caret, end: current.editor.caret }
    : atomicRange(current.editor.text, selection.anchor, selection.head)
  const combined = current.editor.text.slice(0, range.start) + text + current.editor.text.slice(range.end)
  const available = [...current.resources, ...fragment.resources]
  const mapping = new Map<number, number>()
  const resources: string[] = []
  const renumber = (value: string): string => value.replace(/\[Image #(\d+)\]/gu, (_token, original: string) => {
    const index = Number(original) - 1
    if (available[index] === undefined) throw new Error('Image reference is unavailable')
    let ordinal = mapping.get(index)
    if (ordinal === undefined) { resources.push(available[index]!); ordinal = resources.length; mapping.set(index, ordinal) }
    return `[Image #${ordinal}]`
  })
  const prefix = renumber(combined.slice(0, range.start + text.length))
  const result = prefix + renumber(combined.slice(range.start + text.length))
  return { ...current, editor: { text: result, caret: prefix.length, selection: null },
    resources, pasted: pasted.filter(block => result.includes(block.token)) }
}
