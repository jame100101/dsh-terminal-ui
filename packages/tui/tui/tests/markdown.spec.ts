import { describe, expect, it } from 'vitest'
import { markdownLines, retryCountdownSeconds, wrapRuns } from '../src/plain'

describe('markdownLines inline runs', () => {
  it('keeps the plain projection while emitting styled runs', () => {
    const lines = markdownLines('Some **bold** and `code` and [link](http://x) and *soft*.')
    expect(lines.map(line => line.text).join('')).toBe('Some bold and code and link and soft.')
    const paragraph = lines.find(line => line.text.includes('bold'))
    const runs = paragraph?.runs ?? []
    expect(runs.find(run => run.text === 'bold')?.bold).toBe(true)
    expect(runs.find(run => run.text === 'code')?.code).toBe(true)
    expect(runs.find(run => run.text === 'link')?.underline).toBe(true)
    expect(runs.find(run => run.text === 'soft')?.dim).toBe(true)
  })

  it('emits runs for headings', () => {
    const lines = markdownLines('## Title with `code`')
    const heading = lines[0]
    expect(heading?.text).toBe('Title with code')
    expect(heading?.color).toBe('cyan')
    expect(heading?.runs?.find(run => run.text === 'code')?.code).toBe(true)
  })

  it('keeps one blank row between markdown blocks', () => {
    const texts = markdownLines('# Title\n\nA paragraph\n\n- item').map(line => line.text)
    expect(texts[texts.indexOf('Title') + 1]).toBe('')
    expect(texts[texts.indexOf('A paragraph') + 1]).toBe('')
    expect(markdownLines('\n\n# Only').map(line => line.text)[0]).toBe('Only')
  })

  it('keeps structural lines plain (code fences, lists, blockquotes)', () => {
    const lines = markdownLines('```ts\nconst x = 1\n```\n\n- item\n\n> quote')
    expect(lines.find(line => line.text === '│ const x = 1')?.runs).toBeUndefined()
    expect(lines.find(line => line.text === '• item')?.runs).toBeUndefined()
    expect(lines.find(line => line.text === '▎ quote')?.runs).toBeUndefined()
  })

  it('splits runs at embedded newlines from <br>', () => {
    const lines = markdownLines('one<br>two **bold**')
    expect(lines.map(line => line.text)).toContain('one')
    expect(lines.map(line => line.text)).toContain('two bold')
  })
})

describe('wrapRuns', () => {
  it('prefixes only the first line and preserves style across wraps', () => {
    const wrapped = wrapRuns([{ text: 'abcdef', bold: true }], 4, '● ')
    expect(wrapped.map(line => line.text)).toEqual(['● ab', 'cdef'])
    expect(wrapped[0]?.runs[0]).toMatchObject({ text: '● ' })
    expect(wrapped[0]?.runs[1]).toMatchObject({ text: 'ab', bold: true })
    expect(wrapped[1]?.runs[0]).toMatchObject({ text: 'cdef', bold: true })
  })

  it('keeps each run segment intact and within the width', () => {
    const wrapped = wrapRuns([{ text: 'aa', code: true }, { text: 'bb', bold: true }, { text: 'cc' }], 4, '')
    expect(wrapped.map(line => line.text)).toEqual(['aabb', 'cc'])
    expect(wrapped[0]?.runs.map(run => run.text)).toEqual(['aa', 'bb'])
    expect(wrapped[0]?.runs[0]).toMatchObject({ code: true })
    expect(wrapped[1]?.runs[0]).toMatchObject({ text: 'cc' })
  })

  it('counts double-width characters as two cells', () => {
    const wrapped = wrapRuns([{ text: '你好好', bold: true }], 4, '')
    expect(wrapped.map(line => line.text)).toEqual(['你好', '好'])
  })

  it('returns no lines for empty runs', () => {
    expect(wrapRuns([], 10, '')).toEqual([])
  })
})

describe('retryCountdownSeconds', () => {
  it('rounds up with a 1s floor', () => {
    expect(retryCountdownSeconds(1000, 0)).toBe(1)
    expect(retryCountdownSeconds(1999, 1000)).toBe(1)
    expect(retryCountdownSeconds(2001, 1000)).toBe(2)
    expect(retryCountdownSeconds(12000, 500)).toBe(12)
  })

  it('returns null when never anchored', () => {
    expect(retryCountdownSeconds(0, 1000)).toBeNull()
  })
})
