/**
 * Ground-truth render tests against the Ink 7 App: the root Box fills the
 * terminal (so Ink always takes its whole-screen clear path and interleaved
 * cursor writes can never corrupt the frame), Ink's OWN cursor suffix lands
 * on the composer caret (no manual CUP writes anywhere), wheel reports fed
 * through Ink's input stream drive the DamnatioX scroll semantics, and the
 * screen stays duplicate-free under streaming plus rapid wheel scrolling.
 */

import process from 'node:process'
import { Writable, PassThrough } from 'node:stream'
import { createElement } from 'react'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { render } from 'ink'
import stringWidth from 'string-width'
import { marked } from 'marked'
import xtermHeadless from '@xterm/headless'
import { App, brandGlyph, permissionColor, permissionLabel, traceLineColor } from '../src/render'
import { settingsTabCell } from '../src/settings-chrome'
import { selectComposerLayout, selectTerminalFrameWidth } from '../src/viewport'
import type { TuiHost } from '../src/render'
import { createTuiStore } from '../src/store'
import type { TuiStore } from '../src/store'
import type { TuiNode } from '../src/types'

const COLUMNS = 100
const ROWS = 30

/** A Writable that records every byte written, with terminal dimensions. */
class Capture extends Writable {
  output = ''
  columns = COLUMNS
  rows = ROWS
  readonly terminal: InstanceType<typeof xtermHeadless.Terminal>

  constructor() {
    super()
    this.terminal = new xtermHeadless.Terminal({ cols: this.columns, rows: this.rows, allowProposedApi: true, convertEol: true })
    this.on('resize', () => { this.terminal.resize(this.columns, this.rows) })
  }

  isTTY = true
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += String(chunk)
    this.terminal.write(String(chunk), callback)
  }

  /** Rows in the active terminal buffer after applying every emitted byte. */
  screenLines(): string[] {
    const buffer = this.terminal.buffer.active
    return Array.from({ length: this.rows }, (_, index) =>
      buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? '')
  }
}

afterEach(() => {
  process.stdout.write = originalWrite
})

const originalWrite = process.stdout.write

/** Strip ANSI escapes so rendered rows can be indexed. */
function plain(output: string): string[] {
  return output
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .split('\n')
}

/** The last frame's rows (each frame starts with the header title). */
function lastFrameLines(output: string): string[] {
  const marker = 'DSH-TUI'
  const index = output.lastIndexOf(marker)
  if (index === -1) throw new Error(`header not found in ${JSON.stringify(output.slice(0, 400))}`)
  return plain(output.slice(index))
}

/** Number of rendered rows in a frame (a trailing newline adds one entry). */
function frameRows(lines: string[]): number {
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

/** Ink's last cursor suffix: cursorUp(n) + cursorTo(x) + showCursor. */
function lastCursorSuffix(output: string): { moveUp: number; column: number } {
  const matches = [...output.matchAll(/\x1b\[(\d+)A\x1b\[(\d+)G\x1b\[\?25h/g)]
  const last = matches[matches.length - 1]
  if (last === undefined) throw new Error('no cursor suffix emitted')
  return { moveUp: Number(last[1]), column: Number(last[2]) }
}

/** Assert the scrollbar occupies one stable cell beside a blank autowrap column. */
function expectScrollbarColumn(capture: Capture): void {
  const buffer = capture.terminal.buffer.active
  const scrollbarColumn = selectTerminalFrameWidth(capture.columns) - 1
  const safetyColumn = capture.columns - 1
  let scrollbarRows = 0
  for (let row = 0; row < capture.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row)
    if (line?.getCell(scrollbarColumn)?.getChars() === '█') scrollbarRows += 1
    expect((line?.getCell(safetyColumn)?.getChars() ?? '').trim()).toBe('')
  }
  expect(scrollbarRows).toBeGreaterThan(3)
}

/** Build an SGR left-click report for one rendered trailing disclosure arrow. */
function disclosureClick(lines: readonly string[], needle: string): string {
  const row = lines.findIndex(line => line.includes(needle))
  const rendered = lines[row]?.trimEnd()
  if (row < 0 || rendered === undefined || (!rendered.endsWith('▶') && !rendered.endsWith('▼'))) {
    throw new Error(`disclosure row not found for ${needle}`)
  }
  return `\x1b[<0;${stringWidth(rendered)};${row + 1}M`
}

/**
 * A minimal terminal-screen emulator: applies Ink's output stream the way a
 * real terminal would (clear screen, erase lines, cursor moves, text) so
 * residue from a wrong erase count becomes visible as duplicated rows —
 * exactly what `lastFrameLines` cannot see.
 */
class Screen {
  rows: string[][]
  x = 0
  y = 0

  constructor(public readonly columns: number, public readonly height: number) {
    this.rows = Array.from({ length: height }, () => Array.from({ length: columns }, () => ' '))
  }

  apply(chunk: string): void {
    let index = 0
    while (index < chunk.length) {
      const code = chunk.charCodeAt(index)
      if (code === 0x1b && chunk[index + 1] === '[') {
        const match = /^\x1b\[([0-9;?]*)([a-zA-Z])/.exec(chunk.slice(index))
        if (match === null) {
          index += 1
          continue
        }
        const params = (match[1] ?? '').split(';').map(value => Number.parseInt(value, 10))
        const final = match[2] ?? ''
        index += match[0].length
        switch (final) {
          case 'J':
            if (params[0] === 2 || params[0] === 3) {
              for (const row of this.rows) row.fill(' ')
            }
            break
          case 'K':
            this.rows[this.y]?.fill(' ')
            break
          case 'A':
            this.y = Math.max(0, this.y - (params[0] || 1))
            break
          case 'B':
            this.y = Math.min(this.height - 1, this.y + (params[0] || 1))
            break
          case 'C':
            this.x = Math.min(this.columns - 1, this.x + (params[0] || 1))
            break
          case 'D':
            this.x = Math.max(0, this.x - (params[0] || 1))
            break
          case 'G':
            this.x = Math.max(0, Math.min(this.columns - 1, (params[0] || 1) - 1))
            break
          case 'd':
            this.y = Math.max(0, Math.min(this.height - 1, (params[0] || 1) - 1))
            break
          case 'H':
          case 'f':
            this.y = Math.max(0, Math.min(this.height - 1, (params[0] || 1) - 1))
            this.x = Math.max(0, Math.min(this.columns - 1, (params[1] || 1) - 1))
            break
          default:
            break
        }
        continue
      }
      if (code === 0x1b) {
        index += 2
        continue
      }
      const character = chunk[index] ?? ''
      index += 1
      if (character === '\n') {
        this.y = Math.min(this.height - 1, this.y + 1)
        this.x = 0
        continue
      }
      if (character === '\r') {
        this.x = 0
        continue
      }
      if (character.charCodeAt(0) >= 0x20) {
        const row = this.rows[this.y]
        if (row !== undefined) row[this.x] = character
        this.x += 1
        if (this.x >= this.columns) {
          this.x = 0
          this.y = Math.min(this.height - 1, this.y + 1)
        }
      }
    }
  }

  /** Visible rows, trimmed of trailing spaces. */
  lines(): string[] {
    return this.rows.map(row => row.join('').replace(/\s+$/, ''))
  }
}

/** 1-based row of the composer input line in the last frame. */
function composerInputRow(lines: string[]): number {
  const index = lines.findIndex(line => line.trimStart().startsWith('›'))
  if (index === -1) throw new Error(`composer input row not found in ${JSON.stringify(lines.slice(-12))}`)
  return index + 1
}

interface Mounted {
  store: TuiStore
  capture: Capture
  stdin: ReturnType<typeof fakeStdin>
  unmount: () => void
  /** Write input, then settle React effects and Ink's frame write. */
  type(text: string): Promise<void>
}

function fakeStdin(): PassThrough & { isTTY: boolean; setRawMode(mode: boolean): unknown; ref(): void; unref(): void } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode(mode: boolean): unknown
    ref(): void
    unref(): void
  }
  stream.isTTY = true
  stream.setRawMode = (mode: boolean) => mode
  stream.ref = () => {}
  stream.unref = () => {}
  return stream
}

async function mount(nodes: readonly TuiNode[] = [], hostOverrides: Partial<TuiHost> = {}): Promise<Mounted> {
  const capture = new Capture()
  const foldStats = {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, stepsWithTtft: 0, decodeMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    contextWindow: 0,
  }
  const store = createTuiStore({
    version: 0,
    nodes,
    trace: [],
    todos: [],
    stats: foldStats,
    live: null,
    busy: false,
    model: 'deepseek-v4-pro',
    sessionId: 'session-abc12345',
    cwd: 'D:\\work',
    pendingApproval: null,
    pendingQuestion: null,
    commands: [],
    models: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }],
    sessions: [],
    queued: [],
    settings: {
      general: { busyEnter: 'queue', thinking: 'collapsed', theme: 'dark', locale: 'zh' },
      models: { providers: [{ provider: 'deepseek-official', models: [{ id: 'deepseek-v4-pro' }] }], credentials: [] },
      plugins: [],
      configs: {},
      inventory: { namespaces: [], credentials: [], inspectProviders: 0 },
      presets: [],
      currentPreset: undefined,
    },
    jobs: [],
    subagents: [],
    workflows: [],
    feedback: new Map(),
    plan: { active: false, pending: false },
    goal: null,
    reasoning: { effort: undefined, levels: [] },
    attachmentCount: 0,
    compaction: false,
    sandbox: 'read-only',
    occupancy: null,
  })
  const host: TuiHost = {
    submit: () => {},
    cancel: () => {},
    exit: () => {},
    newSession: () => {},
    selectModel: () => {},
    setEffort: () => {},
    cycleSandbox: () => 'read-only',
    approve: () => {},
    answerQuestion: () => {},
    updateSetting: () => Promise.resolve(),
    setCredential: () => Promise.resolve(),
    unsetCredential: () => Promise.resolve(),
    refreshPanels: () => {},
    refreshSettings: () => {},
    killJob: () => {},
    rateMessage: () => Promise.resolve(null),
    resumeSession: () => Promise.resolve(null),
    switchPreset: () => Promise.resolve(null),
    updatePluginConfig: () => Promise.resolve(null),
    renameSession: () => Promise.resolve(null),
    changeWorkspace: () => Promise.resolve(null),
    attachFile: () => Promise.resolve(null),
    forkSession: () => Promise.resolve(null),
    ...hostOverrides,
  }
  const stdin = fakeStdin()
  const instance = render(
    createElement(App, { store, host }),
    { exitOnCtrlC: false, patchConsole: false, alternateScreen: true, interactive: true, stdout: capture as never, stdin: stdin as never },
  )
  // Ink 7 probes the kitty keyboard protocol for the first ~200ms after
  // mount (a 'data' listener swallows input during that window); settle past
  // it before driving keys, exactly like a real user's first keystroke.
  const settle = async (): Promise<void> => { await new Promise<void>(resolve => setTimeout(resolve, 320)) }
  await settle()
  return { store, capture, stdin, unmount: () => instance.unmount(), type: async (text) => { stdin.write(text); await settle() } }
}

