import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const pasteStart = '\u001B[200~'
const pasteEnd = '\u001B[201~'
const mouseReport = '\u001B[<0;12;8M'

interface InputParser {
  push: (chunk: string) => Array<string | { readonly paste: string }>
  isPendingPaste: () => boolean
  abortPendingPaste: (reason?: 'limit' | 'timeout' | 'reset') => boolean
  pendingCharacters: () => number
  pendingMode: () => 'normal' | 'csi' | 'paste'
  lastAbortReason: () => 'limit' | 'timeout' | 'reset' | undefined
  abortCount: () => number
  hasPendingEscape: () => boolean
  flushPendingEscape: () => string | undefined
  reset: () => void
}

interface InputParserModule {
  defaultMaxPendingPasteCharacters: number
  defaultMaxPendingControlCharacters: number
  createInputParser: (options?: {
    maxPendingPasteCharacters?: number
    maxPendingControlCharacters?: number
  }) => InputParser
}

async function loadParser(): Promise<InputParserModule> {
  const require = createRequire(import.meta.url)
  const inkRoot = dirname(dirname(require.resolve('ink')))
  return await import(pathToFileURL(join(inkRoot, 'build/input-parser.js')).href) as InputParserModule
}

describe('Ink bounded input parser', () => {
  it('keeps ordinary keys and a complete paste, including a split end marker', async () => {
    const { createInputParser } = await loadParser()
    const parser = createInputParser()
    expect(parser.push(`pre${pasteStart}hello${pasteEnd}post`)).toEqual([
      'pre',
      { paste: 'hello' },
      'post',
    ])
    parser.push(pasteStart)
    parser.push('abcdef')
    parser.push('\u001B[20')
    expect(parser.isPendingPaste()).toBe(true)
    expect(parser.pendingMode()).toBe('paste')
    expect(parser.hasPendingEscape()).toBe(false)
    expect(parser.push('1~tail')).toEqual([{ paste: 'abcdef' }, 'tail'])
    expect(parser.isPendingPaste()).toBe(false)
    const splitStart = createInputParser()
    expect(splitStart.push('\u001B[20')).toEqual([])
    expect(splitStart.push(`0~hi${pasteEnd}z`)).toEqual([{ paste: 'hi' }, 'z'])
  })

  it('does not emit keys or mouse reports swallowed by a missing paste end', async () => {
    const { createInputParser } = await loadParser()
    const parser = createInputParser()
    expect(parser.push(pasteStart)).toEqual([])
    expect(parser.push('abc')).toEqual([])
    expect(parser.push(mouseReport)).toEqual([])
    expect(parser.push('x')).toEqual([])
    expect(parser.isPendingPaste()).toBe(true)
    expect(parser.pendingCharacters()).toBe(pasteStart.length + 'abc'.length + mouseReport.length + 1)
    expect(parser.abortPendingPaste()).toBe(true)
    expect(parser.lastAbortReason()).toBe('timeout')
    expect(parser.isPendingPaste()).toBe(false)
    expect(parser.push('z')).toEqual(['z'])
  })

  it('drops an oversized unfinished paste through its split end marker without retaining the body', async () => {
    const { createInputParser } = await loadParser()
    const parser = createInputParser({ maxPendingPasteCharacters: 32 })
    parser.push(pasteStart)
    expect(parser.push('n'.repeat(40))).toEqual([])
    expect(parser.isPendingPaste()).toBe(true)
    expect(parser.pendingMode()).toBe('paste')
    expect(parser.lastAbortReason()).toBe('limit')
    expect(parser.pendingCharacters()).toBe(0)
    expect(parser.push(`ignored${pasteEnd.slice(0, 3)}`)).toEqual([])
    expect(parser.push(`${pasteEnd.slice(3)}k`)).toEqual(['k'])
    expect(parser.isPendingPaste()).toBe(false)
  })

  it('resumes ordinary keys after an oversized complete paste, without emitting the body', async () => {
    const { createInputParser } = await loadParser()
    const parser = createInputParser({ maxPendingPasteCharacters: 8 })
    parser.push(pasteStart)
    expect(parser.push(`abcdefghij${pasteEnd}after`)).toEqual(['after'])
    expect(parser.lastAbortReason()).toBe('limit')
    expect(parser.isPendingPaste()).toBe(false)
  })

  it('drops an unbounded incomplete CSI and then parses the next chunk as keys', async () => {
    const { createInputParser } = await loadParser()
    const parser = createInputParser({ maxPendingControlCharacters: 8 })
    expect(parser.push(`\u001B[${'0'.repeat(40)}`)).toEqual([])
    expect(parser.pendingMode()).toBe('normal')
    expect(parser.push('q')).toEqual(['q'])
  })

  it('clears paste state on reset and counts the abort', async () => {
    const { createInputParser } = await loadParser()
    const parser = createInputParser()
    parser.push(pasteStart)
    parser.push('pending-body')
    parser.reset()
    expect(parser.isPendingPaste()).toBe(false)
    expect(parser.lastAbortReason()).toBe('reset')
    expect(parser.abortCount()).toBe(1)
    expect(parser.push('ok')).toEqual(['ok'])
  })
})
