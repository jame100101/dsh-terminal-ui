import process from 'node:process'
import { execFileSync } from 'node:child_process'
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

function spawnFixture(columns: number, rows: number, env: Record<string, string> = {}): PtyHarness {
  const terminal = new xtermHeadless.Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 })
  const pty = nodePty.spawn(process.execPath, ['--import', 'tsx/esm', fixture], {
    cols: columns,
    rows,
    cwd: process.cwd(),
    name: 'xterm-256color',
    env: { ...process.env, CI: 'false', NODE_ENV: 'production', TERM: 'xterm-256color', FORCE_COLOR: '3', ...env },
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
      // The first ConPTY chunk is Ink's resize-listener reset. The matching
      // React commit remeasures the composer and emits the native cursor
      // suffix in a later chunk, so wait through that second paint.
      await delay(120)
      await parsed
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
  const composerRow = screenLines(terminal).findIndex(line => line.trimStart().startsWith('❯'))
  return composerRow >= 0 && terminal.buffer.active.cursorY === composerRow
}

function composerTopRow(lines: readonly string[]): number {
  const promptRow = lines.findIndex(line => line.trimStart().startsWith('❯'))
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
  expect(
    terminal.buffer.active.cursorY,
    `cursor=${terminal.buffer.active.cursorY} composer=${composerRow} caretLine=${caretLine}\n${lines.join('\n')}`,
  ).toBe(composerRow + caretLine)
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
    const cell = line?.getCell(scrollbarColumn)
    if (cell && (process.platform === 'darwin' ? cell.getChars() === ' ' && !cell.isBgDefault() : cell.getChars() === '█')) {
      scrollbarRows += 1
      // Exercise actual ANSI colors; non-TTY render fixtures strip them.
      // A foreground glyph alone leaves stripes with macOS font leading.
      expect(cell.isBgDefault()).toBe(process.platform !== 'darwin')
      expect(cell.getChars()).toBe(process.platform === 'darwin' ? ' ' : '█')
      if (process.platform === 'darwin') expect(cell.getBgColor()).toBe(cell.getFgColor())
    }
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
  it.each([[80, 24], [32, 12]])('keeps input usable at %ix%i with no color and reduced motion', async (columns, rows) => {
    const harness = spawnFixture(columns!, rows!, {
      TERM: 'dumb', FORCE_COLOR: '0', NO_COLOR: '1', DSH_TUI_REDUCED_MOTION: '1', TUI_PTY_STATIC_BUSY: '1',
    })
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('中文 draft')
    const screen = screenLines(harness.terminal).join('\n')
    expect(screen).toContain('中文 draft')
    expect(screen).toContain('read only')
    expectCaretOnComposer(harness.terminal)
    expect(harness.output()).not.toMatch(/\x1b\[(?:38|48);/)
    // No provider/store updates in this fixture: an unchanged busy view must not animate.
    await delay(200)
    const quietOutput = harness.output().length
    await delay(650)
    expect(harness.output().length).toBe(quietOutput)
    await harness.send(' ok')
    expect(screenLines(harness.terminal).join('\n')).toContain('中文 draft ok')
    await harness.send('\x03'); await harness.send('\x03'); await harness.waitForExit()
    expect(harness.terminal.buffer.active.type).toBe('normal')
  }, 30_000)

  it('accepts Ctrl+R history results as edits through real terminal input', async () => {
    const harness = spawnFixture(100, 30)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('earlier command')
    await harness.send('\r')
    await harness.send('scratch draft')
    await harness.send('\x12')
    await harness.send('earlier')
    expect(screenLines(harness.terminal).join('\n')).toContain('History search: earlier')
    await harness.send('\r')
    const lines = screenLines(harness.terminal)
    expect(lines.find(line => line.trimStart().startsWith('❯'))).toContain('earlier command')
    expect(lines.filter(line => line.includes('accepted:earlier command'))).toHaveLength(1)
    harness.pty.kill()
    await harness.waitForExit()
  }, 30_000)

  it('recalls consecutive history entries and restores scratch text and caret', async () => {
    const harness = spawnFixture(100, 30)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    const composer = (): string => screenLines(harness.terminal).find(line => line.trimStart().startsWith('❯')) ?? ''
    await harness.send('first entry')
    await waitFor(() => composer().includes('first entry'))
    await harness.send('\r')
    await waitFor(() => !composer().includes('entry'))
    await harness.send('second entry')
    await waitFor(() => composer().includes('second entry'))
    await harness.send('\r')
    await waitFor(() => !composer().includes('entry'))
    await harness.send('scratch')
    await waitFor(() => composer().includes('scratch'))
    await harness.send('\x1b[D')
    await harness.send('\x1b[A')
    await waitFor(() => composer().includes('second entry'))
    expect(composer()).toContain('second entry')
    await harness.send('\x1b[A')
    await waitFor(() => composer().includes('first entry'))
    expect(composer()).toContain('first entry')
    await harness.send('\x1b[B')
    await waitFor(() => composer().includes('second entry'))
    expect(composer()).toContain('second entry')
    await harness.send('\x1b[B')
    await waitFor(() => composer().includes('scratch'))
    expect(composer()).toContain('scratch')
    await harness.send('!')
    await waitFor(() => composer().includes('scratc!h'))
    expect(composer()).toContain('scratc!h')
    await harness.send('\x0c')
    await waitFor(() => composer().includes('scratc!h'))
    expect(composer()).toContain('scratc!h')
    harness.pty.kill()
    await harness.waitForExit()
  }, 30_000)

  it('edits combining and ZWJ graphemes without splitting them', async () => {
    const harness = spawnFixture(100, 30)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('a👨‍👩‍👧‍👦e\u0301z')
    await harness.send('\x1b[D')
    await harness.send('\x7f')
    await harness.send('\x1b[D')
    await harness.send('X')
    await harness.send('\r')
    await waitFor(() => screenLines(harness.terminal).join('\n').includes('accepted:aX👨‍👩‍👧‍👦z'))
    expect(screenLines(harness.terminal).join('\n')).toContain('accepted:aX👨‍👩‍👧‍👦z')
    harness.pty.kill()
    await harness.waitForExit()
  }, 30_000)

  it('keeps Shift+Tab within settings without changing permission', async () => {
    const harness = spawnFixture(100, 30)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('/settings')
    await harness.send('\r')
    await harness.send('\x1b[Z')
    const screen = screenLines(harness.terminal).join('\n')
    expect(screen).toContain('read only')
    expect(screen).not.toContain('workspace write')
    harness.pty.kill()
    await harness.waitForExit()
  }, 30_000)

  it('keeps the cursor and scrollbar stable through typing, scrolling, drag, and resize', async () => {
    const harness = spawnFixture(80, 24)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('')
    expectCaretOnComposer(harness.terminal)
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
    // A wrap changes Yoga height before the native caret's follow-up commit.
    // Wait for that commit rather than treating the fixed 80ms chunk delay as a frame boundary.
    const rapidCaretLine = selectComposerLayout(rapidDraft, rapidDraft.length, composerWrapWidth(80), 5).caretLine
    await waitFor(() => {
      const row = composerTopRow(screenLines(harness.terminal))
      return row >= 0 && harness.terminal.buffer.active.cursorY === row + rapidCaretLine
    })
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
    expectScrollbarColumn(harness.terminal, 100)
    await harness.write('\x1b[<0;100;5M')
    await harness.write('\x1b[<32;100;14M')
    await harness.send('\x1b[<0;100;14m')
    const jumpRow = screenLines(harness.terminal).findIndex(line => /回到底部|back to bottom/.test(line)) + 1
    expect(jumpRow).toBeGreaterThan(0)
    await harness.write(`\x1b[<0;50;${jumpRow}M`)
    await harness.send(`\x1b[<0;50;${jumpRow}m`)
    expectCaretOnComposer(harness.terminal, resizedCaretLine)

    await harness.resize(40, 18)
    const narrowCaretLine = selectComposerLayout(resizedDraft, resizedDraft.length, composerWrapWidth(40), 5).caretLine
    expectCaretOnComposer(harness.terminal, narrowCaretLine)
    expectScrollbarColumn(harness.terminal, 40)
    await harness.resize(100, 30)
    expectCaretOnComposer(harness.terminal, resizedCaretLine)

    await harness.send('\x0c')
    // Redraw retains the draft; explicitly select and delete before EOF exit.
    await harness.send('\x01')
    await harness.send('\x7f')
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

  it.each(['signal', 'Ctrl+Z'] as const)('restores protocols and preserves draft after POSIX %s suspend/continue', async mode => {
    if (process.platform === 'win32') return
    const harness = spawnFixture(80, 24)
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.write('保留 draft 😀')
    const beforeSuspend = harness.output().length
    if (mode === 'signal') process.kill(harness.pty.pid, 'SIGTSTP')
    else await harness.send('\x1a')
    try {
      await waitFor(() => {
        const state = execFileSync('ps', ['-o', 'stat=', '-p', String(harness.pty.pid)], { encoding: 'utf8' })
        return state.includes('T')
      })
      await waitFor(() => harness.terminal.buffer.active.type === 'normal')
      const suspended = harness.output().slice(beforeSuspend)
      expect(suspended).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
      expect(suspended).toContain('\x1b[?25h')
    } finally { process.kill(harness.pty.pid, 'SIGCONT') }
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal)).catch(error => { throw new Error(`${error} buffer=${harness.terminal.buffer.active.type} cursor=${harness.terminal.buffer.active.cursorY}\n${screenLines(harness.terminal).join('\n')}\n${JSON.stringify(harness.output().slice(-900))}`) })
    expect(screenLines(harness.terminal).join('\n')).toContain('保留 draft 😀')
    const resumed = harness.output().slice(beforeSuspend)
    expect(resumed.lastIndexOf('\x1b[?1000h\x1b[?1002h\x1b[?1006h')).toBeGreaterThan(resumed.lastIndexOf('\x1b[?1006l'))
    await harness.write(' continued')
    expect(screenLines(harness.terminal).join('\n')).toContain('保留 draft 😀 continued')
    await harness.send('\x03'); await harness.send('\x03'); await harness.waitForExit()
    expect(harness.terminal.buffer.active.type).toBe('normal')
  }, 30_000)

  it.each(['SIGTERM', 'SIGUSR2'] as const)('restores terminal protocols on %s', async signal => {
    if (process.platform === 'win32') return
    const harness = spawnFixture(80, 24, { TUI_PTY_CRASH: '1' })
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    process.kill(harness.pty.pid, signal)
    await harness.waitForExit()
    expect(harness.terminal.buffer.active.type).toBe('normal')
    expect(harness.output()).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
    expect(harness.output().lastIndexOf('\x1b[?25l')).toBeLessThan(harness.output().lastIndexOf('\x1b[?25h'))
  }, 30_000)

  it('keeps busy-turn input, permission cycling, animation, and history scrolling responsive', async () => {
    const harness = spawnFixture(80, 24, { TUI_PTY_BUSY: '1' })
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await waitFor(() => screenLines(harness.terminal).some(line => line.includes('Thinking')))
    const started = Date.now()

    // Enhanced keyboard terminals emit press/repeat/release for one
    // Shift+Tab. Only the press rotates permission, and later prompt/turn
    // paints retain that selected mode.
    await harness.send('\x1b[9;2u')
    await harness.send('\x1b[9;2:2u')
    await harness.send('\x1b[9;2:3u')
    await waitFor(() => screenLines(harness.terminal).some(line => line.includes('workspace write')), 3_000)

    await harness.send('中文字')
    await harness.send('\x7f')
    await harness.send('busy-probe')
    await harness.send('\r')
    await waitFor(() => screenLines(harness.terminal).some(line => line.includes('accepted:中文busy-probe')), 3_000)
    await new Promise<void>(resolve => setTimeout(resolve, 200))
    expect(screenLines(harness.terminal).some(line => line.includes('workspace write'))).toBe(true)
    await harness.send('\x1b[5~')
    await harness.send('\x1b[6~')
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(harness.output().length).toBeLessThan(2_000_000)

    harness.pty.kill()
    await harness.waitForExit()
  }, 30_000)

  it('toggles a plugin with Enter and keeps the settings panel interactive', async () => {
    const harness = spawnFixture(80, 24, { TUI_PTY_PLUGINS: '1' })
    await waitFor(() => harness.terminal.buffer.active.type === 'alternate' && caretIsOnComposer(harness.terminal))
    await harness.send('/settings plugins')
    await harness.send('\r')
    await waitFor(() => screenLines(harness.terminal).some(line => line.includes('● fixture-plugin')), 3_000)

    await harness.send('\r')
    // Host state and its completion notice can arrive in separate React commits.
    await waitFor(() => {
      const lines = screenLines(harness.terminal)
      return lines.some(line => line.includes('○ fixture-plugin')) && lines.some(line => line.includes('fixture-plugin → disabled'))
    }, 3_000)
    expect(screenLines(harness.terminal).some(line => line.includes('fixture-plugin → disabled'))).toBe(true)

    await harness.send('\r')
    await waitFor(() => {
      const lines = screenLines(harness.terminal)
      return lines.some(line => line.includes('● fixture-plugin')) && lines.some(line => line.includes('fixture-plugin → enabled'))
    }, 3_000)
    expect(screenLines(harness.terminal).some(line => line.includes('fixture-plugin → enabled'))).toBe(true)

    harness.pty.kill()
    await harness.waitForExit()
  }, 30_000)
})
