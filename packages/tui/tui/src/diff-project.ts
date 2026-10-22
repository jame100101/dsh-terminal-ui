/** Bounded display-only deltas from public tool snapshots, never persisted host facts. */
export interface DiffSource { path: string; oldText: string | null; newText: string }
export interface DeltaLine {
  kind: 'context' | 'add' | 'remove'
  text: string
  oldLine?: number
  newLine?: number
  noNewline: boolean
}
export interface DeltaHunk {
  oldStart: number; oldCount: number; newStart: number; newCount: number
  lines: DeltaLine[]
}
export interface FileDelta {
  path: string
  hunks: DeltaHunk[]
  added: number
  removed: number
  incomplete?: 'before-image' | 'binary' | 'budget'
  lineEndings: 'LF' | 'CRLF' | 'mixed'
}
const MAX_SOURCE = 200_000
const MAX_LINES = 10_000
const MAX_CELLS = 1_000_000
interface SourceLine { text: string; ending: string }
function splitSource(text: string): SourceLine[] {
  if (!text) return []
  const rows = text.split('\n')
  const terminal = rows.pop()!
  const out = rows.map(row => row.endsWith('\r')
    ? { text: row.slice(0, -1), ending: '\r\n' }
    : { text: row, ending: '\n' })
  if (terminal) out.push({ text: terminal, ending: '' })
  return out
}
function equal(a: SourceLine, b: SourceLine): boolean {
  return a.text === b.text && a.ending === b.ending
}
/** Coordinates are relative to supplied snapshots: Harness can supply contextual snippets. */
export function projectFileDelta(source: DiffSource): FileDelta {
  // Bound inspection as well as LCS allocation; omitted content is never interpreted as a full snapshot.
  const oversized = (source.oldText?.length ?? 0) + source.newText.length > MAX_SOURCE
  const combined = oversized ? '' : `${source.oldText ?? ''}${source.newText}`
  const crlf = combined.includes('\r\n')
  const lf = /(^|[^\r])\n/.test(combined)
  const result: FileDelta = {
    path: source.path, hunks: [], added: 0, removed: 0,
    lineEndings: crlf ? (lf ? 'mixed' : 'CRLF') : 'LF',
  }
  if (oversized) return { ...result, incomplete: 'budget' }
  if (combined.includes('\0')) return { ...result, incomplete: 'binary' }
  if (source.oldText === null) return { ...result, incomplete: 'before-image' }
  const before = splitSource(source.oldText)
  const after = splitSource(source.newText)
  if (before.length + after.length > MAX_LINES) return { ...result, incomplete: 'budget' }
  let prefix = 0
  while (prefix < before.length && prefix < after.length && equal(before[prefix]!, after[prefix]!)) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && equal(before[before.length - 1 - suffix]!, after[after.length - 1 - suffix]!)) suffix++
  const n = before.length - prefix - suffix
  const m = after.length - prefix - suffix
  if ((n + 1) * (m + 1) > MAX_CELLS) return { ...result, incomplete: 'budget' }
  const table = new Uint32Array((n + 1) * (m + 1))
  const stride = m + 1
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * stride + j] = equal(before[prefix + i]!, after[prefix + j]!)
        ? table[(i + 1) * stride + j + 1]! + 1
        : Math.max(table[(i + 1) * stride + j]!, table[i * stride + j + 1]!)
    }
  }
  const operations: DeltaLine[] = []
  let oldLine = 1
  let newLine = 1
  function emit(kind: DeltaLine['kind'], line: SourceLine): void {
    operations.push({ kind, text: line.text, noNewline: line.ending === '',
      ...(kind !== 'add' ? { oldLine: oldLine++ } : {}),
      ...(kind !== 'remove' ? { newLine: newLine++ } : {}),
    })
    if (kind === 'add') result.added++
    if (kind === 'remove') result.removed++
  }
  for (let i = 0; i < prefix; i++) emit('context', before[i]!)
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && equal(before[prefix + i]!, after[prefix + j]!)) {
      emit('context', before[prefix + i++]!); j++
    } else if (i < n && (j === m || table[(i + 1) * stride + j]! >= table[i * stride + j + 1]!)) {
      emit('remove', before[prefix + i++]!)
    } else emit('add', after[prefix + j++]!)
  }
  for (let k = before.length - suffix; k < before.length; k++) emit('context', before[k]!)
  const ranges: Array<[number, number]> = []
  operations.forEach((line, index) => {
    if (line.kind === 'context') return
    const start = Math.max(0, index - 3)
    const end = Math.min(operations.length, index + 4)
    const last = ranges.at(-1)
    if (last && start <= last[1]) last[1] = end
    else ranges.push([start, end])
  })
  for (const [start, end] of ranges) {
    const lines = operations.slice(start, end)
    const oldCount = lines.filter(line => line.oldLine !== undefined).length
    const newCount = lines.filter(line => line.newLine !== undefined).length
    // Empty sides in unified coordinates refer to the preceding line (zero for empty files).
    const oldStart = lines.find(line => line.oldLine !== undefined)?.oldLine
      ?? operations.slice(0, start).filter(line => line.oldLine !== undefined).length
    const newStart = lines.find(line => line.newLine !== undefined)?.newLine
      ?? operations.slice(0, start).filter(line => line.newLine !== undefined).length
    result.hunks.push({ oldStart, oldCount, newStart, newCount, lines })
  }
  return result
}
