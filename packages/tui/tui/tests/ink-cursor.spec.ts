import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import xtermHeadless from '@xterm/headless'
import { describe, expect, it } from 'vitest'

interface CursorPosition {
  x: number
  y: number
}

interface LogUpdate {
  (output: string): boolean
  setCursorPosition: (position: CursorPosition | undefined) => void
}

interface LogUpdateModule {
  default: {
    create: (stream: { columns: number; isTTY: boolean; write: (output: string) => boolean }, options: {
      showCursor: boolean
      incremental: boolean
      absoluteLineDiff?: boolean
    }) => LogUpdate
  }
}

async function loadLogUpdate(): Promise<LogUpdateModule['default']> {
  const require = createRequire(import.meta.url)
  const inkRoot = dirname(dirname(require.resolve('ink')))
  const module = await import(pathToFileURL(join(inkRoot, 'build/log-update.js')).href) as LogUpdateModule
  return module.default
}

async function flush(terminal: InstanceType<typeof xtermHeadless.Terminal>): Promise<void> {
  await new Promise<void>((resolve) => { terminal.write('', resolve) })
}

describe('Ink cursor-only terminal updates', () => {
  it.each([
    { incremental: false, trailingNewline: false },
    { incremental: false, trailingNewline: true },
    { incremental: true, trailingNewline: false },
    { incremental: true, trailingNewline: true },
  ])('keeps the requested row without drift ($incremental, trailing=$trailingNewline)', async ({ incremental, trailingNewline }) => {
    const terminal = new xtermHeadless.Terminal({ cols: 12, rows: 6, allowProposedApi: true, convertEol: true })
    const stream = {
      columns: 12,
      isTTY: true,
      write: (output: string): boolean => {
        terminal.write(output)
        return true
      },
    }
    const logUpdate = await loadLogUpdate()
    const render = logUpdate.create(stream, { showCursor: true, incremental })
    const frame = trailingNewline ? 'a\nb\nc\n' : 'a\nb\nc\nd'
    const expectedRow = 2

    render.setCursorPosition({ x: 1, y: expectedRow })
    render(frame)
    await flush(terminal)
    expect(terminal.buffer.active.cursorY).toBe(expectedRow)

    // Whitespace-only composer edits and navigation can change only the
    // native cursor while Ink's rendered frame bytes remain identical.
    for (let index = 0; index < 20; index += 1) {
      render.setCursorPosition({ x: 2 + index % 5, y: expectedRow })
      render(frame)
      await flush(terminal)
      expect(terminal.buffer.active.cursorY).toBe(expectedRow)
    }
  })

  it('keeps the last mounted caret when a later frame does not resubmit it', async () => {
    const terminal = new xtermHeadless.Terminal({ cols: 12, rows: 6, allowProposedApi: true, convertEol: true })
    const stream = {
      columns: 12,
      isTTY: true,
      write: (output: string): boolean => {
        terminal.write(output)
        return true
      },
    }
    const logUpdate = await loadLogUpdate()
    const render = logUpdate.create(stream, { showCursor: true, incremental: true })
    render.setCursorPosition({ x: 1, y: 2 })
    render('a\nb\nc\nd')
    await flush(terminal)
    expect(terminal.buffer.active.cursorY).toBe(2)
    render('a\nB\nc\nd')
    await flush(terminal)
    expect(terminal.buffer.active.cursorY).toBe(2)
    render.setCursorPosition(undefined)
    render('a\nB\nc\nd')
    await flush(terminal)
  })
})


it('erases old cells before an anchored scrollbar skips over a now-empty row', async () => {
  const terminal = new xtermHeadless.Terminal({ cols: 20, rows: 6, allowProposedApi: true, convertEol: true })
  const logUpdate = await loadLogUpdate()
  const render = logUpdate.create({ columns: 20, isTTY: true, write: output => { terminal.write(output); return true } }, { showCursor: true, incremental: true, absoluteLineDiff: true })
  try {
    render('header\n  BACK TO BOTTOM\x1b[19G█\nfooter')
    await flush(terminal)
    expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toContain('BACK TO BOTTOM')
    render('header\n\x1b[19G█\nfooter')
    await flush(terminal)
    expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe(' '.repeat(18) + '█')
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('header')
    expect(terminal.buffer.active.getLine(2)?.translateToString(true)).toBe('footer')
  } finally { terminal.dispose() }
})
