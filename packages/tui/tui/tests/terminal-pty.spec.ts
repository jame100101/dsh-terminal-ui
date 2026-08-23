import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as nodePty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { afterEach, describe, expect, it } from 'vitest'
import { composerTextWrapWidth, selectComposerLayout, selectTerminalFrameWidth } from '../src/viewport'

function composerWrapWidth(columns: number): number {
  return composerTextWrapWidth(selectTerminalFrameWidth(columns) - 2)
}

const fixture = fileURLToPath(new URL('./fixtures/pty-app.tsx', import.meta.url))
const activePtys = new Set<nodePty.IPty>()

afterEach(() => {
  for (const pty of activePtys) {
    try { pty.kill() } catch {}
  }
  activePtys.clear()
})

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await delay(20)
  }
  throw new Error('timed out waiting for PTY terminal state')
}

interface PtyHarness {
  pty: nodePty.IPty
  terminal: InstanceType<typeof xtermHeadless.Terminal>
  output: () => string
  write: (input: string) => Promise<void>
  send: (input: string) => Promise<void>
  resize: (columns: number, rows: number) => Promise<void>
  waitForExit: () => Promise<void>
}

function spawnFixture(columns: number, rows: number): PtyHarness {
  const terminal = new xtermHeadless.Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 })
  const pty = nodePty.spawn(process.execPath, ['--import', 'tsx/esm', fixture], {
    cols: columns,
    rows,
    cwd: process.cwd(),
    name: 'xterm-256color',
    env: { ...process.env, CI: 'false', TERM: 'xterm-256color' },
  })
  activePtys.add(pty)
  let output = ''
  let parsed = Promise.resolve()
  pty.onData((data) => {
    output += data
    parsed = parsed.then(() => new Promise<void>((resolve) => { terminal.write(data, resolve) }))
  })
  terminal.onData((data) => { pty.write(data) })
  const exited = new Promise<void>((resolve) => {
    pty.onExit(() => {
      activePtys.delete(pty)
      resolve()
    })
  })
  const settleWrite = async (before: number): Promise<void> => {
    await waitFor(() => output.length > before)
    await delay(80)
    await parsed
  }
  return {
    pty,
    terminal,
    output: () => output,
    write: async (input) => {
      const before = output.length
      pty.write(input)
      await settleWrite(before)
    },
    send: async (input) => {
      pty.write(input)
      await delay(100)
      await parsed
    },
    resize: async (nextColumns, nextRows) => {
      const before = output.length
      terminal.resize(nextColumns, nextRows)
      pty.resize(nextColumns, nextRows)
      await settleWrite(before)
    },
    waitForExit: async () => {
      await Promise.race([
        exited,
        delay(10_000).then(() => { throw new Error('PTY fixture did not exit') }),
      ])
      await parsed
    },
  }
}

function screenLines(terminal: InstanceType<typeof xtermHeadless.Terminal>): string[] {
  const buffer = terminal.buffer.active
  return Array.from({ length: terminal.rows }, (_, index) =>
    buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? '')
}

function caretIsOnComposer(terminal: InstanceType<typeof xtermHeadless.Terminal>): boolean {
  const composerRow = screenLines(terminal).findIndex(line => line.trimStart().startsWith('›'))
  return composerRow >= 0 && terminal.buffer.active.cursorY === composerRow
}

function composerTopRow(lines: readonly string[]): number {
  const promptRow = lines.findIndex(line => line.trimStart().startsWith('›'))
  if (promptRow >= 0) return promptRow
  const separators = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0 && /^─+$/u.test(line))
  return separators.length >= 2 ? (separators.at(-2)?.index ?? -2) + 1 : -1
}

function expectCaretOnComposer(terminal: InstanceType<typeof xtermHeadless.Terminal>, caretLine = 0): void {
  const lines = screenLines(terminal)
  const composerRow = composerTopRow(lines)
  expect(composerRow, `composer missing from screen:\n${lines.join('\n')}`).toBeGreaterThanOrEqual(0)
  expect(terminal.buffer.active.cursorY).toBe(composerRow + caretLine)
}

