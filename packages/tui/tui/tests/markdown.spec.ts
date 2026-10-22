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
    expect(runs.find(run => run.text === 'soft')?.italic).toBe(true)
  })

  it('emits runs for headings', () => {
    const lines = markdownLines('## Title with `code`')
    const heading = lines[0]
    expect(heading?.text).toBe('Title with code')
    expect(heading?.color).toBeUndefined()
    expect(heading?.runs?.every(run => run.bold)).toBe(true)
    expect(heading?.runs?.find(run => run.text === 'code')?.code).toBe(true)
  })

  it('keeps one blank row between markdown blocks', () => {
    const texts = markdownLines('# Title\n\nA paragraph\n\n- item').map(line => line.text)
    expect(texts[texts.indexOf('Title') + 1]).toBe('')
    expect(texts[texts.indexOf('A paragraph') + 1]).toBe('')
    expect(markdownLines('\n\n# Only').map(line => line.text)[0]).toBe('Only')
  })

  it('keeps code and quote structural lines plain and styles list items', () => {
    const lines = markdownLines('```ts\nconst x = 1\n```\n\n- item\n\n> quote')
    expect(lines.find(line => line.text === '│ const x = 1')?.runs).toBeUndefined()
    expect(lines.find(line => line.text === '- item')?.runs).toBeDefined()
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
  it('rounds up while the deadline remains in the future', () => {
    expect(retryCountdownSeconds(1000, 0)).toBe(1)
    expect(retryCountdownSeconds(1999, 1000)).toBe(1)
    expect(retryCountdownSeconds(2001, 1000)).toBe(2)
    expect(retryCountdownSeconds(12000, 500)).toBe(12)
  })

  it('returns null when never anchored', () => {
    expect(retryCountdownSeconds(0, 1000)).toBeNull()
    expect(retryCountdownSeconds(1000, 1000)).toBeNull()
    expect(retryCountdownSeconds(1000, 1001)).toBeNull()
  })
})


describe('structured terminal tables', () => {
  it('wraps cells without truncation and preserves grid edges', () => {
    const lines = markdownLines('| Name | Detail |\n| --- | ---: |\n| 中文 | abcdefghijklmnopqrstuvwxyz |', 38)
    const rows = lines.map(line => line.text)
    expect(rows.some(row => row.startsWith('┌'))).toBe(true)
    expect(rows.some(row => row.startsWith('└'))).toBe(true)
    expect(rows.join('')).not.toContain('…')
    expect(rows.filter(row => row.startsWith('│')).map(row => row.replace(/[│ ]/g, '')).join('')).toContain('abcdefghijklmnopqrstuvwxyz')
  })
  it('uses labeled vertical rows when columns cannot fit, without losing values', () => {
    const rows = markdownLines('| Name | Detail |\n| --- | --- |\n| 中文 | preserved value |', 14).map(line => line.text)
    expect(rows.some(row => row.startsWith('Name:'))).toBe(true)
    expect(rows.join('').replace(/ /g, '')).toContain('preservedvalue')
    expect(rows.join('')).not.toContain('…')
  })
})

describe('rich table cells and grapheme boundaries', () => {
  it.each([90, 18])('retains nested styles in grid or vertical fallback at %i columns', width => {
    const lines = markdownLines('| Name | Value |\n| --- | --- |\n| **中文** | *italic* ~~old~~ `code` [link](https://example.test) |', width)
    const runs = lines.flatMap(line => line.runs ?? [])
    for (const [text, key] of [['中文', 'bold'], ['italic', 'italic'], ['old', 'strikethrough'], ['code', 'code'], ['link', 'underline']] as const) {
      expect(runs.filter(run => run[key]).map(run => run.text).join('')).toContain(text)
    }
    expect(runs.filter(run => run.text.includes('│')).every(run => !run.code && !run.italic && !run.strikethrough)).toBe(true)
  })
  it('keeps multiline Chinese and emoji table edges equal without dropping text', async () => {
    const { default: width } = await import('string-width')
    const lines = markdownLines('| A | B |\n| --- | ---: |\n| **你好🙂**<br>再见 | `abcdefghijk` |', 32)
    const grid = lines.filter(line => /^[│┌├└]/u.test(line.text))
    expect(grid.length).toBeGreaterThan(4)
    expect(new Set(grid.map(line => width(line.text))).size).toBe(1)
    expect(grid.flatMap(line => line.runs ?? []).filter(run => run.bold).map(run => run.text).join('')).toContain('你好🙂')
  })
  it('never splits a grapheme across styled runs or wraps', async () => {
    const { default: width } = await import('string-width')
    const source = 'a👩🏽‍💻é你好'
    const lines = wrapRuns([{ text: 'a👩', bold: true }, { text: '🏽‍💻e', code: true }, { text: '́你好' }], 3, '')
    expect(lines.map(line => line.text).join('')).toBe(source)
    expect(lines.every(line => width(line.text) <= 3)).toBe(true)
    expect(lines.flatMap(line => line.runs).some(run => run.text.includes('👩🏽‍💻'))).toBe(true)
    expect(lines.some(line => line.text.includes('é'))).toBe(true)
  })
})


describe('reference Markdown hierarchy', () => {
  it('uses neutral bold headings and h1 emphasis instead of semantic colors', () => {
    const lines = markdownLines('# One\n\n## Two\n\n### Three')
    for (const line of lines.filter(line => line.text)) {
      expect(line.color).toBeUndefined()
      expect(line.runs?.every(run => run.bold)).toBe(true)
    }
    expect(lines[0]?.runs?.[0]).toMatchObject({ italic: true, underline: true })
  })
  it('preserves ordered starts, nested hierarchy and list inline styles', () => {
    const rows = markdownLines('3. **中文**\n4. `code`\n   - *nested*')
    expect(rows.map(row => row.text)).toContain('3. 中文')
    expect(rows.map(row => row.text)).toContain('4. code')
    expect(rows.map(row => row.text)).toContain('  - nested')
    expect(rows.flatMap(row => row.runs ?? []).find(run => run.text === '中文')?.bold).toBe(true)
  })
})