describe('Ink 7 full-screen render', () => {
  it('fills the terminal exactly and anchors the caret through Ink’s own cursor suffix', async () => {
    const { capture, unmount, type } = await mount()
    try {
      const lines = lastFrameLines(capture.output)
      expect(frameRows(lines)).toBe(ROWS)
      // The first-load whale banner: braille pixel art + the block title.
      expect(lines.some(line => line.includes('░▒▓▓████'))).toBe(true) // whale art (single-cell blocks only)
      expect(lines.some(line => line.includes('███'))).toBe(true) // 3D block title
      expect(lines.some(line => line.includes('session session-abc12345'))).toBe(true) // full session id in the header
      // Full blocks in ordinary chrome remain ordinary text. Only the private
      // scrollbar marker may ask patched Ink to emit right-edge CHA.
      expect(capture.output).not.toContain('\x1b[99G')
      // A fullscreen frame writes no trailing newline, so its cursor suffix
      // starts from the actual last output row and targets the zero-based
      // measureElement row directly.
      const suffix = lastCursorSuffix(capture.output)
      const inputRow = composerInputRow(lines)
      expect(frameRows(lines) - 1 - suffix.moveUp).toBe(inputRow - 1)
      // ansi-escapes' cursorTo is 1-based (it emits x + 1): the caret at
      // 0-based column 3 (after the '› ' prompt) renders as column 4.
      expect(suffix.column).toBe(4)
      // Typing moves the caret with the text (after 'ab': 0-based 5 → 6).
      await type('ab')
      const typed = lastCursorSuffix(capture.output)
      expect(typed.column).toBe(6)
      expect(capture.terminal.buffer.active.cursorY).toBe(composerInputRow(capture.screenLines()) - 1)
    } finally {
      unmount()
    }
  })

  it('keeps the terminal cursor on the composer row through repeated edits and resize', async () => {
    const mounted = await mount()
    const assertCaretRow = (caretLine = 0): void => {
      const screenLines = mounted.capture.screenLines()
      expect(mounted.capture.terminal.buffer.active.type).toBe('alternate')
      expect(mounted.capture.terminal.buffer.active.cursorY).toBe(composerInputRow(screenLines) - 1 + caretLine)
    }
    try {
      assertCaretRow()
      for (const input of [
        ...Array.from({ length: 20 }, () => ' '),
        ...Array.from('ascii'),
        ...Array.from(' mix ed '),
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
        await mounted.type(input)
        assertCaretRow()
      }

      // One chunk exercises rapid input and forces a multi-row composer.
      const draftBeforeRapid = `${' '.repeat(20)}ascii mix ed中文😀⚙`
      const rapid = 'rapid '.repeat(30)
      const rapidDraft = `${draftBeforeRapid}${rapid}`
      mounted.stdin.write(rapid)
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      assertCaretRow(selectComposerLayout(rapidDraft, rapidDraft.length, selectTerminalFrameWidth(COLUMNS) - 4, 5).caretLine)

      mounted.capture.columns = 80
      mounted.capture.rows = 24
      mounted.capture.emit('resize')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      assertCaretRow(selectComposerLayout(rapidDraft, rapidDraft.length, selectTerminalFrameWidth(80) - 4, 5).caretLine)
      await mounted.type(' after resize')
      const resizedDraft = `${rapidDraft} after resize`
      assertCaretRow(selectComposerLayout(resizedDraft, resizedDraft.length, selectTerminalFrameWidth(80) - 4, 5).caretLine)
    } finally {
      mounted.unmount()
    }
  }, 60_000)

  it('shows the slash picker and dismisses it with Escape', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('/')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      await type('\x1b')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('opens and filters the slash picker without re-lexing settled history', async () => {
    const lexer = vi.spyOn(marked, 'lexer')
    const nodes: TuiNode[] = Array.from({ length: 120 }, (_, index) => ({
      kind: 'assistant', id: index, messageId: `message-${index}`, text: `**history ${index}** with 中文 😀 ⚙`,
    }))
    const mounted = await mount(nodes)
    try {
      const afterMount = lexer.mock.calls.length
      expect(afterMount).toBe(nodes.length)
      await mounted.type('/')
      expect(lexer.mock.calls.length).toBe(afterMount)
      // `/h` reduces the palette from its capped height to one match. The
      // transcript viewport changes height, but settled Markdown stays cached.
      await mounted.type('h')
      expect(lexer.mock.calls.length).toBe(afterMount)
    } finally {
      mounted.unmount()
      lexer.mockRestore()
    }
  })

  it('keeps the picker open while a turn streams and moves with arrow keys', async () => {
    const { store, capture, unmount, type } = await mount()
    try {
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, busy: true, live: { text: '正在流式回答', think: '思考中', thinkSince: Date.now() } })
      await type('/')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      // The palette lists commands ALPHABETICALLY (a→z), so the selection
      // starts on /attach; /help is still listed.
      expect(lines.some(line => line.includes('▸ /attach'))).toBe(true)
      expect(lines.some(line => line.includes('/help'))).toBe(true)
      await type('\x1b[B')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      expect(lines.some(line => line.includes('▸ /clear'))).toBe(true)
      expect(lines.some(line => line.includes('▸ /attach'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('survives a split arrow sequence: a flushed lone ESC must not wipe the draft or the picker', async () => {
    const { capture, unmount, stdin } = await mount()
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      stdin.write('/')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      // The ESC head of a split `\x1b[B` arrives alone (Ink flushes pending
      // escapes after 20ms); the tail lands later, inside the 60ms confirm
      // window. The phantom ESC must neither clear the draft nor dismiss the
      // picker, and the tail must act as a down-arrow.
      stdin.write('\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 40))
      stdin.write('[B')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      expect(lines.some(line => line.includes('▸ /clear'))).toBe(true)
      expect(lines.some(line => line.includes('› /'))).toBe(true)
      // No stray CSI tail leaked into the composer as text.
      expect(lines.some(line => line.includes('[B'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('scrolls the transcript with wheel reports using the DamnatioX semantics', async () => {
    const nodes: TuiNode[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'user', id: index, text: `第${index}行`,
    }))
    const { capture, unmount, type } = await mount(nodes)
    try {
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
      // One wheel-up tick hides 3 lines and pins the back button.
      await type('\x1b[<64;10;5M')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(true)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(false)
      // A wheel-down tick brings the newest lines back.
      await type('\x1b[<65;10;5M')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(true)
      // PgDn keeps working as the follow-mode accelerator.
      await type('\x1b[<64;10;5M')
      await type('\x1b[6~')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('draws the right-edge scrollbar and jumps/drags through history with mouse reports', async () => {
    const nodes: TuiNode[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'user', id: index, text: `第${index}行`,
    }))
    const { capture, unmount, type } = await mount(nodes)
    try {
      // Scroll up once: the rail and the thumb appear on the right edge.
      await type('\x1b[5~')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.endsWith('█'))).toBe(true)
      const transcriptRows = capture.screenLines().slice(4).filter(line => line.trimEnd().endsWith('█'))
      expect(transcriptRows.length).toBeGreaterThan(3)
      expectScrollbarColumn(capture)
      // The gutter accepts the rail column AND the adjacent margin cell
      // (2-cell click target): a press there on the TOP row jumps to the
      // OLDEST lines.
      await type('\x1b[<0;99;5M')
      await type('\x1b[<0;99;5m')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▸ 第0行'))).toBe(true)
      // Drag (button-motion) partway down: the oldest lines leave the frame
      // while the back-to-bottom button stays pinned.
      await type('\x1b[<0;100;5M')
      await type('\x1b[<32;100;14M')
      await type('\x1b[<0;100;14m')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▸ 第0行'))).toBe(false)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(true)
      // A press on the bottom content row returns to the newest lines.
      await type('\x1b[<0;99;23M')
      await type('\x1b[<0;99;23m')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(true)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('keeps the scrollbar gutter straight when dock rows are overlong', async () => {
    const nodes: TuiNode[] = Array.from({ length: 40 }, (_, index) => ({
      // ⚙ is a width-table trap: string-width v7 (used for wrapping) counts
      // 2 cells while Ink's internal v8 counts 1. The old implementation
      // computed the rail position from v7 widths, so every row containing
      // such a glyph rendered its rail off-column. The gutter is now its own
      // Box, so no width arithmetic can shift it.
      kind: 'user', id: index, text: `第${index}行 😀 ⚙`,
    }))
    const { store, capture, unmount } = await mount(nodes)
    try {
      // A 480-cell CJK goal objective plus a long queued preview used to make
      // dock rows WIDER than the transcript: the overflow wrapped the row
      // (and with it the old in-row rail char) onto the next line, scattering
      // the scrollbar. Docks now truncate to the content width, so the frame
      // keeps its exact rows and the gutter stays one straight column even
      // with the docks visible at the tail.
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        goal: { objective: '重构目标'.repeat(120), phase: 'active', revision: 1, roundsStarted: 0, maxGoalRounds: 12, createdAt: 1, updatedAt: 1 },
        queued: [{ text: '排队任务'.repeat(100), steer: false }],
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(frameRows(lines)).toBe(ROWS)
      // Every transcript row still ends in exactly one gutter cell (rail or
      // thumb) — never wrapped text pushed into or out of the column.
      const transcriptRows = lines.slice(4, 24)
      expect(transcriptRows.every(line => line.endsWith('█'))).toBe(true)
      expect(transcriptRows.some(line => line.includes('…'))).toBe(true)
      expectScrollbarColumn(capture)

      // xterm's default Unicode provider counts 😀 differently from
      // string-width 8.2.2. The right-edge CHA emitted by patched Ink must
      // still place every rail/thumb cell in column 39 after a narrow resize.
      capture.columns = 40
      capture.rows = 18
      capture.emit('resize')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(capture.output).toContain('\x1b[39G')
      expectScrollbarColumn(capture)
    } finally {
      unmount()
    }
  })

  it('switches settings pages when the tab strip is clicked', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('/settings')
      await type('\r')
      const modelsColumn = 2 + stringWidth(settingsTabCell('常规'))
      await type(`\x1b[<0;${modelsColumn};5M`)
      await type(`\x1b[<0;${modelsColumn};5m`)
      await type(`\x1b[<0;${modelsColumn};7M`)
      await type(`\x1b[<0;${modelsColumn};7m`)
      let lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行中 Enter'))).toBe(true)
      await type(`\x1b[<0;${modelsColumn};6M`)
      await type(`\x1b[<0;${modelsColumn};6m`)
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行中 Enter'))).toBe(false)
      expect(lines.some(line => line.includes('deepseek-official'))).toBe(true)
      expect(lines.some(line => line.includes('▸ deepseek-official'))).toBe(false)
      await type('\x1b[<0;4;8M')
      await type('\x1b[<0;4;8m')
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('deepseek-official'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('cycles settings tabs with Tab and keeps a search field', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('/settings')
      await type('\r')
      let lines = capture.screenLines()
      const searchAt = lines.findIndex(line => line.includes('搜索设置'))
      const tabsAt = lines.findIndex(line => line.includes('常规') && line.includes('模型'))
      expect(searchAt).toBeGreaterThanOrEqual(0)
      expect(tabsAt).toBeGreaterThan(searchAt)
      expect(lines.some(line => line.includes('Tab 切换'))).toBe(true)
      expect(lines.some(line => line.includes('运行中 Enter'))).toBe(true)
      await type('\t')
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行中 Enter'))).toBe(false)
      expect(lines.some(line => line.includes('deepseek-official'))).toBe(true)
      await type('\x1b[D')
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行中 Enter'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('opens the settings panel from the slash picker and exits with q', async () => {
    const { capture, unmount, type } = await mount()
    try {
      // A real terminal delivers text and Enter as separate stdin chunks.
      await type('/settings')
      await type('\r')
      let lines = capture.screenLines()
      expect(lines.some(line => line.includes('常规'))).toBe(true)
      expect(lines.some(line => line.includes('模型'))).toBe(true)
      expect(lines.some(line => line.includes('搜索设置'))).toBe(true)
      await type('q')
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('搜索设置'))).toBe(false)
      expect(lines.some(line => line.includes('运行中 Enter'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('refreshes the settings data whenever the settings panel opens', async () => {
    const refreshes: number[] = []
    const { unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      refreshSettings: () => { refreshes.push(1) },
    })
    try {
      await type('/settings')
      await type('\r')
      await type('q')
      await type('/settings plugins')
      await type('\r')
      expect(refreshes).toEqual([1, 1])
      await type('q')
    } finally {
      unmount()
    }
  })

  it('switches the agent preset from the settings presets page', async () => {
    const switched: string[] = []
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      switchPreset: async (id) => {
        switched.push(id)
        return null
      },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          presets: [
            { id: 'code', name: 'Coding agent', trust: 'system' },
            { id: 'minimal', name: 'Minimal', trust: 'system' },
          ],
          currentPreset: 'code',
        },
      })
      // The presets page opens directly; the CURRENT preset is marked and
      // inert, the other row carries the select action.
      await type('/presets')
      await type('\r')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('预设'))).toBe(true)
      expect(lines.some(line => line.includes('● code'))).toBe(true)
      // The current preset is inert, so the selection lands on minimal.
      await type('\r')
      expect(switched).toEqual(['minimal'])
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('已切换当前会话到预设 minimal'))).toBe(true)
      expect(lines.some(line => line.includes('预设'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('keeps the frame clean under streaming plus rapid wheel scrolling', async () => {
    const nodes: TuiNode[] = Array.from({ length: 30 }, (_, index) => ({
      kind: 'user', id: index, text: `第${index}行`,
    }))
    const { store, capture, unmount, type } = await mount(nodes)
    try {
      // Simulate a streaming turn: the live buffer grows tick by tick.
      for (let tick = 0; tick < 20; tick++) {
        const snapshot = store.getSnapshot()
        store.set({
          ...snapshot,
          version: snapshot.version + 1,
          busy: true,
          live: { text: `回答内容 ${tick}`, think: `思考内容 ${tick}\n${'x'.repeat(tick)}`, thinkSince: Date.now() - tick * 100 },
        })
        await new Promise<void>(resolve => setTimeout(resolve, 25))
      }
      // Rapid wheel scrolling in both directions without settling between —
      // real wheels emit several reports per notch, so drive many.
      for (let index = 0; index < 60; index++) void type('\x1b[<64;10;5M')
      for (let index = 0; index < 60; index++) void type('\x1b[<65;10;5M')
      // The turn ends while the user is still scrolled up.
      {
        const snapshot = store.getSnapshot()
        store.set({ ...snapshot, version: snapshot.version + 1, busy: false, live: null })
      }
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(frameRows(lines)).toBe(ROWS)
      // The live Thinking spinner appears exactly once, not once per tick.
      const thinkingRows = lines.filter(line => line.includes('Thinking'))
      expect(thinkingRows.length).toBeLessThanOrEqual(2)
      // Each transcript line appears at most once in the frame (separators
      // and blank rows are exempt — three identical '─' rules are expected).
      const seen = new Map<string, number>()
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '' || /^─+$/.test(trimmed) || trimmed === '█') continue
        const count = (seen.get(line) ?? 0) + 1
        seen.set(line, count)
        expect(count, JSON.stringify(line)).toBe(1)
      }
      // A real terminal applies the whole stream sequentially; the screen
      // emulator must show the same clean frame (this catches erase-count
      // residue that the raw last frame cannot see).
      const screen = new Screen(COLUMNS, ROWS)
      screen.apply(capture.output)
      const screenLines = screen.lines()
      expect(screenLines.filter(line => line.includes('Thinking')).length).toBeLessThanOrEqual(2)
      const screenSeen = new Map<string, number>()
      for (const line of screenLines) {
        const trimmed = line.trim()
        if (trimmed === '' || /^─+$/.test(trimmed) || trimmed === '█') continue
        const count = (screenSeen.get(line) ?? 0) + 1
        screenSeen.set(line, count)
        expect(count).toBe(1)
      }
    } finally {
      unmount()
    }
  })

  it('leaves idle Tab inert and keeps arrows/Space/text owned by the composer', async () => {
    const rates: { messageId: string; rating: 'positive' | 'negative' }[] = []
    const nodes: TuiNode[] = [
      { kind: 'user', id: 1, text: '你好' },
      { kind: 'assistant', id: 2, text: '你好！', messageId: 'a1' },
    ]
    const { capture, unmount, type } = await mount(nodes, {
      rateMessage: async (messageId, rating) => {
        rates.push({ messageId, rating })
        return null
      },
    })
    try {
      // Tab no longer enters a transcript-selection mode.
      await type('\t')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('» '))).toBe(false)
      // With no submitted input, ↑/↓ remain history navigation and do
      // not move a transcript cursor onto either message.
      await type('\x1b[A')
      await type('\x1b[B')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('» '))).toBe(false)
      // Space and ordinary keys are inserted into the composer after Tab.
      await type(' ')
      await type('g')
      await type('b')
      expect(rates).toEqual([])
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('›  gb'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('opens the sessions panel with persisted rows and resumes on Enter', async () => {
    const resumed: string[] = []
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      resumeSession: async (id) => {
        resumed.push(id)
        return null
      },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        sessions: [
          { id: 'session-live0001', model: 'deepseek-v4-pro', status: 'running' },
          { id: 'session-old0001', model: '', status: 'persisted', title: '修好所有测试', live: false, persisted: true, createdAt: 1 },
        ],
      })
      await type('/sessions')
      await type('\r')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('活动会话 / 持久化会话'))).toBe(true)
      expect(lines.some(line => line.includes('session-old0') && line.includes('修好所有测试'))).toBe(true)
      // ↓ onto the persisted row (row 2: head + live row above it), Enter resumes.
      await type('\x1b[B')
      await type('\x1b[B')
      await type('\r')
      expect(resumed).toEqual(['session-old0001'])
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('已恢复会话 session-old0001'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('filters the sessions panel by the /sessions query argument', async () => {
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        sessions: [
          { id: 'session-aaa00001', model: '', status: 'persisted', title: '重构计划', live: false, persisted: true, createdAt: 1 },
          { id: 'session-bbb00002', model: '', status: 'persisted', title: '修 bug', live: false, persisted: true, createdAt: 2 },
        ],
      })
      await type('/sessions 重构')
      await type('\r')
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('过滤 "重构"'))).toBe(true)
      expect(lines.some(line => line.includes('session-aaa0'))).toBe(true)
      expect(lines.some(line => line.includes('session-bbb0'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('opens the startup sessions panel on mount with an optional filter', async () => {
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      startup: { panel: { kind: 'sessions', filter: '重构' } },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        sessions: [
          { id: 'session-aaa00001', model: '', status: 'persisted', title: '重构计划', live: false, persisted: true, createdAt: 1 },
          { id: 'session-bbb00002', model: '', status: 'persisted', title: '修 bug', live: false, persisted: true, createdAt: 2 },
        ],
      })
      // Settle Ink's next frame after the store update before asserting.
      await type('')
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('活动会话 / 持久化会话'))).toBe(true)
      expect(lines.some(line => line.includes('过滤 "重构"'))).toBe(true)
      expect(lines.some(line => line.includes('session-aaa0'))).toBe(true)
      expect(lines.some(line => line.includes('session-bbb0'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('routes /rename /workspace /attach /fork to the host and shows the attachment dock', async () => {
    const calls: string[] = []
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      renameSession: async (title) => { calls.push(`rename:${title}`); return null },
      changeWorkspace: async (path) => { calls.push(`workspace:${path}`); return null },
      attachFile: async (path) => { calls.push(`attach:${path}`); return null },
      forkSession: async () => { calls.push('fork'); return null },
    })
    try {
      await type('/rename 新标题')
      await type('\r')
      await type('/workspace D:\\tmp')
      await type('\r')
      await type('/attach pic.png')
      await type('\r')
      await type('/fork')
      await type('\r')
      expect(calls).toEqual(['rename:新标题', 'workspace:D:\\tmp', 'attach:pic.png', 'fork'])
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, attachmentCount: 2 })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('2 张图片附件'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('colors the trajectory view: model blue, tools red, user cyan', async () => {
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        trace: [
          { id: 1, text: 'turn 1 start' },
          { id: 2, text: 'user (user): hi' },
          { id: 3, text: 'tool read' },
          { id: 4, text: 'result done' },
          { id: 5, text: 'assistant (12 chars)' },
        ],
      })
      await type('/trajectory')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('· assistant'))).toBe(true)
      expect(lines.some(line => line.includes('· tool read'))).toBe(true)
      // The color mapping itself is a pure function (chalk strips ANSI codes
      // when the harness stdout is not a TTY, so the raw stream cannot see
      // them): model blue, tool activity red, user cyan, structure dim.
      expect(traceLineColor('· assistant (12 chars)')).toBe('blue')
      expect(traceLineColor('· tool read')).toBe('red')
      expect(traceLineColor('· result done')).toBe('red')
      expect(traceLineColor('· user (user): hi')).toBe('cyan')
      expect(traceLineColor('· turn 1 start')).toBeUndefined()
    } finally {
      unmount()
    }
  })

  it('draws a live compacting spinner row while a compaction runs', async () => {
    const { store, capture, unmount } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, compaction: true })
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('compacting…'))).toBe(true)
      // Settling the run removes the live row and lands the status row.
      const settled = store.getSnapshot()
      store.set({ ...settled, version: settled.version + 1, compaction: false })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const after = lastFrameLines(capture.output)
      expect(after.some(line => line.includes('compacting…'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('renders the plan indicator and the goal dock from the snapshot', async () => {
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        plan: { active: true, pending: false },
        goal: {
          objective: '修好所有测试', phase: 'active', revision: 1, roundsStarted: 0,
          maxGoalRounds: 12, createdAt: 1, updatedAt: 1,
        },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('◈ plan'))).toBe(true)
      expect(lines.some(line => line.includes('◈ goal [进行中] · round 0/12 · 修好所有测试'))).toBe(true)
      // /goal opens the full detail notice (Enter as its own chunk).
      await type('/goal')
      await type('\r')
      const notice = lastFrameLines(capture.output)
      expect(notice.some(line => line.includes('目标：修好所有测试'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('wraps an overflowing composer draft onto further lines instead of truncating', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('a'.repeat(150))
      const lines = lastFrameLines(capture.output)
      // 150 cells in a 96-cell input wrap into TWO lines; a truncated
      // single-line input could only ever render one row of ≥40 `a`s.
      expect(lines.filter(line => line.includes('a'.repeat(40))).length).toBeGreaterThanOrEqual(2)
      expect(lines.some(line => line.includes('a'.repeat(40)) && line.trimStart().startsWith('›'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('shows the reasoning effort in the status bar and the colored permission above the composer', async () => {
    const { store, capture, unmount } = await mount()
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        reasoning: { effort: 'high', levels: ['low', 'medium', 'high', 'max'] },
        sandbox: 'workspace-write',
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('effort high'))).toBe(true)
      // The permission chip lives on its own row above the composer with the
      // Shift+Tab hint — never in the status bar.
      const chip = lines.find(line => line.includes('权限 workspace write'))
      expect(chip).toBeDefined()
      expect(chip).toContain('Shift+Tab 切换')
      expect(lines.some(line => line.includes('权限 workspace write') && line.includes('Σ'))).toBe(false)
      // The mode colors are pure mappings: white / yellow / red.
      expect(permissionLabel('read-only')).toBe('read only')
      expect(permissionLabel('workspace-write')).toBe('workspace write')
      expect(permissionLabel('danger-full-access')).toBe('full access')
      expect(permissionColor('read-only')).toBe('whiteBright')
      expect(permissionColor('workspace-write')).toBe('yellowBright')
      expect(permissionColor('danger-full-access')).toBe('redBright')
    } finally {
      unmount()
    }
  })

  it('cycles the file permission on Shift+Tab (one chunk and split ESC)', async () => {
    const cycled: string[] = []
    const { capture, unmount, type, stdin } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      cycleSandbox: () => {
        cycled.push('cycle')
        return 'workspace-write'
      },
    })
    try {
      await type('\x1b[Z')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(cycled).toEqual(['cycle'])
      // The pinned permission row is the feedback; no extra "权限 →" notice.
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('权限 →'))).toBe(false)
      // The split form: ESC flushes early, the `[Z` tail lands inside the
      // arbiter window and re-synthesizes as shift+tab.
      stdin.write('\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 40))
      stdin.write('[Z')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(cycled).toEqual(['cycle', 'cycle'])
      // No CSI tail leaked into the composer as text.
      expect(lastFrameLines(capture.output).some(line => line.includes('[Z'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('routes /effort off|low|high|max to the host and rejects other values', async () => {
    const efforts: (string | undefined)[] = []
    const { capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      setEffort: (effort) => { efforts.push(effort) },
    })
    try {
      await type('/effort high')
      await type('\r')
      await type('/effort off')
      await type('\r')
      await type('/effort low')
      await type('\r')
      expect(efforts).toEqual(['high', undefined, 'low'])
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('推理等级 → low'))).toBe(true)
      await type('/effort foo')
      await type('\r')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('用法：/effort off|low|high|max'))).toBe(true)
      expect(efforts).toEqual(['high', undefined, 'low'])
    } finally {
      unmount()
    }
  })

  it('opens /effort as a four-option Claude-style selector', async () => {
    const efforts: (string | undefined)[] = []
    const { capture, unmount, type } = await mount([], {
      setEffort: (effort) => { efforts.push(effort) },
    })
    try {
      await type('/effort')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('推理力度（↑↓ 选择'))).toBe(true)
      expect(lines.some(line => line.includes('▸ off') && line.includes('当前'))).toBe(true)
      expect(lines.some(line => line.includes('low') && line.includes('低强度推理'))).toBe(true)
      expect(lines.some(line => line.includes('high') && line.includes('高强度推理'))).toBe(true)
      expect(lines.some(line => line.includes('max') && line.includes('最大强度推理'))).toBe(true)
      expect(lines.some(line => line.includes('/attach'))).toBe(false)
      await type('\x1b[B')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▸ low'))).toBe(true)
      await type('\r')
      expect(efforts).toEqual(['low'])
      expect(lastFrameLines(capture.output).some(line => line.includes('推理等级 → low'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('keeps the /sessions selection visible: the viewport follows the cursor', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `session-${String(index).padStart(4, '0')}`,
      model: '', status: 'persisted', live: false, persisted: true, createdAt: index,
    }))
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, sessions: rows })
      await type('/sessions')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      // The panel opens on session-0000. Walk 25 actionable rows down:
      // without scroll-follow the selected
      // row would sit far below the 20-row panel window and stay invisible.
      for (let press = 0; press < 25; press += 1) {
        await type('\x1b[B')
      }
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▸ ') && line.includes('session-0025'))).toBe(true)
      // Walking back up returns to the first actionable row, not the static
      // header that cannot resume anything.
      for (let press = 0; press < 25; press += 1) {
        await type('\x1b[A')
      }
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const back = lastFrameLines(capture.output)
      expect(back.some(line => line.includes('▸ ') && line.includes('session-0000'))).toBe(true)
    } finally {
      unmount()
    }
  }, 60_000)

  it('recalls the previous and next inputs with ↑/↓ like cmd/PowerShell', async () => {
    const submissions: string[] = []
    const { capture, unmount, type } = await mount([], {
      submit: (text) => { submissions.push(text) },
    })
    try {
      await type('first task')
      await type('\r')
      await type('second task')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      // ↑ recalls the newest submission into the composer.
      await type('\x1b[A')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('› second task'))).toBe(true)
      // ↑ again goes one further back.
      await type('\x1b[A')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('› first task'))).toBe(true)
      // ↓ walks forward again; past the newest it restores the empty draft.
      await type('\x1b[B')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('› second task'))).toBe(true)
      await type('\x1b[B')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('› second task'))).toBe(false)
      // The recalled line submits like any other input.
      await type('\x1b[A')
      await type('\r')
      expect(submissions).toEqual(['first task', 'second task', 'second task'])
    } finally {
      unmount()
    }
  }, 30_000)

  it('shows a floating back-to-bottom button when scrolled up and returns on click', async () => {
    const nodes: TuiNode[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'user', id: index, text: `第${index}行`,
    }))
    const { capture, unmount, type } = await mount(nodes)
    try {
      await type('\x1b[<64;10;5M')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(true)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(false)
      // The button pins to the last transcript row: 30-row terminal, 4-row
      // header, 20-row transcript → 1-based terminal row 24. A left-press
      // there returns to the newest lines.
      await type('\x1b[<0;5;24M')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('keeps the complete plugins page read-only and points to the profile patch', async () => {
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          plugins: [
            { id: 'storage', name: 'storage', enabled: true, loaded: true, namespace: 'storage' },
            { id: 'off', name: 'off', enabled: false, loaded: false },
          ],
        },
      })
      await type('/settings plugins')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('插件'))).toBe(true)
      expect(lines.some(line => line.includes('● storage · storage'))).toBe(true)
      expect(lines.some(line => line.includes('○ off · off · 未加载 · 已禁用'))).toBe(true)
      expect(lines.some(line => line.includes('让 Agent 为你修改该配置文件'))).toBe(true)
      await type('\x1b[B')
      await type('\r')
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('插件'))).toBe(true)
      expect(lines.some(line => line.includes('插件配置 · Enter 切换/编辑'))).toBe(false)
      expect(lines.some(line => line.includes('storage →'))).toBe(false)
    } finally {
      unmount()
    }
  }, 30_000)

  it('renders English chrome without Chinese fallbacks', async () => {
    const { store, capture, unmount, type } = await mount([
      { kind: 'status', id: 1, text: '└ turn 1 · LLM 10ms · 工具 20ms', error: false },
      { kind: 'status', id: 2, text: '◈ plan 模式开启', error: false },
      { kind: 'status', id: 3, text: '◆ goal update · 已完成 · shipped', error: false },
    ])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          general: { ...snapshot.settings.general, locale: 'en' },
          plugins: [
            { id: 'sessions', name: 'sessions', enabled: true, loaded: true },
            { id: 'optional', name: 'optional', enabled: false, loaded: false },
          ],
        },
      })
      await type('/')
      let screen = capture.screenLines().join('\n')
      expect(screen).toContain('commands (↑↓ select')
      expect(screen).toContain('tools 20ms')
      expect(screen).toContain('plan mode on')
      expect(screen).toContain('goal update · complete')
      expect(screen).not.toMatch(/\p{Script=Han}/u)

      await type('\x1b')
      await type('\x7f')
      await type('/settings plugins')
      await type('\r')
      screen = capture.screenLines().join('\n')
      expect(screen).toContain('Plugins')
      expect(screen).toContain('ask the Agent to update that configuration file')
      expect(screen).not.toMatch(/\p{Script=Han}/u)
    } finally {
      unmount()
    }
  }, 30_000)

  it('labels a settled Thinking row with its 0.1s-precision duration', async () => {
    const { capture, unmount } = await mount([{ kind: 'think', id: 1, text: 'reasoning here', durationMs: 3456 }])
    try {
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('✓ Thinking 3.5s ▶'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('uses any Thinking disclosure arrow as the global thinking on/off switch', async () => {
    const updates: Array<'collapsed' | 'expanded'> = []
    let liveStore: TuiStore | undefined
    const { store, capture, unmount, type } = await mount([
      { kind: 'think', id: 1, text: 'alpha reasoning', durationMs: 1_000 },
      { kind: 'think', id: 2, text: 'beta reasoning', durationMs: 2_000 },
    ], {
      updateSetting: async (patch) => {
        if (patch.thinking === undefined) return
        updates.push(patch.thinking)
        const snapshot = liveStore?.getSnapshot()
        if (snapshot?.settings === null || snapshot?.settings === undefined) return
        liveStore?.set({
          ...snapshot,
          version: snapshot.version + 1,
          settings: {
            ...snapshot.settings,
            general: { ...snapshot.settings.general, thinking: patch.thinking },
          },
        })
      },
    })
    try {
      liveStore = store
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('thinking off'))).toBe(true)
      expect(lines.filter(line => line.includes('✓ Thinking') && line.includes('▶'))).toHaveLength(2)

      await type(disclosureClick(lines, '✓ Thinking 1.0s'))
      lines = lastFrameLines(capture.output)
      expect(updates).toEqual(['expanded'])
      expect(lines.some(line => line.includes('thinking on'))).toBe(true)
      expect(lines.filter(line => line.includes('✓ Thinking') && line.includes('▼'))).toHaveLength(2)
      expect(lines.some(line => line.includes('│ alpha reasoning'))).toBe(true)
      expect(lines.some(line => line.includes('│ beta reasoning'))).toBe(true)

      // Clicking either expanded row closes every Thinking body and updates
      // the same setting/header state.
      await type(disclosureClick(lines, '✓ Thinking 2.0s'))
      lines = lastFrameLines(capture.output)
      expect(updates).toEqual(['expanded', 'collapsed'])
      expect(lines.some(line => line.includes('thinking off'))).toBe(true)
      expect(lines.filter(line => line.includes('✓ Thinking') && line.includes('▶'))).toHaveLength(2)
      expect(lines.some(line => line.includes('alpha reasoning'))).toBe(false)
      expect(lines.some(line => line.includes('beta reasoning'))).toBe(false)
    } finally {
      unmount()
    }
  }, 30_000)

  it('keeps non-Thinking disclosure arrows as direct per-node controls', async () => {
    const { capture, unmount, type } = await mount([{
      kind: 'context', id: 1, producer: 'system', text: 'context detail',
    }])
    try {
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('context detail'))).toBe(false)
      const contextHead = lines.find(line => line.includes('▶'))?.trim() ?? ''
      await type(disclosureClick(lines, contextHead.slice(0, -1).trim()))
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('context detail'))).toBe(true)
      expect(lines.some(line => line.includes('thinking off'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('wraps the expanded Thinking body at word boundaries, not mid-word', async () => {
    const { store, capture, unmount } = await mount([{
      kind: 'think', id: 1, text: `${'x'.repeat(95)} hello world`, durationMs: 1,
    }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          general: { ...snapshot.settings.general, thinking: 'expanded' },
        },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      // The word breaks only at spaces: 'hello world' stays whole on its
      // own row instead of splitting 'llo' off mid-word.
      expect(lines.some(line => line.includes('  │ hello world'))).toBe(true)
      expect(lines.some(line => line.includes('  │ llo'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('keeps every expanded Thinking body row behind its own vertical bar', async () => {
    // A spacer-less CJK body forces budget-filling hard wraps. The `  │ `
    // prefix used to be added AFTER wrapping, so each full segment made the
    // line 2 cells WIDER than the content area: Ink's measure/wrap then
    // split the row right after the prefix, leaving the vertical bar alone
    // on its row (empty rows between the body rows) — the bar vanished and
    // only text remained. The prefix now sits inside the wrap budget, so the
    // body rows stay contiguous and every row starts with its own bar.
    const { store, capture, unmount } = await mount([{
      kind: 'think', id: 1, text: `${'思'.repeat(200)} 结尾`, durationMs: 1,
    }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          general: { ...snapshot.settings.general, thinking: 'expanded' },
        },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      // Every body row carries the bar…
      const bodyRows = lines.map((line, index) => ({ line, index })).filter(entry => entry.line.includes('思'))
      expect(bodyRows.length).toBeGreaterThan(2)
      expect(bodyRows.every(entry => entry.line.includes('  │ '))).toBe(true)
      // …and the body rows are CONTIGUOUS: the split-after-prefix bug
      // interleaved an empty row after every body row.
      for (let position = 1; position < bodyRows.length; position++) {
        expect(bodyRows[position]?.index).toBe((bodyRows[position - 1]?.index ?? 0) + 1)
      }
    } finally {
      unmount()
    }
  })

  it('reflows to a shrunken terminal without rows bleeding into each other', async () => {
    const { capture, unmount, type } = await mount()
    try {
      capture.columns = 30
      capture.rows = 20
      capture.emit('resize')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture.output)
      expect(frameRows(lines)).toBe(20)
      // No rendered row may exceed the physical width — the wrap would push
      // its tail onto the next row (the overlap bug).
      for (const line of lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(30)
      }
      // The welcome panel's borders stay on one intact row each.
      expect(lines.some(line => line.trimStart().startsWith('┏') && line.trimEnd().endsWith('┓'))).toBe(true)
      expect(lines.some(line => line.trimStart().startsWith('┗') && line.trimEnd().endsWith('┛'))).toBe(true)
      // Typing '/' opens the palette; the palette must respect its height
      // budget so it can never overwrite the composer row below it, and the
      // composer row itself must show the draft.
      await type('/')
      const afterSlash = lastFrameLines(capture.output)
      const composerRows = afterSlash.filter(line => line.trimStart().startsWith('›'))
      expect(composerRows.length).toBeGreaterThan(0)
      expect(composerRows.at(-1)).toContain('/')
      // Budgeted rows: title + hint + (height - 2) items, clamped to the
      // available space above the fixed chrome.
      const fixed = 4 + 1 + 1 + 1 + 3
      const maxPalette = Math.max(0, 20 - fixed - 1)
      expect(afterSlash.filter(line => line.trimStart().startsWith('/') || line.includes('命令（')).length).toBeLessThanOrEqual(maxPalette)
    } finally {
      unmount()
    }
  })

  it('renders the Thinking row with a spinner glyph and no hue sweep', async () => {
    const { store, capture, unmount } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        busy: true,
        live: { text: '', think: '正在推理', thinkSince: Date.now() },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line) && line.includes('Thinking'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('uses the whale brand glyph except on dumb and Apple Terminal', () => {
    expect(brandGlyph({ WT_SESSION: 'x' })).toBe('🐋')
    expect(brandGlyph({ TERM: 'xterm-256color' })).toBe('🐋')
    expect(brandGlyph({})).toBe('🐋')
    expect(brandGlyph({ TERM: 'dumb' })).toBe('✦')
    expect(brandGlyph({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('✦')
    expect(stringWidth(`${brandGlyph({})} DSH-TUI`)).toBe(10)
    expect(stringWidth(`${brandGlyph({ TERM: 'dumb' })} DSH-TUI`)).toBe(9)
  })

  it('sets the whale tab title on mount and keeps the frame clean', async () => {
    const { capture, unmount } = await mount()
    try {
      expect(capture.output).toContain('\x1b]0;🐋 DeepSeek Harness\x07')
      expect(capture.output).toContain('\x1b[21t')
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('DSH-TUI'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('pads each user prompt with one blank row above and below', async () => {
    const nodes: TuiNode[] = [
      { kind: 'user', id: 1, text: 'first' },
      { kind: 'think', id: 2, text: 'notes', durationMs: 1200 },
      { kind: 'assistant', id: 3, text: 'answer', messageId: 'a1' },
      { kind: 'user', id: 4, text: 'second' },
    ]
    const { capture, unmount } = await mount(nodes)
    try {
      const lines = lastFrameLines(capture.output).map(line => line.trimEnd())
      const first = lines.findIndex(line => line.includes('▸ first'))
      const think = lines.findIndex(line => line.includes('Thinking'))
      const answer = lines.findIndex(line => line.includes('● answer') || line.includes('answer'))
      const second = lines.findIndex(line => line.includes('▸ second'))
      expect(first).toBeGreaterThan(-1)
      expect(think).toBe(first + 2)
      expect(lines[first + 1]?.trim()).toBe('')
      expect(answer).toBe(think + 1)
      expect(second).toBeGreaterThan(answer)
      expect(lines[answer + 1]?.trim()).toBe('')
      expect(lines[second - 1]?.trim()).toBe('')
    } finally {
      unmount()
    }
  })

  it('keeps one blank row between assistant markdown blocks, not before the first', async () => {
    const nodes: TuiNode[] = [
      { kind: 'user', id: 1, text: 'ask' },
      { kind: 'think', id: 2, text: 'notes', durationMs: 500 },
      { kind: 'assistant', id: 3, text: '# Title\n\nBody paragraph', messageId: 'a1' },
    ]
    const { capture, unmount } = await mount(nodes)
    try {
      const lines = lastFrameLines(capture.output).map(line => line.trimEnd())
      const think = lines.findIndex(line => line.includes('Thinking'))
      const title = lines.findIndex(line => line.includes('Title'))
      const body = lines.findIndex(line => line.includes('Body paragraph'))
      expect(title).toBe(think + 1)
      expect(lines[title + 1]?.trim()).toBe('')
      expect(body).toBe(title + 2)
    } finally {
      unmount()
    }
  })

  it('shows a star on the busy status bar instead of a static circle', async () => {
    const { store, capture, unmount } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        busy: true,
        live: { text: 'streaming', think: '', thinkSince: null },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => /[✶✸✹✺]/.test(line)), JSON.stringify(lines.slice(-8))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('scrolls back to the very first user prompt of a long session', async () => {
    // The first prompt sits UNDER the wake-time context injections and a
    // long first turn: scrolling to the top must still reach it.
    const nodes: TuiNode[] = [
      { kind: 'context', id: 0, text: 'workspace instructions', producer: 'agent-instructions' },
      { kind: 'context', id: 1, text: 'system prompt', producer: 'dsh-system-prompt' },
      { kind: 'context', id: 2, text: 'skill catalog', producer: 'skill-catalog' },
      { kind: 'user', id: 3, text: 'the very first prompt' },
      ...Array.from({ length: 60 }, (_, index) => ({
        kind: 'assistant', id: 10 + index, text: `assistant row ${index}`, messageId: `m${index}`,
      })),
    ]
    const { capture, unmount, type } = await mount(nodes)
    try {
      // Wheel up far past the maximum offset; the clamp stops at the top.
      for (let tick = 0; tick < 30; tick += 1) {
        await type('\x1b[<64;10;5M')
      }
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('▸ the very first prompt'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('enters Copy Mode with Ctrl+Y, disables mouse tracking, and Esc restores it without clearing draft', async () => {
    const { capture, unmount, type } = await mount([
      { kind: 'user', id: 1, text: 'hi' },
      { kind: 'assistant', id: 2, text: 'const value = 123', messageId: 'm2' },
    ])
    try {
      expect(capture.output).toContain('\x1b[?1000h')
      await type('keep this draft')
      await type('\x19')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(capture.output).toContain('\x1b[?1006l')
      let lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('COPY MODE'))).toBe(true)
      expect(lines.some(line => line.includes('keep this draft'))).toBe(true)
      await type('\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      const after = capture.output
      const disableAt = after.lastIndexOf('\x1b[?1006l')
      const enableAt = after.lastIndexOf('\x1b[?1000h')
      expect(enableAt).toBeGreaterThan(disableAt)
      lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('COPY MODE'))).toBe(false)
      expect(lines.some(line => line.includes('keep this draft'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('copies semantic assistant text with /copy last and does not submit a model turn', async () => {
    const submissions: string[] = []
    const { capture, unmount, type } = await mount([
      { kind: 'user', id: 1, text: 'hi' },
      { kind: 'assistant', id: 2, text: 'const value = 123\nconsole.log(value)', messageId: 'm2' },
    ], {
      submit: (text) => { submissions.push(text) },
    })
    try {
      await type('/copy last')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(submissions).toEqual([])
      const lines = lastFrameLines(capture.output)
      expect(lines.some(line => line.includes('已复制') || line.includes('Copied') || line.includes('复制失败') || line.includes('Copy failed'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)
})