function expectScrollbarColumn(
  terminal: InstanceType<typeof xtermHeadless.Terminal>,
  physicalColumns: number,
): void {
  const buffer = terminal.buffer.active
  const scrollbarColumn = selectTerminalFrameWidth(physicalColumns) - 1
  const safetyColumn = physicalColumns - 1
  let scrollbarRows = 0
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row)
    if (line?.getCell(scrollbarColumn)?.getChars() === '█') scrollbarRows += 1
    expect((line?.getCell(safetyColumn)?.getChars() ?? '').trim()).toBe('')
  }
  // ConPTY reserializes the child screen before node-pty emits it, so the
  // parent xterm emulator can reinterpret emoji widths and move one emitted
  // row after Ink's CHA has already been consumed. Unix PTYs preserve the
  // original CHA bytes and therefore enforce every scrollbar row exactly.
  if (process.platform === 'win32') expect(scrollbarRows).toBeGreaterThan(0)
  else expect(scrollbarRows).toBeGreaterThan(3)
}

describe('production TUI through a real PTY', () => {
  it('keeps the cursor and scrollbar stable through typing, scrolling, drag, and resize', async () => {
    const harness = spawnFixture(80, 24)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('')
    expectCaretOnComposer(harness.terminal)
    expect(screenLines(harness.terminal).slice(4).filter(line => line.trimEnd().endsWith('█')).length).toBeGreaterThan(3)
    expectScrollbarColumn(harness.terminal, 80)

    for (const input of [
      ...Array.from({ length: 20 }, () => ' '),
      ...Array.from('ascii mixed spaces'),
      '\x7f',
      '\x1b[D',
      '\x1b[C',
      '\x1b[H',
      '\x1b[F',
      '中',
      '文',
      '😀',
      '⚙',
    ]) {
      await harness.write(input)
      expectCaretOnComposer(harness.terminal)
    }

    const draftBeforeRapid = `${' '.repeat(20)}ascii mixed space中文😀⚙`
    const rapid = 'rapid '.repeat(30)
    const rapidDraft = `${draftBeforeRapid}${rapid}`
    await harness.write(rapid)
    expectCaretOnComposer(
      harness.terminal,
      selectComposerLayout(rapidDraft, rapidDraft.length, composerWrapWidth(80), 5).caretLine,
    )
    await harness.resize(100, 30)
    expectCaretOnComposer(
      harness.terminal,
      selectComposerLayout(rapidDraft, rapidDraft.length, composerWrapWidth(100), 5).caretLine,
    )
    await harness.write(' after resize')
    const resizedDraft = `${rapidDraft} after resize`
    const resizedCaretLine = selectComposerLayout(resizedDraft, resizedDraft.length, composerWrapWidth(100), 5).caretLine
    expectCaretOnComposer(harness.terminal, resizedCaretLine)

    await harness.write('\x1b[5~')
    const gutterRows = screenLines(harness.terminal).slice(4).filter(line => line.trimEnd().endsWith('█'))
    expect(gutterRows.length).toBeGreaterThan(3)
    expectScrollbarColumn(harness.terminal, 100)
    await harness.write('\x1b[<0;100;5M')
    await harness.write('\x1b[<32;100;14M')
    await harness.send('\x1b[<0;100;14m')
    await harness.write('\x1b[<0;99;22M')
    await harness.send('\x1b[<0;99;22m')
    expectCaretOnComposer(harness.terminal, resizedCaretLine)

    await harness.resize(40, 18)
    const narrowCaretLine = selectComposerLayout(resizedDraft, resizedDraft.length, composerWrapWidth(40), 5).caretLine
    expectCaretOnComposer(harness.terminal, narrowCaretLine)
    expect(screenLines(harness.terminal).slice(4).filter(line => line.trimEnd().endsWith('█')).length).toBeGreaterThan(3)
    expectScrollbarColumn(harness.terminal, 40)
    await harness.resize(100, 30)
    expectCaretOnComposer(harness.terminal, resizedCaretLine)

    await harness.write('\x0c')
    await harness.write('\x04')
    await harness.waitForExit()
    expect(harness.terminal.buffer.active.type).toBe('normal')
    expect(harness.output()).toContain('\x1b[?1049h')
    expect(harness.output()).toContain('\x1b[?1049l')
    expect(harness.output()).toContain('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
    expect(harness.output()).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
    expect(harness.output().lastIndexOf('\x1b[?25l')).toBeLessThan(harness.output().lastIndexOf('\x1b[?25h'))
  }, 60_000)

  it('restores the primary buffer and cursor after the Ctrl+C exit path', async () => {
    const harness = spawnFixture(80, 24)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.write('\x03')
    await harness.write('\x03')
    await harness.waitForExit()
    expect(harness.terminal.buffer.active.type).toBe('normal')
    expect(harness.output().lastIndexOf('\x1b[?1049l')).toBeLessThan(harness.output().lastIndexOf('\x1b[?25h'))
  }, 30_000)
})
