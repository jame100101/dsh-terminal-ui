import { parseKeybindings } from '../src/keybindings'
import { WHALE_ART } from '../src/welcome-banner'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
/**
 * Ground-truth render tests against the Ink 7 App: the root Box fills the
 * terminal (so Ink always takes its whole-screen clear path and interleaved
 * cursor writes can never corrupt the frame), Ink's OWN cursor suffix lands
 * on the composer caret (no manual CUP writes anywhere), wheel reports fed
 * through Ink's input stream drive the DamnatioX scroll semantics, and the
 * screen stays duplicate-free under streaming plus rapid wheel scrolling.
 */

import process from 'node:process'
import { createRequire } from 'node:module'
import { Writable, PassThrough } from 'node:stream'
import { createElement } from 'react'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { render } from 'ink'
import stringWidth from 'string-width'
import { marked } from 'marked'
import xtermHeadless from '@xterm/headless'
import {
  App, movePanelSelection, brandGlyph, permissionColor, permissionLabel, resolveTranscriptLineColor, statusActivityColor, traceLineColor,
  WELCOME_CARD_COLOR,
} from '../src/render'
import { settingsTabCell } from '../src/settings-chrome'
import { composerTextWrapWidth, selectComposerLayout, selectTerminalFrameWidth } from '../src/viewport'

/** Composer wrap budget: frame minus padding, prompt, and the wrap gutter. */
function composerWrapWidth(columns: number): number {
  return composerTextWrapWidth(selectTerminalFrameWidth(columns) - 2)
}
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

/** The painted terminal rows after every CUP/ED write, not the raw byte stream. */
function lastFrameLines(capture: Capture): string[] {
  return capture.screenLines()
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

/** True when any cell of the row containing `needle` is inverse-highlighted. */
function promptRowHasInverse(capture: Capture, needle: string): boolean {
  const buffer = capture.terminal.buffer.active
  for (let row = 0; row < capture.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row)
    if (line === undefined || !line.translateToString(true).includes(needle)) continue
    for (let column = 0; column < capture.columns; column += 1) {
      if ((line.getCell(column)?.isInverse() ?? 0) !== 0) return true
    }
  }
  return false
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
          case 'J': {
            const mode = Number.isFinite(params[0]) ? params[0] : 0
            if (mode === 2 || mode === 3) {
              for (const row of this.rows) row.fill(' ')
            } else if (mode === 0) {
              const current = this.rows[this.y]
              if (current !== undefined) {
                for (let column = this.x; column < current.length; column += 1) current[column] = ' '
              }
              for (let row = this.y + 1; row < this.rows.length; row += 1) this.rows[row]?.fill(' ')
            } else if (mode === 1) {
              for (let row = 0; row < this.y; row += 1) this.rows[row]?.fill(' ')
              const current = this.rows[this.y]
              if (current !== undefined) {
                for (let column = 0; column <= this.x && column < current.length; column += 1) current[column] = ' '
              }
            }
            break
          }
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
  const index = lines.findIndex(line => line.trimStart().startsWith('❯'))
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
    costUsd: 0,
  }
  const store = createTuiStore({
    version: SESSION_FORMAT_VERSION,
    nodes,
    trace: [],
    todos: [],
    stats: foldStats,
    live: null,
    busy: false,
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    sessionId: 'session-abc12345',
    cwd: 'D:\\work',
    pendingApproval: null,
    pendingQuestion: null,
    commands: [],
    skills: [],
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
    pendingImages: [],
    compaction: false,
    sandbox: 'read-only',
    occupancy: null,
    resumeProgress: null,
  })
  const host: TuiHost = {
    submit: () => {},
    cancel: () => {},
    exit: () => {},
    newSession: () => {},
    selectModel: () => {},
    setEffort: () => {},
    cycleSandbox: () => 'read-only',
    cancelResume: () => {},
    approve: () => {},
    answerQuestion: () => {},
    updateSetting: () => Promise.resolve(),
    setCredential: () => Promise.resolve(),
    unsetCredential: () => Promise.resolve(),
    refreshPanels: () => {},
    refreshSettings: () => {},
    togglePlugin: () => Promise.resolve({ ok: true, enabled: true }),
    killJob: () => {},
    rateMessage: () => Promise.resolve(null),
    resumeSession: () => Promise.resolve(null),
    switchPreset: () => Promise.resolve(null),
    updatePluginConfig: () => Promise.resolve(null),
    renameSession: () => Promise.resolve(null),
    changeWorkspace: () => Promise.resolve(null),
    attachFile: () => Promise.resolve({ error: null, chip: '[Image #1]' }),
    attachFiles: () => Promise.resolve({ error: null, chips: ['[Image #1]'] }),
    listSessionReferences: () => Promise.resolve([]),
    attachClipboardImage: () => Promise.resolve({ error: null, chip: '[Image #1]' }),
    syncImageChips: (_previous, next) => next,
    forkSession: () => Promise.resolve(null),
    ...hostOverrides,
  }
  const stdin = fakeStdin()
  const instance = render(
    createElement(App, { store, host }),
    {
      exitOnCtrlC: false,
      patchConsole: false,
      alternateScreen: true,
      interactive: true,
      incrementalRendering: true,
      windowsFullscreenDiff: true,
      coalesceBackpressuredFrames: true,
      stdout: capture as never,
      stdin: stdin as never,
    },
  )
  // Timers alone do not guarantee a React commit or xterm write completion
  // under concurrent test load. Flush Ink's pending work before inspecting
  // the screen or sending the next key (including draft resource effects).
  const settle = async (): Promise<void> => {
    await new Promise<void>(resolve => setTimeout(resolve, 320))
    await instance.waitUntilRenderFlush()
  }
  await settle()
  return { store, capture, stdin, unmount: () => instance.unmount(), type: async (text) => { stdin.write(text); await settle() } }
}

describe('Claude terminal appearance frame', () => {
  it('paints a readable light surface and restores dark without changing the draft', async () => {
    const require = createRequire(import.meta.url)
    const chalk = (await import(require.resolve('chalk', { paths: [require.resolve('ink')] }))).default
    const previous = chalk.level; chalk.level = 3
    const { capture, store, type, unmount } = await mount()
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-light' } } })
      await type('light draft')
      expect(capture.terminal.buffer.active.getLine(5)?.getCell(20)?.getBgColor()).toBe(0xfafafa)
      expect(capture.terminal.buffer.active.getLine(1)?.getCell(0)?.getFgColor()).toBe(0x222222)
      const composerRow = capture.screenLines().findIndex(line => line.includes('❯ light draft'))
      expect(composerRow).toBeGreaterThan(0)
      expect(capture.terminal.buffer.active.getLine(composerRow)?.getCell(2)?.getFgColor()).toBe(0x222222)
      const latest = store.getSnapshot()
      store.set({ ...latest, version: latest.version + 1, settings: { ...latest.settings!, general: { ...latest.settings!.general, appearance: 'claude-terminal-dark' } } })
      await type('')
      expect(capture.screenLines().join('\n')).toContain('light draft')
      expect(capture.terminal.buffer.active.getLine(5)?.getCell(20)?.isBgDefault()).toBe(true)
    } finally { unmount(); chalk.level = previous }
  })

  it.each([[120, 40], [80, 24]])('keeps compact chrome and the native caret at %ix%i', async (columns, rows) => {
    const { capture, store, type, unmount } = await mount()
    try {
      capture.columns = columns; capture.rows = rows; capture.emit('resize')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark' } } })
      await type('中文🙂 draft')
      const lines = capture.screenLines()
      expect(lines[0]).toContain('DSH-TUI')
      expect(lines[1]).toContain('DeepSeek Harness')
      expect(lines[2]).toContain('D:\\work')
      expect(lines[rows - 4]).toContain('❯ 中文🙂 draft')
      expect(lines[rows - 3]).toContain('─')
      expect(lines[rows - 2]).toContain('Context:')
      expect(lines[rows - 6]).toContain('effort off')
      expect(lines[rows - 1]).not.toContain('effort')
      expect(lines[rows - 1]).toContain('Ⅱ read only on')
      expect(lines[rows - 1]).toContain('(Shift+Tab 切换)')
      expect(capture.terminal.buffer.active.cursorY).toBe(rows - 4)
      expect(capture.terminal.buffer.active.cursorX).toBe(stringWidth('❯ 中文🙂 draft'))
      expect(lines.filter(line => line.includes('中文🙂 draft'))).toHaveLength(1)
      expect(lines.every(line => stringWidth(line) <= columns)).toBe(true)
      const changed = store.getSnapshot()
      store.set({ ...changed, version: changed.version + 1, settings: { ...changed.settings!, general: { ...changed.settings!.general, appearance: 'dsh-classic' } } })
      await type('!')
      expect(capture.screenLines().join('\n')).toContain('中文🙂 draft!')
    } finally { unmount() }
  }, 15_000)
})

describe('compact welcome and thinking', () => {
  it('shows welcome only before a turn and collapses live thinking without a moving tail', async () => {
    const { store, capture, type, unmount } = await mount([])
    try {
      let current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', thinking: 'collapsed', locale: 'en' } } })
      await type('draft中文')
      expect(capture.screenLines().join('\n')).toContain('Welcome to DSH-TUI')
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: true, live: { text: '', think: 'HIDDEN_THOUGHT', thinkSince: Date.now(), renderId: 2 } })
      await type('')
      let frame = capture.screenLines().join('\n')
      expect(frame).toContain('Thinking… ▶')
      expect(frame).not.toContain('HIDDEN_THOUGHT')
      expect(frame).not.toContain('Welcome to')
      expect(frame).toContain('draft中文')
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, thinking: 'expanded' } } })
      await type('')
      frame = capture.screenLines().join('\n')
      expect(frame).toContain('Thinking… ▼')
      expect(frame).toContain('HIDDEN_THOUGHT')
    } finally { unmount() }
  })
})

describe('Claude working indicator contrast', () => {
  it('uses readable muted cells and only one live activity owner', async () => {
    const require = createRequire(import.meta.url)
    const chalk = (await import(require.resolve('chalk', { paths: [require.resolve('ink')] }))).default
    const previous = chalk.level; chalk.level = 3
    const { store, capture, type, unmount } = await mount([{ kind: 'context', id: 1, producer: 'contrast-fixture', text: 'context' }])
    try {
      let current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: true,
        settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en', thinking: 'collapsed' } },
        live: { text: '', think: 'hidden', thinkSince: Date.now(), renderId: 2 } })
      await type('')
      const lines = capture.screenLines()
      expect(lines.join('\n')).not.toContain('Catapulting…')
      expect(lines.join('\n')).not.toContain('└ Tip: Esc to interrupt')
      expect(lines.filter(line => line.includes('Esc cancel'))).toHaveLength(1)
      expect(lines.at(-2)).toContain('Context: --')
      expect(lines.at(-2)).toContain('Cache: --')
      expect(lines.at(-1)).toContain('Ⅱ read only on')
      expect(lines.join('\n')).not.toContain('/terminal-setup')
      for (const label of ['Thinking', 'context injected']) {
        const y = lines.findIndex(line => line.includes(label))
        const x = stringWidth(lines[y]!.split(label)[0]!)
        const cell = capture.terminal.buffer.active.getLine(capture.terminal.buffer.active.viewportY + y)!.getCell(x)!
        expect(cell.getFgColor()).toBe(0x999999)
        expect(cell.isDim()).toBe(0)
      }
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: false, live: null })
      await type('')
      expect(capture.screenLines().join('\n')).not.toContain('Catapulting')
      expect(capture.screenLines().join('\n')).not.toContain('Tip: Esc')
    } finally { unmount(); chalk.level = previous }
  })
})

describe('Claude composer activity row', () => {
  it.each([120, 40])('keeps activity and cancel above the composer beside effort at %i columns', async columns => {
    const cancel = vi.fn()
    const { store, capture, type, unmount } = await mount([], { cancel })
    try {
      capture.columns = columns; capture.rows = 24; capture.emit('resize')
      let current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1,
        settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en' } },
        reasoning: { effort: 'high', levels: ['high'] } })
      await type('')
      const start = capture.output.length
      for (const phase of ['awaiting', 'thinking', 'generating', 'idle']) {
        current = store.getSnapshot()
        store.set({ ...current, version: current.version + 1, busy: phase !== 'idle',
          live: phase === 'thinking' ? { text: '', think: 'thought', thinkSince: Date.now(), renderId: 2 }
            : phase === 'generating' ? { text: 'reply', think: '', thinkSince: null, renderId: 2 } : null })
        await type('')
        const lines = capture.screenLines()
        const row = composerInputRow(lines) - 1
        expect(lines[row - 2]).toContain('effort high')
        if (phase !== 'idle') {
          expect(lines[row - 2]).toContain('Esc cancel')
          if (columns === 120) expect(lines[row - 2]).toContain(phase === 'awaiting' ? 'Awaiting reply' : phase === 'thinking' ? 'Thinking' : 'Generating')
        } else expect(lines[row - 2]).not.toContain('Esc cancel')
        expect(lines.at(-1)).toContain('Ⅱ read only on')
        expect(lines.at(-1)).not.toMatch(/Thinking|Generating|Awaiting|Esc cancel/)
        expect(lines[row]?.trim()).toBe('❯')
        expect(capture.terminal.buffer.active.cursorX).toBe(2)
        expect(capture.terminal.buffer.active.cursorY).toBe(row)
      }
      expect(capture.output.slice(start)).not.toContain('\u00a0')
      expect(capture.output.slice(start)).not.toContain('\x1b[0 q')
      await type('中文🙂残留')
      await type('\x15')
      const row = composerInputRow(capture.screenLines()) - 1
      expect(capture.screenLines()[row]?.trim()).toBe('❯')
      const buffer = capture.terminal.buffer.active
      for (let x = 2; x < columns - 2; x++) {
        expect(buffer.getLine(buffer.viewportY + row)!.getCell(x)!.getChars().trim()).toBe('')
      }
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: true })
      await type('\x1b')
      expect(cancel).toHaveBeenCalledOnce()
    } finally { unmount() }
  }, 20_000)
})

describe('Claude settings geometry', () => {
  it.each([[120, 40], [80, 24]])('budgets the exclusive settings page at %ix%i', async (columns, rows) => {
    const require = createRequire(import.meta.url)
    const chalk = (await import(require.resolve('chalk', { paths: [require.resolve('ink')] }))).default
    const previousLevel = chalk.level
    chalk.level = 3 // This fixture asserts actual RGB cells, even in a non-TTY test runner.
    const updateSetting = vi.fn(async () => {})
    const { store, capture, type, unmount } = await mount([], { updateSetting, startup: { panel: { kind: 'settings' } } })
    try {
      capture.columns = columns; capture.rows = rows; capture.emit('resize')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark' } } })
      await type('')
      const lines = capture.screenLines()
      expect(lines[2]).toContain('▔')
      expect(lines[3]).toContain('常规')
      expect(capture.terminal.buffer.active.getLine(3)?.getCell(3)?.getFgColor()).toBe(0xb1b9f9)
      expect(lines[5]?.indexOf('╭')).toBe(3)
      expect(lines[5]?.indexOf('╮')).toBe(columns - 4)
      expect(lines[3]?.indexOf('常规')).toBe(3)
      expect(lines[6]).toContain('搜索设置')
      expect(lines[7]).toContain('╰')
      expect(lines[8]?.trim()).toBe('')
      expect(capture.terminal.buffer.active.cursorX).toBe(7)
      expect(capture.terminal.buffer.active.cursorY).toBe(6)
      expect(stringWidth(lines[9]!.split('当前')[0]!)).toBe(48)
      expect(lines[rows - 1]).toContain('Esc')
      expect(lines.every(line => stringWidth(line) <= columns)).toBe(true)
      await type('\x1b')
      await type('中文 draft')
      expect(capture.screenLines()[rows - 4]).toContain('中文 draft')
    } finally { unmount(); chalk.level = previousLevel }
  }, 15_000)
})

describe('Claude bottom sheets', () => {
  it.each([[120, 40], [80, 24]])('anchors model and permission sheets without changing host facts at %ix%i', async (columns, rows) => {
    const selectModel = vi.fn(async () => { throw new Error('adapter rejected route') })
    const cycleSandbox = vi.fn(() => 'read-only' as const)
    const { store, capture, type, unmount } = await mount([], { selectModel, cycleSandbox })
    try {
      capture.columns = columns; capture.rows = rows; capture.emit('resize')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', keymap: 'claude-fullscreen' } } })
      await type('中文🙂 retained')
      await type('\x13')
      await type('/model')
      await type('\r')
      let lines = capture.screenLines()
      expect(lines[rows - 15]).toContain('▔')
      expect(lines[rows - 14]).toContain('选择模型')
      expect(lines.join('\n')).toContain('deepseek-v4-pro')
      expect(lines.join('\n')).not.toContain('API 凭据')
      expect(lines[rows - 1]).toContain('Enter')
      await type('\r')
      expect(selectModel).toHaveBeenCalledWith('deepseek-official', 'deepseek-v4-pro')
      expect(capture.screenLines().join('\n')).toContain('adapter rejected route')
      expect(store.getSnapshot().model).toBe('deepseek-v4-pro')
      await type('\x1b')
      await type('/permissions')
      await type('\r')
      lines = capture.screenLines()
      expect(lines[rows - 11]).toContain('▔')
      expect(lines[rows - 10]).toContain('权限与沙箱')
      expect(lines[rows - 7]?.indexOf('╭')).toBe(3)
      expect(lines[rows - 7]?.indexOf('╮')).toBe(51)
      expect(lines[rows - 5]?.indexOf('╰')).toBe(3)
      expect(lines.join('\n')).toContain('Sandbox · read-only')
      expect(lines.join('\n')).toContain('Plan · off')
      expect(lines[rows - 1]).not.toContain('Enter')
      await type('\r')
      expect(cycleSandbox).not.toHaveBeenCalled()
      expect(store.getSnapshot().sandbox).toBe('read-only')
      await type('\x1b')
      await type('\x13')
      expect(capture.screenLines()[rows - 4]).toContain('中文🙂 retained')
      expect(capture.terminal.buffer.active.cursorX).toBe(stringWidth('❯ 中文🙂 retained'))
    } finally { unmount() }
  }, 15_000)
})

describe('settings editing and inert rows', () => {
  it('mounts a masked credential editor in compact settings and preserves the draft', async () => {
    const setCredential = vi.fn(async () => {})
    const attachClipboardImage = vi.fn(async () => ({ error: null, chip: '[Image #1]' }))
    const { store, capture, type, unmount } = await mount([], { setCredential, attachClipboardImage })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en', keymap: 'claude-fullscreen' }, models: { ...current.settings!.models, credentials: [{ ref: 'DEEPSEEK_API_KEY', configured: false, writable: true }] } } })
      await type('preserve 中文 draft'); await type('\x13')
      await type('/settings models'); await type('\r')
      await type('\x1b[B'); await type('\r')
      await type('\x1b[200~\x1b[201~')
      expect(attachClipboardImage).not.toHaveBeenCalled()
      await type('fixture-secret-not-a-real-key')
      expect(capture.screenLines().join('\n')).toContain('••••')
      expect(capture.output).not.toContain('fixture-secret-not-a-real-key')
      await type('\r')
      expect(setCredential).not.toHaveBeenCalled()
      expect(capture.screenLines().join('\n')).toContain('Press Enter again')
      await type('\r')
      expect(setCredential).toHaveBeenCalledExactlyOnceWith('DEEPSEEK_API_KEY', 'fixture-secret-not-a-real-key')
      await type('\x1b'); await type('\x13')
      expect(capture.screenLines().join('\n')).toContain('preserve 中文 draft')
    } finally { unmount() }
  }, 15_000)

  it('requires confirmation for credential removal and resets it when the value changes', async () => {
    const unsetCredential = vi.fn(async () => {})
    const setCredential = vi.fn(async () => {})
    const { store, capture, type, unmount } = await mount([], { unsetCredential, setCredential })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en' }, models: { ...current.settings!.models, credentials: [{ ref: 'DEEPSEEK_API_KEY', configured: true, writable: true }] } } })
      await type('/settings models'); await type('\r')
      await type('DEEPSEEK_API_KEY'); await type('\r'); await type('\r')
      expect(unsetCredential).not.toHaveBeenCalled()
      expect(capture.screenLines().join('\n')).toContain('remove this credential')
      await type('replacement-fixture'); await type('\r')
      expect(setCredential).not.toHaveBeenCalled()
      expect(unsetCredential).not.toHaveBeenCalled()
      expect(capture.screenLines().join('\n')).toContain('save the credential')
      await type('\x1b'); await type('\r'); await type('\r'); await type('\r')
      expect(unsetCredential).toHaveBeenCalledExactlyOnceWith('DEEPSEEK_API_KEY')
      expect(setCredential).not.toHaveBeenCalled()
    } finally { unmount() }
  }, 15_000)

  it('keeps q as searchable text in compact settings and clears it before closing', async () => {
    const { store, capture, type, unmount } = await mount([])
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en' } } })
      await type('/settings'); await type('\r'); await type('q')
      expect(capture.screenLines().join('\n')).toContain('⌕ q')
      expect(capture.terminal.buffer.active.cursorX).toBe(8)
      expect(capture.terminal.buffer.active.cursorY).toBe(6)
      await type('中文🙂'.repeat(40))
      expect(capture.terminal.buffer.active.cursorX).toBeLessThan(capture.columns - 4)
      expect(capture.terminal.buffer.active.cursorY).toBe(6)
      await type('\x1b')
      expect(capture.screenLines().join('\n')).toContain('Search settings')
      await type('\x1b')
      expect(capture.screenLines().join('\n')).not.toContain('Search settings')
    } finally { unmount() }
  })

  it('never paints selection on read-only permission facts after keyboard or mouse input', async () => {
    const { store, capture, type, unmount } = await mount([])
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark' } } })
      await type('/permissions'); await type('\r'); await type('\x1b[B')
      const row = capture.screenLines().findIndex(line => line.includes('Sandbox ·'))
      expect(row).toBeGreaterThan(0)
      await type(`\x1b[<0;7;${row + 1}M`)
      expect(capture.screenLines().some(line => line.trimStart().startsWith('▸'))).toBe(false)
    } finally { unmount() }
  })
})

describe('wrapped model actions', () => {
  it('keeps host routes stable through wrapped rows, mouse clicks and filtering', async () => {
    const selectModel = vi.fn(async () => {})
    const { store, capture, type, unmount } = await mount([], { selectModel })
    try {
      capture.columns = 80; capture.rows = 24; capture.emit('resize')
      const current = store.getSnapshot()
      const provider = 'official-provider-with-long-description-for-wrapping'
      store.set({ ...current, version: current.version + 1, provider, model: '中文👨‍👩‍👧‍👦-long-model-name-for-wrapping', settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark' }, models: { providers: [{ provider, models: Array.from({ length: 12 }, (_, i) => ({ id: i === 0 ? '中文👨‍👩‍👧‍👦-long-model-name-for-wrapping' : `model-${i}`, acceptsImage: true })) }], credentials: [] } } })
      await type('/model'); await type('\r')
      let lines = capture.screenLines()
      expect(lines.join('\n')).toContain('… +')
      expect(lines.join('\n')).toContain('中文👨‍👩‍👧‍👦')
      expect(lines.join('\n')).toContain('图片输入')
      const first = lines.findIndex(line => line.startsWith('   ') && line.includes('中文👨‍👩‍👧‍👦'))
      await type(`\x1b[<0;35;${first + 2}M`)
      expect(selectModel).toHaveBeenLastCalledWith(provider, '中文👨‍👩‍👧‍👦-long-model-name-for-wrapping')
      await type('\x1b[B'); await type('\r')
      expect(selectModel).toHaveBeenLastCalledWith(provider, 'model-1')
      await type('model-11'); await type('\r')
      expect(selectModel).toHaveBeenLastCalledWith(provider, 'model-11')
      capture.columns = 42; capture.emit('resize'); await type('')
      lines = capture.screenLines()
      expect(lines.every(line => stringWidth(line) <= 42)).toBe(true)
      await type('\x1b')
      expect(capture.screenLines().join('\n')).toContain('选择模型')
      await type('\x1b')
      expect(capture.screenLines().some(line => line.startsWith('❯'))).toBe(true)
    } finally { unmount() }
  }, 15_000)
})

describe('Claude logical line editing', () => {
  it('stashes and swaps complete Unicode drafts without submitting them', async () => {
    const submit = vi.fn()
    const { store, type, capture, unmount } = await mount([], { submit })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, keymap: 'claude-fullscreen' } } })
      await type('中文🙂 saved')
      await type('\x13')
      expect(capture.screenLines().join('\n')).not.toContain('中文🙂 saved')
      await type('second')
      await type('\x13')
      expect(capture.screenLines().join('\n')).toContain('中文🙂 saved')
      await type('\x13')
      expect(capture.screenLines().join('\n')).toContain('second')
      expect(submit).not.toHaveBeenCalled()
    } finally { unmount() }
  }, 15_000)

  it('moves Ctrl+A/E within a logical line and retains the other lines', async () => {
    const submit = vi.fn()
    const { store, type, unmount } = await mount([], { submit })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, keymap: 'claude-fullscreen' } } })
      await type('\x1b[200~first\nsecond\x1b[201~')
      await type('\x01')
      await type('A')
      await type('\x05')
      await type('Z')
      await type('\r')
      expect(submit).toHaveBeenCalledExactlyOnceWith('first\nAsecondZ', false)
    } finally { unmount() }
  }, 15_000)
})

describe('Ink 7 full-screen render', () => {
  it('fills the terminal exactly and anchors the caret through Ink’s own cursor suffix', async () => {
    const { capture, unmount, type } = await mount()
    try {
      // The reference whale is 20 rows (previously 19); reserve one more row
      // to test the complete banner and wordmark rather than its short-screen fallback.
      capture.rows = ROWS + 1
      capture.emit('resize')
      await type('')
      const lines = lastFrameLines(capture)
      expect(frameRows(lines)).toBe(ROWS + 1)
      // The first-load whale banner: fixed-canvas half-block art + compact wordmark.
      expect(lines.some(line => line.includes(WHALE_ART.find(row => row.trim().length > 10)!.trim()))).toBe(true) // whale silhouette
      expect(lines.some(line => line.includes('D E E P S E E K'))).toBe(true) // wordmark
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
      // 0-based column 2 (after the left-shifted '❯' prompt) renders as column 3.
      expect(suffix.column).toBe(3)
      // Typing moves the caret with the text (after 'ab': 0-based 4 → 5).
      await type('ab')
      const typed = lastCursorSuffix(capture.output)
      expect(typed.column).toBe(5)
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
      assertCaretRow(selectComposerLayout(rapidDraft, rapidDraft.length, composerWrapWidth(COLUMNS), 5).caretLine)

      mounted.capture.columns = 80
      mounted.capture.rows = 24
      mounted.capture.emit('resize')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      assertCaretRow(selectComposerLayout(rapidDraft, rapidDraft.length, composerWrapWidth(80), 5).caretLine)
      await mounted.type(' after resize')
      const resizedDraft = `${rapidDraft} after resize`
      assertCaretRow(selectComposerLayout(resizedDraft, resizedDraft.length, composerWrapWidth(80), 5).caretLine)
    } finally {
      mounted.unmount()
    }
  }, 60_000)

  it('does not leave overlapping chrome after shrinking the terminal', async () => {
    const nodes: TuiNode[] = [{
      kind: 'assistant',
      id: 1,
      messageId: 'message-1',
      text: Array.from({ length: 12 }, (_, index) => `代码开发：实现新功能、修复 bug、重构代码 ${index} 研究与探索`).join('\n'),
    }]
    const mounted = await mount(nodes)
    try {
      mounted.capture.columns = 40
      mounted.capture.rows = 18
      mounted.capture.emit('resize')
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      const lines = mounted.capture.screenLines()
      const hits = (needle: string): number => lines.filter(line => line.includes(needle)).length
      expect(hits('DSH-TUI')).toBe(1)
      expect(hits('Shift+Tab')).toBeLessThanOrEqual(1)
      expect(hits('权限')).toBeLessThanOrEqual(1)
      expect(hits('idle')).toBeLessThanOrEqual(1)
    } finally {
      mounted.unmount()
    }
  }, 20_000)

  it('does not duplicate chrome after a same-size CJK transcript rewrite', async () => {
    const textOf = (label: string): string =>
      Array.from({ length: 12 }, (_, index) => `${label}：实现新功能、修复 bug、重构代码 ${index} 研究与探索`).join('\n')
    const nodes: TuiNode[] = [{
      kind: 'assistant',
      id: 1,
      messageId: 'message-1',
      text: textOf('代码开发'),
    }]
    const mounted = await mount(nodes)
    try {
      const snapshot = mounted.store.getSnapshot()
      mounted.store.set({
        ...snapshot,
        version: snapshot.version + 1,
        nodes: [{ kind: 'assistant', id: 1, messageId: 'message-1', text: textOf('会话内容') }],
      })
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      const lines = mounted.capture.screenLines()
      const hits = (needle: string): number => lines.filter(line => line.includes(needle)).length
      expect(hits('DSH-TUI')).toBe(1)
      expect(hits('Shift+Tab')).toBeLessThanOrEqual(1)
      expect(hits('权限')).toBeLessThanOrEqual(1)
      expect(hits('idle')).toBeLessThanOrEqual(1)
      expect(lines.some(line => line.includes('会话内容'))).toBe(true)
      if (process.platform === 'win32') {
        expect(mounted.capture.output.includes('\u001B[1;1H\u001B[J')).toBe(true)
      }
    } finally {
      mounted.unmount()
    }
  }, 20_000)

  it('shows the slash picker and dismisses it with Escape', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('/')
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      await type('\x1b')
      lines = lastFrameLines(capture)
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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      // The palette lists commands ALPHABETICALLY (a→z), so the selection
      // starts on /attach; /help is still listed.
      expect(lines.some(line => line.includes('▸ /attach'))).toBe(true)
      expect(lines.some(line => line.includes('/help'))).toBe(true)
      await type('\x1b[B')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      expect(lines.some(line => line.includes('▸ /bg'))).toBe(true)
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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      // The ESC head of a split `\x1b[B` arrives alone (Ink flushes pending
      // escapes after 20ms); the tail lands later, inside the 60ms confirm
      // window. The phantom ESC must neither clear the draft nor dismiss the
      // picker, and the tail must act as a down-arrow.
      stdin.write('\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 40))
      stdin.write('[B')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('命令（↑↓ 选择'))).toBe(true)
      expect(lines.some(line => line.includes('▸ /bg'))).toBe(true)
      expect(lines.some(line => line.includes('❯/'))).toBe(true)
      // No stray CSI tail leaked into the composer as text.
      expect(lines.some(line => line.includes('[B'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('scrolls by native wheel events and restores follow after reverse events', async () => {
    const nodes: TuiNode[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'user', id: index, text: `第${index}行`,
    }))
    const { capture, unmount, type } = await mount(nodes)
    try {
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
      // One isolated native wheel-up tick hides 1 line and pins the back button.
      await type('\x1b[<64;10;5M')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(true)
      // One row only hides the trailing spacer; the prompt remains visible.
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(true)
      await type('\x1b[<64;10;5M')
      await type('\x1b[<64;10;5M')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(false)
      const painted = capture.screenLines()
      expect(painted.filter(line => line.includes('DSH-TUI')).length).toBe(1)
      expect(painted.filter(line => line.includes('▼ 回到底部') || line.includes('back to bottom')).length).toBe(1)
      // Three reverse events restore the three consumed rows.
      await type('\x1b[<65;10;5M')
      await type('\x1b[<65;10;5M')
      await type('\x1b[<65;10;5M')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(true)
      // PgDn keeps working as the follow-mode accelerator.
      await type('\x1b[<64;10;5M')
      await type('\x1b[6~')
      lines = lastFrameLines(capture)
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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.endsWith('█'))).toBe(true)
      const transcriptRows = capture.screenLines().slice(4).filter(line => line.trimEnd().endsWith('█'))
      expect(transcriptRows.length).toBeGreaterThan(3)
      expectScrollbarColumn(capture)
      // The gutter accepts the rail column AND the adjacent margin cell
      // (2-cell click target): a press there on the TOP row jumps to the
      // OLDEST lines.
      await type('\x1b[<0;99;5M')
      await type('\x1b[<0;99;5m')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▸ 第0行'))).toBe(true)
      // Drag (button-motion) partway down: the oldest lines leave the frame
      // while the back-to-bottom button stays pinned.
      await type('\x1b[<0;100;5M')
      await type('\x1b[<32;100;14M')
      await type('\x1b[<0;100;14m')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▸ 第0行'))).toBe(false)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(true)
      // Empty space beside the button must not abandon the history anchor.
      const buttonRow = capture.screenLines().findIndex(line => line.includes('▼ 回到底部')) + 1
      await type(`\x1b[<0;2;${buttonRow}M`)
      await type(`\x1b[<0;2;${buttonRow}m`)
      expect(lastFrameLines(capture).some(line => line.includes('▼ 回到底部'))).toBe(true)
      // Only the rendered button re-enables sticky follow mode.
      await type(`\x1b[<0;50;${buttonRow}M`)
      await type(`\x1b[<0;50;${buttonRow}m`)
      lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      expect(lines.some(line => line.includes('运行时发送行为'))).toBe(true)
      await type(`\x1b[<0;${modelsColumn};6M`)
      await type(`\x1b[<0;${modelsColumn};6m`)
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行时发送行为'))).toBe(false)
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
      expect(lines.some(line => line.includes('运行时发送行为'))).toBe(true)
      await type('\t')
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行时发送行为'))).toBe(false)
      expect(lines.some(line => line.includes('deepseek-official'))).toBe(true)
      await type('\x1b[D')
      lines = capture.screenLines()
      expect(lines.some(line => line.includes('运行时发送行为'))).toBe(true)
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
      expect(lines.some(line => line.includes('运行时发送行为'))).toBe(false)
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

  it('does not invent effort capabilities and opens the config alias', async () => {
    const setEffort = vi.fn()
    const { capture, unmount, type } = await mount([], { setEffort })
    try {
      await type('/effort high')
      await type('\r')
      expect(setEffort).not.toHaveBeenCalled()
      expect(lastFrameLines(capture).some(line => line.includes('用法：/effort off'))).toBe(true)
      await type('/config')
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('运行时发送行为'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('shows model settings as pending until host acceptance and surfaces rejection', async () => {
    let resolveChange: (() => void) | undefined
    let rejectChange: ((error: Error) => void) | undefined
    const selectModel = vi.fn(() => new Promise<void>((resolve, reject) => {
      resolveChange = resolve
      rejectChange = reject
    }))
    const { store, capture, unmount, type } = await mount([], { selectModel })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: current.settings === null ? null : {
        ...current.settings, models: { providers: [{ provider: 'fixture', models: [{ id: 'model-b' }] }], credentials: [] },
      } })
      await type('/settings models')
      await type('\r')
      await type('\r')
      await type('\r')
      expect(selectModel).toHaveBeenCalledExactlyOnceWith('fixture', 'model-b')
      expect(lastFrameLines(capture).some(line => line.includes('正在应用模型设置'))).toBe(true)
      expect(lastFrameLines(capture).some(line => line.includes('默认模型 →'))).toBe(false)
      rejectChange?.(new Error('model rejected'))
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('model rejected'))).toBe(true)
      await type('\r')
      resolveChange?.()
      await type('')
      expect(selectModel).toHaveBeenCalledTimes(2)
      expect(lastFrameLines(capture).some(line => line.includes('model-b') && line.includes('默认模型'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('opens job details before requesting an explicitly confirmed stop', async () => {
    const killJob = vi.fn()
    const { store, capture, unmount, type } = await mount([], { killJob })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, jobs: [{
        id: 'job-1', kind: 'shell', label: 'build', status: 'running', elapsedMs: 1250, detail: 'compiler output',
      }] })
      await type('/tasks')
      await type('\r')
      await type('\r')
      expect(killJob).not.toHaveBeenCalled()
      expect(lastFrameLines(capture).some(line => line.includes('宿主状态: running'))).toBe(true)
      await type('\r')
      expect(killJob).not.toHaveBeenCalled()
      expect(lastFrameLines(capture).some(line => line.includes('确认停止此任务'))).toBe(true)
      await type('\x1b')
      expect(lastFrameLines(capture).some(line => line.includes('确认停止此任务'))).toBe(false)
      await type('\r')
      await type('\r')
      expect(killJob).toHaveBeenCalledExactlyOnceWith('job-1')
      const next = store.getSnapshot()
      store.set({ ...next, version: next.version + 1, jobs: next.jobs.map(job => ({ ...job, status: 'finished' })) })
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('宿主状态: finished'))).toBe(true)
      await type('\r')
      expect(killJob).toHaveBeenCalledTimes(1)
      await type('\x1b')
      expect(lastFrameLines(capture).some(line => line.includes('Enter 查看详情'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('预设'))).toBe(true)
      expect(lines.some(line => line.includes('● code'))).toBe(true)
      // The current preset is inert, so the selection lands on minimal.
      await type('\r')
      expect(switched).toEqual(['minimal'])
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('已切换当前会话到预设 minimal'))).toBe(true)
      expect(lines.some(line => line.includes('预设'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('anchors the same history content through growth above, collapse, resize, and streaming append', async () => {
    const nodes: TuiNode[] = Array.from({ length: 70 }, (_, id) => ({ kind: 'user', id, text: `anchor-row-${id}` }))
    const { store, capture, unmount, type } = await mount(nodes)
    const firstVisible = () => lastFrameLines(capture).map(line => /anchor-row-\d+/.exec(line)?.[0]).find(Boolean)
    try {
      await type('\x1b[5~')
      await type('\x1b[5~')
      const anchor = firstVisible()
      expect(anchor).toBeDefined()
      expect(anchor).not.toBe('anchor-row-0')
      let snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1,
        nodes: [{ ...nodes[0]!, text: `anchor-row-0\n${'expanded details\n'.repeat(35)}` } as TuiNode, ...nodes.slice(1)] })
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(firstVisible()).toBe(anchor)
      snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, nodes })
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(firstVisible()).toBe(anchor)
      capture.columns = 80; capture.rows = 24; capture.emit('resize')
      await new Promise(resolve => setTimeout(resolve, 120))
      expect(firstVisible()).toBe(anchor)
      snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, busy: true,
        live: { text: 'new stream\n'.repeat(20), think: '', thinkSince: null } })
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(firstVisible()).toBe(anchor)
    } finally { unmount() }
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
      const lines = lastFrameLines(capture)
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

  it('keeps a long no-newline live Thinking tail responsive and on one row', async () => {
    const { store, capture, unmount } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      capture.columns = 30
      capture.rows = 20
      capture.emit('resize')
      let think = ''
      for (let tick = 0; tick < 20; tick += 1) {
        think += '实时推理内容'.repeat(40)
        const snapshot = store.getSnapshot()
        store.set({
          ...snapshot,
          version: snapshot.version + 1,
          busy: true,
          live: { text: '', think, thinkSince: Date.now() - tick * 100 },
        })
        await new Promise<void>(resolve => setTimeout(resolve, 10))
      }
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture)
      const tails = lines.filter(line => line.includes('│'))
      expect(frameRows(lines)).toBe(20)
      expect(tails).toHaveLength(1)
      expect(tails[0]).toContain('…')
      expect(stringWidth(tails[0] ?? '')).toBeLessThanOrEqual(30)
    } finally {
      unmount()
    }
  })

  it('keeps the live Thinking body visible when a streamed chunk ends in a newline', async () => {
    const { store, capture, unmount } = await mount([{ kind: 'user', id: 1, text: 'hi' }])
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        busy: true,
        live: { text: '', think: '换行前仍应显示\n', thinkSince: Date.now() },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('Thinking'))).toBe(true)
      expect(lines.some(line => line.includes('│') && line.includes('换行前仍应显示') && line.includes('↵'))).toBe(true)
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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('» '))).toBe(false)
      // With no submitted input, ↑/↓ remain history navigation and do
      // not move a transcript cursor onto either message.
      await type('\x1b[A')
      await type('\x1b[B')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('» '))).toBe(false)
      // Space and ordinary keys are inserted into the composer after Tab.
      await type(' ')
      await type('g')
      await type('b')
      expect(rates).toEqual([])
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯ gb'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('keeps user-invocable skills inside /skills without shadowing host commands', async () => {
    const submitted: string[] = []
    const { store, capture, unmount, type } = await mount([], {
      submit: (text) => { submitted.push(text) },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        commands: [{ name: 'compact', description: 'host compact', needsArgs: false }],
        skills: [
          {
            name: 'review-code',
            description: 'review the workspace\nwithout ever wrapping over the next palette row',
            modelInvocable: true,
          },
          { name: 'compact', description: 'must stay hidden', modelInvocable: true },
        ],
      })
      await type('/')
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('review-code'))).toBe(false)
      await type('skills')
      await type('\r')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('Skills（↑↓ 选择'))).toBe(true)
      expect(lines.filter(line => line.includes('review-code'))).toHaveLength(1)
      expect(lines.some(line => line.includes('without ever wrapping'))).toBe(true)
      expect(lines.some(line => line.includes('must stay hidden'))).toBe(false)
      await type('\r')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯/review-code'))).toBe(true)
      await type('check this')
      await type('\r')
      expect(submitted).toEqual(['/review-code check this'])
      await type('/compact')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('/compact') && line.includes('压缩'))).toBe(true)
      expect(lines.some(line => line.includes('must stay hidden'))).toBe(false)
    } finally {
      unmount()
    }
  })

  it('keeps the composer on the same terminal row while settings and session panels replace the transcript', async () => {
    const { store, capture, unmount, type } = await mount()
    try {
      const baseline = composerInputRow(capture.screenLines())
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        sessions: [{
          id: 'session-other',
          title: 'other session',
          model: 'deepseek-v4-pro',
          status: 'persisted',
          persisted: true,
          createdAt: Date.now(),
        }],
      })

      await type('/settings')
      await type('\r')
      expect(composerInputRow(capture.screenLines())).toBe(baseline)
      // A settings action adds a pinned notice row. The panel gives up one
      // list row instead of moving the permission/composer/status chrome.
      await type('\r')
      expect(composerInputRow(capture.screenLines())).toBe(baseline)
      await type('q')

      await type('/sessions')
      await type('\r')
      expect(capture.screenLines().some(line => line.includes('other session'))).toBe(true)
      expect(composerInputRow(capture.screenLines())).toBe(baseline)
      expect(frameRows(lastFrameLines(capture))).toBe(ROWS)
    } finally {
      unmount()
    }
  })

  it('completes official @session mentions after local file candidates', async () => {
    const submitted: string[] = []
    const mention = '@[Earlier work](dsh-session:InNlc3Npb24tb2xkIg)'
    const { capture, unmount, type } = await mount([], {
      submit: (text) => { submitted.push(text) },
      listSessionReferences: async query => query.startsWith('Ear')
        ? [{ label: 'Earlier work', mention, cwd: 'D:\\work' }]
        : [],
    })
    try {
      await type('@Ear')
      await type('')
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('@Earlier work') && line.includes('会话'))).toBe(true)
      await type('\t')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('Earlier work') && line.includes('dsh-session:'))).toBe(true)
      await type('\r')
      expect(submitted).toEqual([mention])
    } finally {
      unmount()
    }
  })

  it('rates the Nth-latest assistant message without transcript selection mode', async () => {
    const calls: string[] = []
    const nodes: TuiNode[] = [
      { kind: 'assistant', id: 1, text: 'older', messageId: 'old' },
      { kind: 'assistant', id: 2, text: 'newer', messageId: 'new' },
    ]
    const { unmount, type } = await mount(nodes, {
      rateMessage: async (messageId, rating) => { calls.push(`${messageId}:${rating}`); return null },
    })
    try {
      await type('/rate down 2')
      await type('\r')
      expect(calls).toEqual(['old:negative'])
    } finally {
      unmount()
    }
  })

  it('submits ask_user batches with multi-select, custom text, and explicit newlines', async () => {
    const answers: { id: string; selected: string[]; custom?: string }[][] = []
    const { store, unmount, type } = await mount([], {
      answerQuestion: (value) => { answers.push(value) },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        pendingQuestion: { questions: [
          { id: 'first', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] },
          { id: 'second', question: 'Pick many', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
          { id: 'third', question: 'Explain' },
        ] },
      })
      await type('\x1b[B')
      await type('\r')
      expect(answers).toEqual([])
      await type(' ')
      await type('\x1b[B')
      await type(' ')
      await type('custom note')
      await type('\r')
      expect(answers).toEqual([])
      await type('line one')
      await type('\x1b[13;2u')
      await type('line two')
      await type('\r')
      expect(answers).toEqual([[
        { id: 'first', selected: ['B'] },
        { id: 'second', selected: ['X', 'Y'], custom: 'custom note' },
        { id: 'third', selected: [], custom: 'line one\nline two' },
      ]])
    } finally {
      unmount()
    }
  })

  it('skips one ask_user item with Escape and continues the batch', async () => {
    const answers: { id: string; selected: string[]; custom?: string }[][] = []
    const { store, unmount, type } = await mount([], {
      answerQuestion: (value) => { answers.push(value) },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        pendingQuestion: { questions: [
          { id: 'skip', question: 'Skip me' },
          { id: 'answer', question: 'Answer me' },
        ] },
      })
      await type('\x1b')
      expect(answers).toEqual([])
      await type('kept')
      await type('\r')
      expect(answers).toEqual([[
        { id: 'skip', selected: [] },
        { id: 'answer', selected: [], custom: 'kept' },
      ]])
    } finally {
      unmount()
    }
  })

  it('attaches clipboard images with Ctrl+V and empty bracketed paste while retaining text', async () => {
    let calls = 0
    const { capture, type, unmount } = await mount([], {
      attachClipboardImage: async () => ({ error: null, chip: `[Image #${++calls}]` }),
    })
    try {
      await type('保留草稿 ')
      await type('\x16')
      expect(calls).toBe(process.platform === 'win32' ? 0 : 1)
      if (process.platform !== 'win32') expect(lastFrameLines(capture).join('\n')).toContain('[Image #1]')
      await type('\x1b[200~\x1b[201~')
      expect(calls).toBe(process.platform === 'win32' ? 1 : 2)
      expect(lastFrameLines(capture).join('\n')).toContain('保留草稿')
    } finally { unmount() }
  })

  it('admits a pasted image-file batch through one host call', async () => {
    const batches: string[][] = []
    const { capture, unmount, type } = await mount([], {
      attachFiles: async (paths) => {
        batches.push([...paths])
        return { error: null, chips: ['[Image #1]', '[Image #2]'] }
      },
    })
    try {
      await type('\x1b[200~/tmp/a.png\n/tmp/b.webp\x1b[201~')
      const lines = lastFrameLines(capture)
      expect(batches).toEqual([['/tmp/a.png', '/tmp/b.webp']])
      expect(lines.some(line => line.includes('[Image #1]') && line.includes('[Image #2]'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('keeps the session picker alive when the host rejects a resume', async () => {
    const { store, capture, unmount, type } = await mount([], {
      resumeSession: async () => { throw new Error('restore unavailable') },
    })
    try {
      store.set({ ...store.getSnapshot(), version: store.getSnapshot().version + 1, sessions: [
        { id: 'session-failed', model: '', status: 'persisted', title: 'Failed target', live: false, persisted: true },
      ] })
      await type('/sessions')
      await type('\r')
      await type('\x1b[B')
      await type('\r')
      expect(lastFrameLines(capture).join('\n')).toContain('restore unavailable')
      expect(lastFrameLines(capture).join('\n')).toContain('Failed target')
      await type('\x1b')
      await type('still editable')
      expect(lastFrameLines(capture).join('\n')).toContain('still editable')
    } finally { unmount() }
  })

  it('opens the sessions panel with persisted rows and resumes on Enter', async () => {
    const resumed: string[] = []
    const refreshes: string[] = []
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      refreshPanels: (kind) => { refreshes.push(kind) },
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
      expect(refreshes).toEqual(['sessions'])
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('活动会话 / 持久化会话'))).toBe(true)
      expect(lines.some(line => line.includes('session-old0') && line.includes('修好所有测试'))).toBe(true)
      // ↓ onto the persisted row (row 2: head + live row above it), Enter resumes.
      await type('\x1b[B')
      await type('\x1b[B')
      await type('\r')
      expect(resumed).toEqual(['session-old0001'])
      lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      attachFile: async (path) => {
        calls.push(`attach:${path}`)
        return { error: null, chip: '[Image #1]' }
      },
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('compacting…'))).toBe(true)
      // Settling the run removes the live row and lands the status row.
      const settled = store.getSnapshot()
      store.set({ ...settled, version: settled.version + 1, compaction: false })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const after = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('◈ plan'))).toBe(true)
      expect(lines.some(line => line.includes('◈ goal [进行中] · round 0/12 · 修好所有测试'))).toBe(true)
      // /goal opens the full detail notice (Enter as its own chunk).
      await type('/goal')
      await type('\r')
      const notice = lastFrameLines(capture)
      expect(notice.some(line => line.includes('目标：修好所有测试'))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('wraps an overflowing composer draft onto further lines instead of truncating', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('a'.repeat(150))
      const lines = lastFrameLines(capture)
      // 150 cells wrap onto at least two composer rows; a truncated
      // single-line input could only ever render one row of ≥40 `a`s.
      expect(lines.filter(line => line.includes('a'.repeat(40))).length).toBeGreaterThanOrEqual(2)
      expect(lines.some(line => line.includes('a'.repeat(40)) && line.trimStart().startsWith('❯'))).toBe(true)
      // Every wrap row shares the prompt-indented budget, so line 0 cannot
      // clip the last glyphs of a full wrap (those glyphs would vanish from
      // both paint and a drag copy).
      const paintedAs = lines
        .filter(line => /a{20,}/.test(line))
        .reduce((sum, line) => sum + (line.match(/a/g)?.length ?? 0), 0)
      expect(paintedAs).toBe(150)
    } finally {
      unmount()
    }
  })

  it('aligns CJK composer wrap rows and paints every source glyph once', async () => {
    const mounted = await mount()
    try {
      const draft = '复制输入不应吞字'.repeat(24)
      await mounted.type(draft)
      const lines = lastFrameLines(mounted.capture)
      const layout = selectComposerLayout(draft, draft.length, composerWrapWidth(COLUMNS), 5)
      const firstRow = composerInputRow(lines) - 1
      const composerRows = lines.slice(firstRow, firstRow + layout.visibleLines.length)
      expect(composerRows.length).toBeGreaterThan(1)
      expect(composerRows[0]?.search(/[复制输入不应吞字]/u)).toBe(
        composerRows[1]?.search(/[复制输入不应吞字]/u),
      )
      const painted = composerRows
        .map(line => line.replace(/[^复制输入不应吞字]/gu, ''))
        .join('')
      expect(painted).toBe(draft)
    } finally {
      mounted.unmount()
    }
  })

  it('keeps every composer glyph while a first-row mouse selection is painted', async () => {
    const submitted: string[] = []
    const mounted = await mount([], { submit: (text) => { submitted.push(text) } })
    try {
      const firstLine = '• 全部给出复杂度，无 tick，整树重渲染/重折叠/重 markdown，Composer 与 ChatTranscript 的 memo 被'
      const draft = `${firstLine}\n  不稳定回调/snapshot 身份击穿是最大渲染浪费点。`
      await mounted.type(draft)
      const row = composerInputRow(mounted.capture.screenLines())
      const selectedStart = firstLine.indexOf('整树')
      const selectedEnd = selectedStart + '整树'.length
      const startColumn = stringWidth(firstLine.slice(0, selectedStart))
      const endColumn = startColumn + stringWidth('整树')
      // Root padding (1) + prompt (1) + SGR's 1-based coordinate.
      await mounted.type(`\x1b[<0;${startColumn + 3};${row}M`)
      await mounted.type(`\x1b[<32;${endColumn + 2};${row}M`)
      await mounted.type(`\x1b[<0;${endColumn + 2};${row}m`)
      const layout = selectComposerLayout(draft, draft.length, composerWrapWidth(COLUMNS), 5)
      const rows = mounted.capture.screenLines().slice(row - 1, row - 1 + layout.visibleLines.length)
      expect(rows[0]).toContain(`❯${layout.visibleLines[0]}`)
      for (let index = 1; index < rows.length; index += 1) {
        expect(rows[index]).toContain(` ${layout.visibleLines[index]}`)
      }
      await mounted.type('X')
      await mounted.type('\r')
      expect(submitted).toEqual([`${draft.slice(0, selectedStart)}X${draft.slice(selectedEnd)}`])
    } finally {
      mounted.unmount()
    }
  })

  it('shows one compact token for a large paste and submits the exact retained text', async () => {
    const submissions: string[] = []
    const pasted = Array.from({ length: 628 }, (_, index) => `line-${index}`).join('\n')
    const mounted = await mount([], {
      submit: (text) => { submissions.push(text) },
    })
    try {
      await mounted.type(`\x1b[200~${pasted}\x1b[201~`)
      const lines = mounted.capture.screenLines()
      expect(lines.some(line => line.includes('[Pasted text #1 +628 lines]'))).toBe(true)
      expect(lines.some(line => line.includes('line-627'))).toBe(false)
      await mounted.type('\r')
      expect(submissions).toEqual([pasted])
    } finally {
      mounted.unmount()
    }
  }, 30_000)

  it('collapses an unbracketed CR-only session paste and reports its real line count', async () => {
    const submissions: string[] = []
    const pasted = Array.from({ length: 187 }, (_, index) => `row-${index}`).join('\r')
    const mounted = await mount([], {
      submit: (text) => { submissions.push(text) },
    })
    try {
      // Some terminal clipboard actions omit bracketed-paste markers and use
      // bare CR separators. One large stdin chunk must still use the capsule.
      await mounted.type(pasted)
      const lines = mounted.capture.screenLines()
      expect(lines.some(line => line.includes('[Pasted text #1 +187 lines]'))).toBe(true)
      expect(lines.some(line => line.includes('row-186'))).toBe(false)
      await mounted.type('\r')
      expect(submissions).toEqual([pasted.replace(/\r/gu, '\n')])
    } finally {
      mounted.unmount()
    }
  }, 30_000)

  it('shows the reasoning effort in the status bar and the colored permission above the composer', async () => {
    const { store, capture, unmount } = await mount()
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        reasoning: { effort: 'high', levels: ['low', 'medium', 'high', 'max'] },
        sandbox: 'workspace-write',
        stats: { ...snapshot.stats, costUsd: 1.308625 },
      })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('effort high'))).toBe(true)
      // The permission chip lives on its own row above the composer with the
      // Shift+Tab hint — never in the status bar.
      const chip = lines.find(line => line.includes('权限 workspace write'))
      expect(chip).toBeDefined()
      expect(chip).toContain('Shift+Tab 切换')
      expect(chip?.trimEnd().endsWith('$1.309')).toBe(true)
      expect(lines.some(line => line.includes('权限 workspace write') && line.includes('Σ'))).toBe(false)
      // The mode colors are pure mappings: white / warning gold / muted red.
      expect(permissionLabel('read-only')).toBe('read only')
      expect(permissionLabel('workspace-write')).toBe('workspace write')
      expect(permissionLabel('danger-full-access')).toBe('full access')
      expect(permissionColor('read-only')).toBe('whiteBright')
      expect(permissionColor('workspace-write')).toBe('#C9B84A')
      expect(permissionColor('danger-full-access')).toBe('#C75C67')
      expect(statusActivityColor(false)).toBe('#61D6D6')
      expect(statusActivityColor(true)).toBe('#61D6D6')
      expect(statusActivityColor(true, 'light')).toBe('#61D6D6')
      expect(resolveTranscriptLineColor({}, 'dark')).toBeUndefined()
      expect(resolveTranscriptLineColor({ color: WELCOME_CARD_COLOR, exactColor: true }, 'dark')).toBe('#A99B45')
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
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('权限 →'))).toBe(false)
      // The split form: ESC flushes early, the `[Z` tail lands inside the
      // arbiter window and re-synthesizes as shift+tab.
      stdin.write('\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 40))
      stdin.write('[Z')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(cycled).toEqual(['cycle', 'cycle'])
      // A tail after the 60ms Escape window is ordinary text. Only the
      // arbiter-confirmed split sequence retains Shift+Tab semantics.
      stdin.write('\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 100))
      stdin.write('[Z')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(cycled).toEqual(['cycle', 'cycle'])
      expect(lastFrameLines(capture).some(line => line.includes('[Z'))).toBe(true)

      // Kitty's enhanced keyboard protocol reports one physical key as a
      // press, optional repeats, and a release. Permission is a discrete
      // action: only the press may rotate it.
      await type('\x1b[9;2u')
      await type('\x1b[9;2:2u')
      await type('\x1b[9;2:3u')
      expect(cycled).toEqual(['cycle', 'cycle', 'cycle'])
      // Enter (and a CSI-Z release flushed with it) must not rotate again.
      await type('hello')
      await type('\r')
      expect(cycled).toEqual(['cycle', 'cycle', 'cycle'])
    } finally {
      unmount()
    }
  })

  it('keeps a draft local until an in-progress session replay completes', async () => {
    const submitted: string[] = []
    const mounted = await mount([], { submit: (text) => { submitted.push(text) } })
    try {
      mounted.store.set({
        ...mounted.store.getSnapshot(),
        version: mounted.store.getSnapshot().version + 1,
        resumeProgress: { done: 10, total: 100 },
      })
      await mounted.type('继续输入')
      await mounted.type('\r')
      expect(submitted).toEqual([])
      expect(lastFrameLines(mounted.capture).some(line => line.includes('继续输入'))).toBe(true)

      mounted.store.set({
        ...mounted.store.getSnapshot(),
        version: mounted.store.getSnapshot().version + 1,
        resumeProgress: null,
      })
      await mounted.type('\r')
      expect(submitted).toEqual(['继续输入'])
    } finally {
      mounted.unmount()
    }
  })

  it('routes /effort off|low|high|max to the host and rejects other values', async () => {
    const efforts: (string | undefined)[] = []
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      setEffort: (effort) => { efforts.push(effort) },
    })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, reasoning: { effort: undefined, levels: ['low', 'high', 'max'] } })
      await type('/effort high')
      await type('\r')
      await type('/effort off')
      await type('\r')
      await type('/effort low')
      await type('\r')
      expect(efforts).toEqual(['high', undefined, 'low'])
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('推理等级 → low'))).toBe(true)
      await type('/effort foo')
      await type('\r')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('用法：/effort off|low|high|max'))).toBe(true)
      expect(efforts).toEqual(['high', undefined, 'low'])
    } finally {
      unmount()
    }
  })

  it('opens /effort as a four-option Claude-style selector', async () => {
    const efforts: (string | undefined)[] = []
    const { store, capture, unmount, type } = await mount([], {
      setEffort: (effort) => { efforts.push(effort) },
    })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, reasoning: { effort: undefined, levels: ['low', 'high', 'max'] } })
      await type('/effort')
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('推理力度（↑↓ 选择'))).toBe(true)
      expect(lines.some(line => line.includes('▸ off') && line.includes('当前'))).toBe(true)
      expect(lines.some(line => line.includes('low') && line.includes('低强度推理'))).toBe(true)
      expect(lines.some(line => line.includes('high') && line.includes('高强度推理'))).toBe(true)
      expect(lines.some(line => line.includes('max') && line.includes('最大强度推理'))).toBe(true)
      expect(lines.some(line => line.includes('/attach'))).toBe(false)
      await type('\x1b[B')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▸ low'))).toBe(true)
      await type('\r')
      expect(efforts).toEqual(['low'])
      expect(lastFrameLines(capture).some(line => line.includes('推理等级 → low'))).toBe(true)
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
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▸ ') && line.includes('session-0025'))).toBe(true)
      // Walking back up returns to the first actionable row, not the static
      // header that cannot resume anything.
      for (let press = 0; press < 25; press += 1) {
        await type('\x1b[A')
      }
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      const back = lastFrameLines(capture)
      expect(back.some(line => line.includes('▸ ') && line.includes('session-0000'))).toBe(true)
    } finally {
      unmount()
    }
  }, 60_000)

  it('searches input history without sending and restores the cancelled scratch caret', async () => {
    const submitted: string[] = []
    const { capture, unmount, type } = await mount([], { submit: text => { submitted.push(text) } })
    try {
      await type('older 中文 task')
      await type('\r')
      await type('newest task')
      await type('\r')
      await type('scratch')
      await type('\x1b[D')
      await type('\x12')
      await type('中文')
      expect(lastFrameLines(capture).some(line => line.includes('历史搜索: 中文'))).toBe(true)
      await type('\x1b')
      await type('!')
      expect(lastFrameLines(capture).some(line => line.includes('❯scratc!h'))).toBe(true)
      await type('\x12')
      await type('中文')
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('❯older 中文 task'))).toBe(true)
      expect(submitted).toEqual(['older 中文 task', 'newest task'])
      await type('\x12')
      await type('no such entry')
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('没有匹配项'))).toBe(true)
      expect(submitted).toHaveLength(2)
      await type('\x1b')
      expect(lastFrameLines(capture).some(line => line.includes('❯older 中文 task'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('preserves collapsed paste resources when cancelling history search', async () => {
    const submitted: string[] = []
    const pasted = Array.from({ length: 80 }, (_, index) => `draft-${index}`).join('\n')
    const { capture, unmount, type } = await mount([], { submit: text => { submitted.push(text) } })
    try {
      await type(`\x1b[200~${pasted}\x1b[201~`)
      await type('\x12')
      await type('missing')
      await type('\x1b')
      expect(lastFrameLines(capture).some(line => line.includes('[Pasted text #1 +80 lines]'))).toBe(true)
      await type('\r')
      expect(submitted).toEqual([pasted])
    } finally { unmount() }
  }, 30_000)

  it('completes a mention at the caret without replacing the suffix', async () => {
    const mention = '@[Earlier work](dsh-session:InNlc3Npb24tb2xkIg)'
    const submitted: string[] = []
    const { capture, unmount, type } = await mount([], {
      submit: text => { submitted.push(text) },
      listSessionReferences: async query => query === 'Ear' ? [{ label: 'Earlier work', mention }] : [],
    })
    try {
      await type('prefix @Ear suffix')
      await type('\x1b[D'.repeat(7))
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('@Earlier work'))).toBe(true)
      await type('\t')
      await type('\r')
      expect(submitted).toEqual([`prefix ${mention} suffix`])
    } finally { unmount() }
  }, 30_000)

  it('discards delayed reference results after draft and session changes', async () => {
    const requests: Array<{ query: string; resolve: (matches: { label: string; mention: string }[]) => void }> = []
    const submitted: string[] = []
    const { store, capture, unmount, type } = await mount([], {
      submit: text => { submitted.push(text) },
      listSessionReferences: query => new Promise(resolve => { requests.push({ query, resolve }) }),
    })
    try {
      await type('@OldUnique')
      await type('\x01')
      await type('@NewUnique')
      const before = store.getSnapshot()
      store.set({ ...before, version: before.version + 1, sessionId: 'other-session', cwd: '/different-workspace' })
      await type('')
      const old = requests.find(request => request.query === 'OldUnique')
      const newest = requests.filter(request => request.query === 'NewUnique').at(-1)
      expect(old).toBeDefined()
      expect(newest).toBeDefined()
      newest?.resolve([{ label: 'current candidate', mention: '@[current](dsh-session:current)' }])
      await type('')
      old?.resolve([{ label: 'stale candidate', mention: '@[stale](dsh-session:stale)' }])
      for (const request of requests.filter(request => request.query === 'NewUnique' && request !== newest)) {
        request.resolve([{ label: 'old session candidate', mention: '@[old](dsh-session:old)' }])
      }
      await type('')
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('@current candidate'))).toBe(true)
      expect(lines.some(line => line.includes('@stale candidate') || line.includes('@old session candidate'))).toBe(false)
      await type('\t')
      await type('\r')
      expect(submitted).toEqual(['@[current](dsh-session:current)'])
    } finally { unmount() }
  }, 30_000)

  it('retains the draft while image admission is pending and aborts intake on session change', async () => {
    let finish: ((result: { error: string | null; chip?: string }) => void) | undefined
    let signal: AbortSignal | undefined
    const submit = vi.fn()
    const attachFile = vi.fn((_path: string, nextSignal?: AbortSignal) => {
      signal = nextSignal
      return new Promise<{ error: string | null; chip?: string }>(resolve => { finish = resolve })
    })
    const { store, type, capture, unmount } = await mount([], { submit, attachFile })
    try {
      await type('/attach /tmp/image.png')
      await type('\r')
      await type('pending draft')
      await type('\r')
      expect(submit).not.toHaveBeenCalled()
      expect(lastFrameLines(capture).some(line => line.includes('❯pending draft'))).toBe(true)
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, sessionId: 'other-session' })
      await type('')
      expect(signal?.aborted).toBe(true)
      finish?.({ error: null, chip: '[Image #1]' })
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('[Image #1]'))).toBe(false)
      await type('\r')
      expect(submit).toHaveBeenCalledExactlyOnceWith('pending draft', false)
    } finally { unmount() }
  }, 30_000)

  it('executes the undo command against the original draft rather than the command text', async () => {
    const submit = vi.fn()
    const { type, capture, unmount } = await mount([], { submit })
    try {
      await type('original')
      await type(' changed')
      await type('\x01')
      await type('/draft undo')
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('❯original') && !line.includes('changed'))).toBe(true)
      expect(submit).not.toHaveBeenCalled()
    } finally { unmount() }
  }, 30_000)

  it('restores official image refs through kill, yank and undo', async () => {
    let store: TuiStore
    const restoreDraftImages = vi.fn((resources: readonly string[]) => {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, attachmentCount: resources.length, pendingImages: resources.map((resource, index) => ({ resource, chip: `[Image #${index + 1}]`, name: resource, bytes: 1, width: 1, height: 1, mediaType: 'image/png' })) })
    })
    const mounted = await mount([], { restoreDraftImages, syncImageChips: (_before, next) => {
      if (!next.includes('[Image #')) restoreDraftImages([])
      return next
    } })
    store = mounted.store
    const { type, capture, unmount } = mounted
    try {
      restoreDraftImages(['official-image'])
      await type('with [Image #1]')
      await type('\x17')
      expect(store.getSnapshot().pendingImages).toEqual([])
      await type('\x19')
      expect(store.getSnapshot().pendingImages[0]?.resource).toBe('official-image')
      expect(lastFrameLines(capture).some(line => line.includes('❯with [Image #1]'))).toBe(true)
      await type('\x1f')
      expect(store.getSnapshot().pendingImages).toEqual([])
      await type('\x1bu')
      expect(store.getSnapshot().pendingImages[0]?.resource).toBe('official-image')
    } finally { unmount() }
  }, 30_000)

  it.each(['removed', 'extra [Image #1] [Image #2]'])('rejects external-editor image reference changes (%s)', async edited => {
    const restoreDraftImages = vi.fn()
    const editDraft = vi.fn(async () => edited)
    const { store, type, capture, unmount } = await mount([], { restoreDraftImages, editDraft })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, attachmentCount: 1, pendingImages: [{ resource: 'official-image', chip: '[Image #1]', name: 'image', bytes: 1, width: 1, height: 1, mediaType: 'image/png' }] })
      await type('original [Image #1]')
      await type('\x01')
      await type('/editor')
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('❯original [Image #1]'))).toBe(true)
      // suspendTerminal waits for the resumed frame to flush before the rejection
      // reaches setNotice. A fixed key-input delay is not that completion signal.
      await vi.waitFor(() => {
        expect(lastFrameLines(capture).some(line => line.includes('Image reference tokens changed'))).toBe(true)
      }, { timeout: 2000 })
      expect(store.getSnapshot().pendingImages[0]?.resource).toBe('official-image')
      expect(restoreDraftImages).toHaveBeenLastCalledWith(['official-image'])
    } finally { unmount() }
  }, 30_000)

  it('does not re-enable mouse reporting after exiting with an external editor pending', async () => {
    let finish: ((text: string) => void) | undefined
    const editDraft = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
    const { type, capture, unmount } = await mount([], { editDraft })
    try {
      await type('original')
      await type('\x01')
      await type('/editor')
      await type('\r')
      unmount()
      const stoppedAt = capture.output.length
      finish?.('late edit')
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(capture.output.slice(stoppedAt)).not.toContain('\x1b[?1000h')
      expect(capture.output.lastIndexOf('\x1b[?1000l')).toBeGreaterThan(capture.output.lastIndexOf('\x1b[?1000h'))
    } finally { unmount() }
  }, 30_000)

  it.each(['yank', 'redo'] as const)('supports /draft %s as an alternative to terminal shortcuts', async action => {
    const { type, capture, unmount } = await mount()
    try {
      await type('alpha beta')
      await type('\x17')
      if (action === 'redo') { await type('\x19'); await type('\x1f') }
      await type('\x01')
      await type(`/draft ${action}`)
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('❯alpha beta'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('aborts an external editor on session change and ignores its late result', async () => {
    let finish: ((text: string) => void) | undefined
    let signal: AbortSignal | undefined
    const editDraft = vi.fn((_text: string, value?: AbortSignal) => { signal = value; return new Promise<string>(resolve => { finish = resolve }) })
    const { store, type, capture, unmount } = await mount([], { editDraft })
    try {
      await type('original')
      await type('\x01')
      await type('/editor')
      await type('\r')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, sessionId: 'next-session' })
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(signal?.aborted).toBe(true)
      finish?.('STALE EXTERNAL RESULT')
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('STALE EXTERNAL RESULT'))).toBe(false)
      expect(lastFrameLines(capture).some(line => line.includes('❯original'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('supports word kill/yank and undo/redo without submitting or losing caret', async () => {
    const submit = vi.fn()
    const { type, capture, unmount } = await mount([], { submit })
    try {
      await type('alpha beta')
      await type('\x17')
      expect(lastFrameLines(capture).some(line => line.includes('❯alpha') && !line.includes('beta'))).toBe(true)
      await type('\x19')
      expect(lastFrameLines(capture).some(line => line.includes('❯alpha beta'))).toBe(true)
      await type('\x1f')
      expect(lastFrameLines(capture).some(line => line.includes('❯alpha') && !line.includes('beta'))).toBe(true)
      await type('\x1bu')
      expect(lastFrameLines(capture).some(line => line.includes('❯alpha beta'))).toBe(true)
      await type('\x1bb')
      await type('X')
      expect(lastFrameLines(capture).some(line => line.includes('❯alpha Xbeta'))).toBe(true)
      expect(submit).not.toHaveBeenCalled()
    } finally { unmount() }
  }, 30_000)

  it('restores killed long-paste resources and keeps undo isolated from settings focus', async () => {
    const pasted = Array.from({ length: 30 }, (_, index) => `payload-${index}`).join('\n')
    const submitted: string[] = []
    const { type, capture, unmount } = await mount([], { submit: text => { submitted.push(text) } })
    try {
      await type(`\x1b[200~${pasted}\x1b[201~`)
      await type('\x15')
      await type('\x19')
      expect(lastFrameLines(capture).some(line => line.includes('[Pasted text #1'))).toBe(true)
      await type('\r')
      expect(submitted).toEqual([pasted])
      await type('/settings')
      await type('\r')
      await type('\x1f')
      expect(lastFrameLines(capture).some(line => line.includes('[Pasted text #1'))).toBe(false)
    } finally { unmount() }
  }, 30_000)

  it('edits expanded draft text externally and undo restores its paste snapshot', async () => {
    const pasted = Array.from({ length: 30 }, (_, index) => `edit-${index}`).join('\n')
    const editDraft = vi.fn(async (text: string) => text + '\nedited')
    const { type, capture, unmount } = await mount([], { editDraft })
    try {
      await type(`\x1b[200~${pasted}\x1b[201~`)
      await type('\x01')
      await type('/editor')
      await type('\r')
      expect(editDraft).toHaveBeenCalledWith(pasted, expect.any(AbortSignal))
      expect(lastFrameLines(capture).some(line => line.includes('edited'))).toBe(true)
      await type('\x1f')
      expect(lastFrameLines(capture).some(line => line.includes('[Pasted text #1'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it.each(['/editor', '/ed'])('preserves the draft and restores native caret after external editor failure (%s)', async command => {
    const editDraft = vi.fn(async () => { throw new Error('editor exited with 7') })
    const { type, capture, unmount } = await mount([], { editDraft })
    try {
      await type('original draft')
      await type('\x01')
      await type(command)
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('❯original draft'))).toBe(true)
      // Error notices arrive after Ink's asynchronous terminal-resume flush.
      await vi.waitFor(() => {
        expect(lastFrameLines(capture).some(line => line.includes('editor exited with 7'))).toBe(true)
      }, { timeout: 2000 })
      expect(capture.terminal.buffer.active.cursorX).toBeGreaterThan(1)
      await type('\x1b[C')
      await type('X')
      expect(lastFrameLines(capture).some(line => line.includes('❯original draftX'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('handles empty panel rows and cycles first/last actionable rows', () => {
    expect(movePanelSelection([], 0, -1)).toBe(0)
    expect(movePanelSelection([], 0, 1)).toBe(0)
    const rows = [{ key: 'header', text: 'header' }, { key: 'a', text: 'a', action: 'toggle-thinking' as const }, { key: 'hint', text: 'hint' }, { key: 'b', text: 'b', action: 'toggle-locale' as const }]
    expect(movePanelSelection(rows, 1, -1)).toBe(3)
    expect(movePanelSelection(rows, 3, 1)).toBe(1)
  })

  it('preserves selected plugin identity when refreshed rows reorder', async () => {
    const togglePlugin = vi.fn(async () => ({ ok: true as const, enabled: false }))
    const { store, type, unmount } = await mount([], { togglePlugin })
    try {
      const plugins = [
        { id: 'selected', name: 'selected', enabled: true, loaded: true, toggleable: true },
        { id: 'other', name: 'other', enabled: true, loaded: true, toggleable: true },
      ]
      let current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, plugins } })
      await type('/settings plugins')
      await type('\r')
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, plugins: [...plugins].reverse() } })
      await type('')
      await type('\r')
      expect(togglePlugin).toHaveBeenCalledExactlyOnceWith('selected')
    } finally { unmount() }
  }, 30_000)

  it('retains a failed child message and clears only after explicit queue admission', async () => {
    const sendChild = vi.fn().mockRejectedValueOnce(new Error('child is read-only')).mockResolvedValueOnce({ messageId: 'accepted-123' })
    const { type, capture, unmount } = await mount([], { sendChild })
    try {
      await type('/send-child child-1 queue follow up')
      await type('\r')
      expect(lastFrameLines(capture).some(line => line.includes('❯/send-child child-1 queue follow up'))).toBe(true)
      await type('\r')
      expect(sendChild).toHaveBeenLastCalledWith('child-1', 'follow up', 'queue')
      expect(lastFrameLines(capture).some(line => line.includes('accepted-123'))).toBe(true)
      expect(lastFrameLines(capture).some(line => line.includes('❯/send-child'))).toBe(false)
    } finally { unmount() }
  }, 30_000)

  it('keeps expanded thinking preference through settlement and the next live step', async () => {
    const user: TuiNode = { kind: 'user', id: 1, text: 'ask' }
    const { store, type, capture, unmount } = await mount([user])
    try {
      let current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: true, settings: { ...current.settings!, general: { ...current.settings!.general, thinking: 'expanded' } }, live: { text: '', think: 'FIRST_THOUGHT\nLAST_THOUGHT', thinkSince: Date.now(), renderId: 2 } })
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('FIRST_THOUGHT'))).toBe(true)
      expect(lastFrameLines(capture).some(line => line.includes('LAST_THOUGHT'))).toBe(true)
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: false, live: null, nodes: [user, { kind: 'think', id: 5, renderId: 2, text: 'FIRST_THOUGHT\nLAST_THOUGHT', durationMs: 500 }] })
      await type('')
      expect(lastFrameLines(capture).filter(line => line.includes('FIRST_THOUGHT'))).toHaveLength(1)
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: true, live: { text: '', think: 'NEXT_FIRST\nNEXT_LAST', thinkSince: Date.now(), renderId: 6 } })
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('NEXT_FIRST'))).toBe(true)
      expect(lastFrameLines(capture).some(line => line.includes('NEXT_LAST'))).toBe(true)
      expect(store.getSnapshot().settings?.general.thinking).toBe('expanded')
    } finally { unmount() }
  }, 30_000)

  it('opens and exports full session source separately from a tool call', async () => {
    const readSessionSource = vi.fn(async (offset = 0) => ({ callId: '', status: 'complete', warnings: [], offset, nextOffset: null, totalChars: 20, text: 'FULL SESSION RECORD' }))
    const exportSessionSource = vi.fn(async () => '/tmp/full-session.txt')
    const readToolSource = vi.fn()
    const { type, capture, unmount } = await mount([], { readSessionSource, exportSessionSource, readToolSource })
    try {
      await type('/session-source')
      await type('\r')
      expect(readSessionSource).toHaveBeenCalledExactlyOnceWith(0, 8000, true)
      expect(readToolSource).not.toHaveBeenCalled()
      expect(lastFrameLines(capture).some(line => line.includes('FULL SESSION RECORD'))).toBe(true)
      await type('e')
      expect(exportSessionSource).toHaveBeenCalledOnce()
    } finally { unmount() }
  }, 30_000)

  it('keeps a live selection through settlement and clears it explicitly when its text changes', async () => {
    const require = createRequire(import.meta.url)
    const chalk = (await import(require.resolve('chalk', { paths: [require.resolve('ink')] }))).default
    const previousLevel = chalk.level
    chalk.level = 1
    const user: TuiNode = { kind: 'user', id: 1, text: 'ask' }
    const { store, type, capture, unmount } = await mount([user])
    try {
      let current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: true, live: { text: 'UNIQUE_SELECTED_ANSWER', think: '', thinkSince: null, renderId: 2 } })
      await type('')
      const row = lastFrameLines(capture).findIndex(line => line.includes('UNIQUE_SELECTED_ANSWER')) + 1
      await type(`\x1b[<0;3;${row}M`)
      await type(`\x1b[<32;15;${row}M`)
      expect(promptRowHasInverse(capture, 'UNIQUE_SELECTED_ANSWER'), JSON.stringify({ row, lines: lastFrameLines(capture), tail: capture.output.slice(-1500) })).toBe(true)
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, busy: false, live: null, nodes: [user, { kind: 'assistant', id: 8, renderId: 2, text: 'UNIQUE_SELECTED_ANSWER', messageId: 'message-8' }] })
      await type('')
      expect(lastFrameLines(capture).filter(line => line.includes('UNIQUE_SELECTED_ANSWER'))).toHaveLength(1)
      expect(promptRowHasInverse(capture, 'UNIQUE_SELECTED_ANSWER'), JSON.stringify({ row, lines: lastFrameLines(capture), tail: capture.output.slice(-1500) })).toBe(true)
      current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, nodes: [user, { kind: 'assistant', id: 8, renderId: 2, text: 'changed answer', messageId: 'message-8' }] })
      await type('')
      expect(promptRowHasInverse(capture, 'changed answer')).toBe(false)
      expect(lastFrameLines(capture).some(line => line.includes('选区已清除'))).toBe(true)
    } finally { unmount(); chalk.level = previousLevel }
  }, 30_000)

  it('closes the source viewer on session change and ignores a late page', async () => {
    let complete: ((value: { callId: string; status: string; warnings: string[]; text: string; offset: number; nextOffset: null; totalChars: number }) => void) | undefined
    const readToolSource = vi.fn(() => new Promise<{ callId: string; status: string; warnings: string[]; text: string; offset: number; nextOffset: null; totalChars: number }>(resolve => { complete = resolve }))
    const { store, type, capture, unmount } = await mount([], { readToolSource })
    try {
      await type('/source old-call')
      await type('\r')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, sessionId: 'new-session' })
      await type('')
      complete?.({ callId: 'old-call', status: 'complete', warnings: [], text: 'STALE SOURCE', offset: 0, nextOffset: null, totalChars: 12 })
      await type('new draft')
      expect(lastFrameLines(capture).some(line => line.includes('STALE SOURCE'))).toBe(false)
      expect(lastFrameLines(capture).some(line => line.includes('❯new draft'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('ignores a source export acknowledgement from the previous session', async () => {
    let complete: ((path: string) => void) | undefined
    const readSessionSource = vi.fn(async () => ({ callId: '', status: 'complete', warnings: [], text: 'old document', offset: 0, nextOffset: null, totalChars: 12 }))
    const exportSessionSource = vi.fn(() => new Promise<string>(resolve => { complete = resolve }))
    const { store, type, capture, unmount } = await mount([], { readSessionSource, exportSessionSource })
    try {
      await type('/session-source')
      await type('\r')
      await type('e')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, sessionId: 'new-session' })
      await type('')
      complete?.('/tmp/STALE-EXPORT.txt')
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('STALE-EXPORT') || line.includes('old document'))).toBe(false)
    } finally { unmount() }
  }, 30_000)

  it.each(['resolve', 'reject'] as const)('ignores a late child %s acknowledgement after switching sessions', async outcome => {
    let accept: ((value: { messageId: string }) => void) | undefined
    let reject: ((error: Error) => void) | undefined
    const sendChild = vi.fn(() => new Promise<{ messageId: string }>((resolve, fail) => { accept = resolve; reject = fail }))
    const { store, type, capture, unmount } = await mount([], { sendChild })
    try {
      await type('/send-child child queue task')
      await type('\r')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, sessionId: 'new-session' })
      await type('')
      if (outcome === 'resolve') accept?.({ messageId: 'STALE-CHILD' })
      else reject?.(new Error('STALE-CHILD'))
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('STALE-CHILD'))).toBe(false)
      expect(lastFrameLines(capture).some(line => line.includes('❯/send-child child queue task'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('pages full tool source without clipping huge lines and exports the masked source', async () => {
    let cut = 0
    const readToolSource = vi.fn(async (callId: string, offset = 0, _size?: number, fresh = false) => {
      if (fresh) cut += 1
      return ({
      callId, status: 'complete', warnings: [], offset, totalChars: 16000,
      nextOffset: offset === 0 ? 8000 : null,
      text: offset === 0 ? `SOURCE-FIRST CUT-${cut} ` + 'x'.repeat(300) : `SOURCE-LAST CUT-${cut} complete record`,
    }) })
    const exportToolSource = vi.fn(async () => '/tmp/masked-tool-source.txt')
    const { type, capture, unmount } = await mount([], { readToolSource, exportToolSource })
    try {
      await type('/source call-123')
      await type('\r')
      expect(readToolSource).toHaveBeenLastCalledWith('call-123', 0, 8000, true)
      expect(lastFrameLines(capture).some(line => line.includes('SOURCE-FIRST'))).toBe(true)
      await type('n')
      expect(readToolSource).toHaveBeenLastCalledWith('call-123', 8000, 8000, false)
      expect(lastFrameLines(capture).some(line => line.includes('SOURCE-LAST'))).toBe(true)
      await type('p')
      expect(readToolSource).toHaveBeenLastCalledWith('call-123', 0, 8000, false)
      expect(lastFrameLines(capture).some(line => line.includes('SOURCE-FIRST CUT-1'))).toBe(true)
      await type('r')
      expect(lastFrameLines(capture).some(line => line.includes('SOURCE-FIRST CUT-2'))).toBe(true)
      await type('e')
      expect(exportToolSource).toHaveBeenCalledWith('call-123')
      await type('q')
      await type('draft survives')
      expect(lastFrameLines(capture).some(line => line.includes('❯draft survives'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('restores official image identities with scratch caret and collapsed paste across multiple history entries', async () => {
    let store: TuiStore
    const admitted: string[][] = []
    const image = (resource: string) => ({ resource, chip: '[Image #1]', name: resource, bytes: 1, width: 1, height: 1, mediaType: 'image/png' })
    const restoreDraftImages = vi.fn((resources: readonly string[]) => {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, pendingImages: resources.map(image), attachmentCount: resources.length })
    })
    const mounted = await mount([], { restoreDraftImages, submit: () => {
      admitted.push(store.getSnapshot().pendingImages.map(image => image.resource!))
      restoreDraftImages([])
    } })
    store = mounted.store
    const { type, capture, unmount } = mounted
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, models: [{ ...current.models[0]!, acceptsImage: true }] })
      restoreDraftImages(['sent-image'])
      await type('first [Image #1]')
      await type('\r')
      await type('second')
      await type('\r')
      restoreDraftImages(['scratch-image'])
      await type('scratch [Image #1]')
      await type('\x1b[H')
      await type('\x1b[A')
      expect(store.getSnapshot().pendingImages).toEqual([])
      await type('\x1b[A')
      expect(store.getSnapshot().pendingImages[0]?.resource).toBe('sent-image')
      await type('\x1b[B')
      await type('\x1b[B')
      expect(store.getSnapshot().pendingImages[0]?.resource).toBe('scratch-image')
      expect(lastFrameLines(capture).some(line => line.includes('scratch [Image #1]'))).toBe(true)
      await type('\x1b[A')
      await type('\x1b[A')
      await type('\r')
      expect(admitted).toEqual([['sent-image'], [], ['sent-image']])
    } finally { unmount() }
  }, 30_000)

  it('forces a real Ctrl+L repaint and only double-clears in the explicit claude keymap', async () => {
    const newSession = vi.fn()
    const { store, type, capture, unmount } = await mount([], { newSession })
    try {
      await type('preserved draft')
      const before = capture.output.length
      await type('\x0c')
      expect(capture.output.slice(before)).toContain('preserved draft')
      await type('\x0c')
      expect(newSession).not.toHaveBeenCalled()
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, keymap: 'claude-fullscreen' } } })
      await type('')
      await type('\x0c')
      await type('\x0c')
      expect(newSession).toHaveBeenCalledTimes(1)
      expect(lastFrameLines(capture).some(line => line.includes('❯preserved draft'))).toBe(true)
      const time = vi.spyOn(Date, 'now')
      try {
        time.mockReturnValue(10_000)
        await type('\x0c')
        time.mockReturnValue(12_001)
        await type('\x0c')
        expect(newSession).toHaveBeenCalledTimes(1)
      } finally { time.mockRestore() }
      // Claude Ctrl+A moves to line start; Ctrl+K clears it without changing the redraw assertions.
      await type('\x01')
      await type('\x0b')
      await type('/clear-screen')
      await type('\r')
      expect(newSession).toHaveBeenCalledTimes(1)
      await type('/clear')
      await type('\r')
      expect(newSession).toHaveBeenCalledTimes(2)
    } finally { unmount() }
  }, 30_000)

  it('does not hide pending image attachments behind a history entry', async () => {
    const { store, capture, unmount, type } = await mount()
    try {
      await type('history')
      await type('\r')
      await type('scratch [Image #1]')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, attachmentCount: 1 })
      await type('')
      await type('\x1b[A')
      expect(lastFrameLines(capture).some(line => line.includes('❯scratch [Image #1]'))).toBe(true)
      expect(lastFrameLines(capture).some(line => line.includes('请先发送或移除图片'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('restores draft caret after an approval takeover and binds the decision to its request', async () => {
    const approve = vi.fn()
    const cycleSandbox = vi.fn(() => 'workspace-write' as const)
    const { store, capture, unmount, type } = await mount([], { approve, cycleSandbox })
    try {
      await type('keep')
      await type('\x1b[D')
      const before = store.getSnapshot()
      store.set({ ...before, version: before.version + 1, pendingApproval: {
        requestId: 'approval-1', sessionId: before.sessionId, toolName: 'shell',
      } })
      await type('')
      await type('\x1b[Z')
      expect(cycleSandbox).not.toHaveBeenCalled()
      await type('n')
      expect(approve).toHaveBeenCalledExactlyOnceWith('rejected', 'approval-1')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, pendingApproval: null })
      await type('')
      await type('X')
      expect(lastFrameLines(capture).some(line => line.includes('❯keeXp'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('restores a collapsed paste resource after browsing input history', async () => {
    const submissions: string[] = []
    const pasted = Array.from({ length: 80 }, (_, index) => `scratch-${index}`).join('\n')
    const { capture, unmount, type } = await mount([], { submit: text => { submissions.push(text) } })
    try {
      await type('previous input')
      await type('\r')
      await type(`\x1b[200~${pasted}\x1b[201~`)
      await type('\x1b[A')
      expect(lastFrameLines(capture).some(line => line.includes('❯previous input'))).toBe(true)
      await type('\x1b[B')
      expect(lastFrameLines(capture).some(line => line.includes('[Pasted text #1 +80 lines]'))).toBe(true)
      await type('\r')
      expect(submissions).toEqual(['previous input', pasted])
    } finally {
      unmount()
    }
  }, 30_000)

  it('retains rejected submissions and protects newer edits from late admission', async () => {
    let accept: (() => void) | undefined
    let reject: ((error: Error) => void) | undefined
    const submit = vi.fn(() => new Promise<void>((resolve, rejectPromise) => {
      accept = resolve
      reject = rejectPromise
    }))
    const { capture, unmount, type } = await mount([], { submit })
    try {
      await type('keep this')
      await type('\r')
      await type('\r')
      expect(submit).toHaveBeenCalledTimes(1)
      expect(lastFrameLines(capture).some(line => line.includes('❯keep this'))).toBe(true)
      reject?.(new Error('admission rejected'))
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('❯keep this'))).toBe(true)
      expect(lastFrameLines(capture).some(line => line.includes('admission rejected'))).toBe(true)
      await type('\r')
      expect(submit).toHaveBeenCalledTimes(2)
      await type(' plus new edit')
      accept?.()
      await type('')
      expect(lastFrameLines(capture).some(line => line.includes('❯keep this plus new edit'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯second task'))).toBe(true)
      // At the visual boundary, repeated ↑ continues through input history.
      await type('\x1b[A')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯second task'))).toBe(false)
      expect(lines.some(line => line.includes('❯first task'))).toBe(true)
      // Ctrl+L preserves the recalled draft and history cursor.
      await type('\x0c')
      await type('\x1b[A')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯first task'))).toBe(true)
      // ↓ walks forward again; past the newest it restores the empty draft.
      await type('\x0c')
      await type('\x1b[B')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯second task'))).toBe(true)
      await type('\x0c')
      await type('\x1b[B')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯second task'))).toBe(false)
      // The recalled line submits like any other input.
      await type('\x1b[A')
      await type('\r')
      expect(submissions).toEqual(['first task', 'second task', 'second task'])
    } finally {
      unmount()
    }
  }, 30_000)

  it.each(['legacy-dsh', 'claude-fullscreen'] as const)('moves horizontally and recalls history at the visual boundary without losing the scratch draft (%s)', async keymap => {
    const { store, capture, unmount, type } = await mount([], {
      submit: () => {},
    })
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, keymap } } })
      await type('')
      await type('hello')
      expect(lastCursorSuffix(capture.output).column).toBe(8)
      await type('\x1b[D')
      expect(lastCursorSuffix(capture.output).column).toBe(7)
      await type('\x1b[C')
      expect(lastCursorSuffix(capture.output).column).toBe(8)
      await type('\x1b[A')
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯hello'))).toBe(true)
      await type('\r')
      await type('keep')
      await type('\x1b[A')
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('❯keep'))).toBe(false)
      expect(lines.some(line => line.includes('❯hello'))).toBe(true)
      await type('\x1b[B')
      // Admission and restored caret each commit asynchronously. Wait for the
      // rendered state rather than assuming a fixed frame budget under load.
      const deadline = Date.now() + 2000
      while (!lastFrameLines(capture).some(line => line.includes('❯keep')) && Date.now() < deadline) await type('')
      expect(lastFrameLines(capture).some(line => line.includes('❯keep')), lastFrameLines(capture).join('\n')).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it.each(['legacy-dsh', 'claude-fullscreen'] as const)('moves the caret between wrapped composer rows with ↑/↓ (%s)', async keymap => {
    const { store, capture, unmount, type } = await mount()
    try {
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, settings: { ...current.settings!, general: { ...current.settings!.general, keymap } } })
      await type('')
      const draft = 'a'.repeat(150)
      await type(draft)
      const wrapWidth = composerWrapWidth(COLUMNS)
      expect(selectComposerLayout(draft, draft.length, wrapWidth, 5).caretLine).toBeGreaterThan(0)
      const endY = capture.terminal.buffer.active.cursorY
      const endColumn = lastCursorSuffix(capture.output).column
      await type('\x1b[A')
      expect(capture.terminal.buffer.active.cursorY).toBe(endY - 1)
      expect(lastCursorSuffix(capture.output).column).toBe(endColumn)
      await type('\x1b[B')
      expect(capture.terminal.buffer.active.cursorY).toBe(endY)
      expect(lastCursorSuffix(capture.output).column).toBe(endColumn)
    } finally {
      unmount()
    }
  }, 30_000)

  it('opens the @ file palette from the workspace cwd', async () => {
    const { store, capture, unmount, type } = await mount()
    try {
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, cwd: process.cwd() })
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      await type('@')
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('文件') || line.includes('files'))).toBe(true)
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
      await type('\x1b[<64;10;5M')
      await type('\x1b[<64;10;5M')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(true)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(false)
      // The button pins to the last transcript row: 30-row terminal, 4-row
      // header, 20-row transcript → 1-based terminal row 24. A left-press
      // there returns to the newest lines.
      await type('\x1b[<0;50;24M')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▼ 回到底部'))).toBe(false)
      expect(lines.some(line => line.includes('▸ 第39行'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('replaces only the slash token at the caret and preserves trailing prose', async () => {
    const submitted: string[] = []
    const { type, capture, unmount } = await mount([], { submit: text => { submitted.push(text) } })
    try {
      await type('please /modxx then continue')
      for (let index = 0; index < 16; index++) await type('\x1b[D')
      await type('\t')
      expect(lastFrameLines(capture).some(line => line.includes('please /model then continue'))).toBe(true)
      await type('\r')
      expect(submitted).toEqual(['please /model then continue'])
    } finally { unmount() }
  }, 30_000)

  it('gives an arriving approval precedence over plugin confirmation and preserves the draft', async () => {
    const updatePlugin = vi.fn()
    const approve = vi.fn()
    const { store, type, capture, unmount } = await mount([], { updatePlugin, approve })
    try {
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, settings: { ...snapshot.settings!, bundles: [
        { name: 'example-plugin', version: '1.0.0', installed: true, enabled: true, availability: 'profile' },
      ] } })
      await type('/settings plugins')
      await type('\r')
      await type('\x1b[B'); await type('\x1b[B')
      await type('\r')
      await type('2.0.0')
      await type('\r')
      const current = store.getSnapshot()
      store.set({ ...current, version: current.version + 1, pendingApproval: { requestId: 'takeover-1', sessionId: current.sessionId, toolName: 'shell' } })
      await type('')
      await type('n')
      expect(approve).toHaveBeenCalledExactlyOnceWith('rejected', 'takeover-1')
      expect(updatePlugin).not.toHaveBeenCalled()
      const after = store.getSnapshot()
      store.set({ ...after, version: after.version + 1, pendingApproval: null })
      await type('draft')
      expect(lastFrameLines(capture).some(line => line.includes('❯draft'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('requires an exact plugin version and a second confirmation before exposing pending restart', async () => {
    const updatePlugin = vi.fn(async (name: string, requestedVersion: string) => ({
      name, requestedVersion, phase: 'pending-restart' as const, installedVersion: requestedVersion,
      restartReason: 'native module changed', rollbackSpec: `${name}@1.0.0`, rollback: 'available' as const,
    }))
    const { store, type, capture, unmount } = await mount([], { updatePlugin })
    try {
      const snapshot = store.getSnapshot()
      store.set({ ...snapshot, version: snapshot.version + 1, settings: { ...snapshot.settings!, bundles: [
        { name: 'example-plugin', version: '1.0.0', installed: true, enabled: true, availability: 'profile' },
      ] } })
      await type('/settings plugins')
      await type('\r')
      await type('\x1b[B'); await type('\x1b[B')
      await type('\r')
      await type('2.0.0')
      await type('\r')
      expect(updatePlugin).not.toHaveBeenCalled()
      expect(lastFrameLines(capture).some(line => line.includes('确认安装'))).toBe(true)
      await type('\r')
      expect(updatePlugin).toHaveBeenCalledExactlyOnceWith('example-plugin', '2.0.0')
      expect(lastFrameLines(capture).some(line => line.includes('pending-restart'))).toBe(true)
    } finally { unmount() }
  }, 30_000)

  it('toggles plugins with Enter and reflects enabled state without leaving the panel', async () => {
    const liveStore: { current?: TuiStore } = {}
    const toggled: string[] = []
    const mounted = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      togglePlugin: async (id) => {
        toggled.push(id)
        const current = liveStore.current?.getSnapshot()
        if (current?.settings === null || current?.settings === undefined) return { ok: false, code: 'entry-unavailable' }
        const selected = current.settings.plugins.find(plugin => plugin.id === id)
        if (selected === undefined) return { ok: false, code: 'entry-unavailable' }
        const enabled = !selected.enabled
        liveStore.current?.set({
          ...current,
          version: current.version + 1,
          settings: {
            ...current.settings,
            plugins: current.settings.plugins.map(plugin => plugin.id === id
              ? { ...plugin, enabled, loaded: enabled }
              : plugin),
          },
        })
        return { ok: true, enabled }
      },
    })
    const { store, capture, unmount, type } = mounted
    liveStore.current = store
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          plugins: [
            { id: 'storage', name: 'storage', enabled: true, loaded: true, toggleable: true, namespace: 'storage' },
            { id: 'off', name: 'off', enabled: false, loaded: false, toggleable: true },
          ],
        },
      })
      await type('/settings plugins')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('插件'))).toBe(true)
      expect(lines.some(line => line.includes('● storage · storage'))).toBe(true)
      expect(lines.some(line => line.includes('○ off · off · 未加载 · 已禁用'))).toBe(true)
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      lines = lastFrameLines(capture)
      expect(toggled).toEqual(['storage'])
      expect(lines.some(line => line.includes('○ storage · storage · 未加载 · 已禁用'))).toBe(true)
      expect(lines.some(line => line.includes('storage → 已关闭'))).toBe(true)
      await type('\x1b[B')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      lines = lastFrameLines(capture)
      expect(toggled).toEqual(['storage', 'off'])
      expect(lines.some(line => line.includes('● off · off'))).toBe(true)
      expect(lines.some(line => line.includes('off → 已开启'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('coalesces Enter key-repeat while one plugin toggle is settling', async () => {
    let finish: ((result: { ok: true; enabled: boolean }) => void) | undefined
    let calls = 0
    const { store, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      togglePlugin: () => {
        calls += 1
        return new Promise((resolve) => { finish = resolve })
      },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          plugins: [{ id: 'storage', name: 'storage', enabled: true, loaded: true, toggleable: true }],
        },
      })
      await type('/settings plugins')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      await type('\r\r')
      expect(calls).toBe(1)
      finish?.({ ok: true, enabled: false })
      await new Promise<void>(resolve => setTimeout(resolve, 50))
    } finally {
      unmount()
    }
  }, 30_000)

  it('reports a host dependency rejection when a previously toggleable plugin becomes blocked', async () => {
    const toggled: string[] = []
    const { store, capture, unmount, type } = await mount([{ kind: 'user', id: 1, text: 'hi' }], {
      togglePlugin: async (id) => {
        toggled.push(id)
        return { ok: false, code: 'dependency-blocked', blockers: ['session-title'] }
      },
    })
    try {
      const snapshot = store.getSnapshot()
      store.set({
        ...snapshot,
        version: snapshot.version + 1,
        settings: snapshot.settings === null ? snapshot.settings : {
          ...snapshot.settings,
          plugins: [
            { id: 'storage', name: 'storage', enabled: true, loaded: true, toggleable: true },
            {
              id: 'session',
              name: 'session',
              enabled: true,
              loaded: true,
              toggleable: true, // The dependency changed after this snapshot.
            },
          ],
        },
      })
      await type('/settings plugins')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      await type('\x1b[B')
      await type('\r')
      await new Promise<void>(resolve => setTimeout(resolve, 50))
      const lines = lastFrameLines(capture)
      expect(toggled).toEqual(['session'])
      expect(lines.some(line => line.includes('存在活跃依赖方，无法操作：session ← session-title'))).toBe(true)
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
            { id: 'sessions', name: 'sessions', enabled: true, loaded: true, toggleable: true },
            { id: 'optional', name: 'optional', enabled: false, loaded: false, toggleable: true },
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
      expect(screen).toContain('blocked rows are read-only')
      expect(screen).not.toMatch(/\p{Script=Han}/u)
    } finally {
      unmount()
    }
  }, 30_000)

  it('labels a settled Thinking row with its 0.1s-precision duration', async () => {
    const { capture, unmount } = await mount([{ kind: 'think', id: 1, text: 'reasoning here', durationMs: 3456 }])
    try {
      const lines = lastFrameLines(capture)
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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('thinking off'))).toBe(true)
      expect(lines.filter(line => line.includes('✓ Thinking') && line.includes('▶'))).toHaveLength(2)

      await type(disclosureClick(lines, '✓ Thinking 1.0s'))
      lines = lastFrameLines(capture)
      expect(updates).toEqual(['expanded'])
      expect(lines.some(line => line.includes('thinking on'))).toBe(true)
      expect(lines.filter(line => line.includes('✓ Thinking') && line.includes('▼'))).toHaveLength(2)
      expect(lines.some(line => line.includes('│ alpha reasoning'))).toBe(true)
      expect(lines.some(line => line.includes('│ beta reasoning'))).toBe(true)

      // Clicking either expanded row closes every Thinking body and updates
      // the same setting/header state.
      await type(disclosureClick(lines, '✓ Thinking 2.0s'))
      lines = lastFrameLines(capture)
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
      let lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('context detail'))).toBe(false)
      const contextHead = lines.find(line => line.includes('▶'))?.trim() ?? ''
      await type(disclosureClick(lines, contextHead.slice(0, -1).trim()))
      lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
      expect(frameRows(lines)).toBe(20)
      // No rendered row may exceed the physical width — the wrap would push
      // its tail onto the next row (the overlap bug).
      for (const line of lines) {
        expect(stringWidth(line)).toBeLessThanOrEqual(30)
      }
      // The welcome panel's borders stay on one intact row each.
      expect(lines.some(line => line.trimStart().startsWith('┏') && line.trimEnd().endsWith('┓'))).toBe(true)
      expect(lines.some(line => line.trimStart().startsWith('┗') && line.trimEnd().endsWith('┛'))).toBe(true)
      expect(WELCOME_CARD_COLOR).toBe('#A99B45')
      // Typing '/' opens the palette; the palette must respect its height
      // budget so it can never overwrite the composer row below it, and the
      // composer row itself must show the draft.
      await type('/')
      const afterSlash = lastFrameLines(capture)
      const composerRows = afterSlash.filter(line => line.trimStart().startsWith('❯'))
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture)
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
      const lines = lastFrameLines(capture).map(line => line.trimEnd())
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
      const lines = lastFrameLines(capture).map(line => line.trimEnd())
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
      const lines = lastFrameLines(capture)
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
    const { capture, unmount, type, stdin } = await mount(nodes)
    try {
      // Wheel up far past the maximum offset; the clamp stops at the top.
      for (let tick = 0; tick < 100; tick += 1) {
        stdin.write('\x1b[<64;10;5M')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      await type('')
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('▸ the very first prompt'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('copies a dragged span on mouse-up and does not copy on a bare click', async () => {
    const { capture, unmount, type } = await mount([
      { kind: 'user', id: 1, text: 'hi there' },
      { kind: 'assistant', id: 2, text: 'const value = 123', messageId: 'm2' },
    ])
    try {
      expect(capture.output).toContain('\x1b[?1000h')
      const frame = lastFrameLines(capture)
      const promptRow = frame.findIndex(line => line.includes('▸ hi there'))
      expect(promptRow).toBeGreaterThanOrEqual(0)
      const row = promptRow + 1
      await type(`\x1b[<0;4;${row}M`)
      await type(`\x1b[<32;4;${row}M`)
      await type(`\x1b[<32;4;${row + 1}M`)
      await type(`\x1b[<0;4;${row}m`)
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(lastFrameLines(capture).some(line =>
        line.includes('已复制') || line.includes('Copied'))).toBe(false)
      expect(promptRowHasInverse(capture, 'hi there')).toBe(false)
      const replyRow = lastFrameLines(capture).findIndex(line => line.includes('const value = 123'))
      expect(replyRow).toBeGreaterThanOrEqual(0)
      const reply = replyRow + 1
      await type(`\x1b[<0;3;${reply}M`)
      await type(`\x1b[<32;18;${reply}M`)
      await type(`\x1b[<0;18;${reply}m`)
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(lastFrameLines(capture).some(line =>
        line.includes('已复制') || line.includes('Copied') || line.includes('复制失败') || line.includes('Copy failed'))).toBe(true)
      expect(promptRowHasInverse(capture, 'const value = 123')).toBe(false)
      expect(capture.output).toContain('\x1b[?1000h')
      await type('\x1b[<64;10;5M')
      await new Promise<void>(resolve => setTimeout(resolve, 320))
    } finally {
      unmount()
    }
  }, 30_000)

  it('keeps transcript rows still while dragging vertically and does not duplicate a split line', async () => {
    const { capture, unmount, type } = await mount([
      { kind: 'user', id: 1, text: 'UNIQUE_PROMPT_LINE' },
      { kind: 'assistant', id: 2, text: 'UNIQUE_ALPHA_LINE\nUNIQUE_BETA_LINE', messageId: 'm2' },
    ])
    try {
      const before = capture.screenLines()
      const alphaRow = before.findIndex(line => line.includes('UNIQUE_ALPHA_LINE'))
      const promptRow = before.findIndex(line => line.includes('UNIQUE_PROMPT_LINE'))
      expect(alphaRow).toBeGreaterThanOrEqual(0)
      expect(promptRow).toBeGreaterThanOrEqual(0)
      expect(before.filter(line => line.includes('UNIQUE_ALPHA_LINE')).length).toBe(1)
      const start = alphaRow + 1
      const end = before.findIndex(line => line.includes('UNIQUE_BETA_LINE')) + 1
      expect(end).toBeGreaterThan(start)
      await type(`\x1b[<0;4;${start}M`)
      await type(`\x1b[<32;18;${end}M`)
      const mid = capture.screenLines()
      expect(mid.findIndex(line => line.includes('UNIQUE_PROMPT_LINE'))).toBe(promptRow)
      expect(mid.findIndex(line => line.includes('UNIQUE_ALPHA_LINE'))).toBe(alphaRow)
      expect(mid.filter(line => line.includes('UNIQUE_ALPHA_LINE')).length).toBe(1)
      expect(mid.filter(line => line.includes('UNIQUE_BETA_LINE')).length).toBe(1)
      await type(`\x1b[<0;18;${end}m`)
      await new Promise<void>(resolve => setTimeout(resolve, 320))
      expect(promptRowHasInverse(capture, 'UNIQUE_ALPHA_LINE')).toBe(false)
      expect(lastFrameLines(capture).some(line =>
        line.includes('已复制') || line.includes('Copied') || line.includes('复制失败') || line.includes('Copy failed'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)

  it('scrolls older history into view when a drag holds at the transcript top edge', async () => {
    const nodes: TuiNode[] = [
      { kind: 'user', id: 0, text: 'UNIQUE_TOP_PROMPT' },
      ...Array.from({ length: 80 }, (_, index) => ({
        kind: 'assistant' as const, id: 10 + index, text: `assistant row ${index}`, messageId: `m${index}`,
      })),
    ]
    const { capture, unmount, type } = await mount(nodes)
    try {
      expect(capture.screenLines().some(line => line.includes('UNIQUE_TOP_PROMPT'))).toBe(false)
      const startRow = capture.screenLines().findIndex(line => line.includes('assistant row 79')) + 1
      expect(startRow).toBeGreaterThan(0)
      await type(`\x1b[<0;4;${startRow}M`)
      for (let tick = 0; tick < 8; tick += 1) await type('\x1b[<32;4;5M')
      expect(capture.screenLines().some(line => line.includes('UNIQUE_TOP_PROMPT'))).toBe(true)
      await type('\x1b[<0;4;5m')
    } finally {
      unmount()
    }
  }, 30_000)

  it('replaces the composer selection when Ctrl+A is followed by typing', async () => {
    const { capture, unmount, type } = await mount()
    try {
      await type('hello')
      await type('\x01')
      await type('x')
      const lines = capture.screenLines()
      const composer = lines.find(line => line.includes('❯'))
      expect(composer).toBeDefined()
      expect(composer).toContain('x')
      expect(composer).not.toContain('hello')
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
      const lines = lastFrameLines(capture)
      expect(lines.some(line => line.includes('已复制') || line.includes('Copied') || line.includes('复制失败') || line.includes('Copy failed'))).toBe(true)
    } finally {
      unmount()
    }
  }, 30_000)
})

describe('masked terminal projection and exports', () => {
  it('rebuilds live wrapping when masking replaces a previously unrecognized prefix', async () => {
    const { capture, store, unmount } = await mount()
    try {
      const before = store.getSnapshot()
      store.set({ ...before, version: before.version + 1, busy: true,
        live: { text: 'ghp_abc', think: 'ghp_abc', thinkSince: Date.now() } })
      await vi.waitFor(() => expect(lastFrameLines(capture).join('\n')).toContain('ghp_abc'), { timeout: 2000 })
      const next = store.getSnapshot()
      store.set({ ...next, version: next.version + 1,
        live: { text: 'ghp_' + 'abcdef'.repeat(8), think: 'ghp_' + 'abcdef'.repeat(8), thinkSince: Date.now() } })
      await vi.waitFor(() => {
        const screen = lastFrameLines(capture).join('\n')
        expect(screen).toContain('[REDACTED]')
        expect(screen).not.toContain('ghp_abc')
      }, { timeout: 2000 })
    } finally { unmount() }
  })

  it('masks the complete live buffers before wrapping assistant text and thinking tails', async () => {
    const secret = 'sk-' + 'v'.repeat(60)
    const { capture, store, unmount } = await mount()
    try {
      const before = store.getSnapshot()
      store.set({ ...before, version: before.version + 1, busy: true,
        live: { text: `api_key=${secret}`, think: `Authorization: Bearer ${secret}`, thinkSince: Date.now() } })
      await vi.waitFor(() => expect(lastFrameLines(capture).join('\n')).toContain('[REDACTED]'), { timeout: 2000 })
      expect(capture.output).not.toContain(secret)
      expect(store.getSnapshot().live?.text).toContain(secret)
    } finally { unmount() }
  })

  it('masks complete message secrets before wrapping without changing stored facts', async () => {
    const secret = 'sk-' + 's'.repeat(60)
    const source: TuiNode = { kind: 'user', id: 901, text: `api_key=${secret}` }
    const { capture, store, unmount } = await mount([source])
    try {
      expect(capture.output).not.toContain(secret)
      expect(lastFrameLines(capture).join('\n')).toContain('[REDACTED]')
      expect(store.getSnapshot().nodes[0]).toMatchObject({ text: `api_key=${secret}` })
    } finally { unmount() }
  })

  it('uses masked export by default and forwards raw archive only on explicit --raw', async () => {
    const submit = vi.fn()
    const exportTranscript = vi.fn(async () => '/tmp/dsh-tui-export-test/transcript.txt')
    const { type, unmount } = await mount([], { submit, exportTranscript })
    try {
      await type('/export')
      await type('\r')
      expect(exportTranscript).toHaveBeenCalledTimes(1)
      expect(submit).not.toHaveBeenCalled()
      await type('/export --raw')
      await type('\r')
      expect(submit).toHaveBeenCalledExactlyOnceWith('/export --raw', false)
    } finally { unmount() }
  }, 15_000)
})

it('changes approval policy through the adapter while preserving the stashed Unicode draft', async () => {
  const setApprovalPolicy = vi.fn(async (_policy: 'ask' | 'never') => {})
  const { store, capture, type, unmount } = await mount([], { setApprovalPolicy })
  try {
    const current = store.getSnapshot()
    store.set({ ...current, version: current.version + 1, approval: { policy: 'ask', source: 'profile' }, settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en', keymap: 'claude-fullscreen' } } })
    await type('中文🙂 draft'); await type('\x13')
    await type('/permissions'); await type('\r')
    expect(capture.screenLines().join('\n')).toContain('Ask when required')
    await type('Never'); await type('\r')
    expect(setApprovalPolicy).toHaveBeenCalledExactlyOnceWith('never')
    expect(store.getSnapshot().sandbox).toBe('read-only')
    await type('\x1b'); await type('\x1b'); await type('\x13')
    expect(capture.screenLines().join('\n')).toContain('中文🙂 draft')
  } finally { unmount() }
}, 15_000)

it('requires a second explicit Enter for the host Auto preset and explains the sandbox and request cost', async () => {
  const selectPermissionPreset = vi.fn(async (_name: string) => {})
  const { store, capture, type, unmount } = await mount([], { selectPermissionPreset })
  try {
    const current = store.getSnapshot()
    store.set({ ...current, version: current.version + 1,
      permissionCatalog: { current: 'workspace-write', options: [{ value: 'workspace-write', name: 'Workspace' }, { value: 'auto', name: 'Auto review' }] },
      settings: { ...current.settings!, general: { ...current.settings!.general, appearance: 'claude-terminal-dark', locale: 'en' } } })
    await type('/permissions'); await type('\r'); await type('Auto review'); await type('\r')
    expect(selectPermissionPreset).not.toHaveBeenCalled()
    expect(capture.screenLines().join('\n')).toContain('no file sandbox')
    expect(capture.screenLines().join('\n')).toContain('additional model review')
    await type('\r')
    expect(selectPermissionPreset).toHaveBeenCalledExactlyOnceWith('auto')
  } finally { unmount() }
})


describe('custom bindings mounted input ownership', () => {
  it('submits exactly once through a chord and retains Chinese/Emoji text', async () => {
    const submit=vi.fn(), app=await mount([], {submit})
    try {
      app.store.set({...app.store.getSnapshot(), version:app.store.getSnapshot().version+1, keybindings:parseKeybindings(JSON.stringify({bindings:[{context:'Chat',bindings:{'ctrl+x ctrl+s':'chat:submit',enter:null}}]}))})
      await app.type('中文🌏')
      await app.type('\r')
      expect(submit).not.toHaveBeenCalled()
      await app.type('\x18'); await app.type('\x13')
      expect(submit).toHaveBeenCalledTimes(1)
      expect(submit).toHaveBeenCalledWith('中文🌏',false)
    } finally {app.unmount()}
  })
  it('requires confirmation before MCP execution and never sends management to the model', async()=>{
    const manageMcp=vi.fn().mockResolvedValue(null), submit=vi.fn(), app=await mount([], {manageMcp,submit})
    try {
      await app.type('/mcp enable mcp-demo'); await app.type('\r')
      expect(manageMcp).not.toHaveBeenCalled()
      await app.type('/mcp enable mcp-demo'); await app.type('\r')
      expect(manageMcp).toHaveBeenCalledWith({action:'enable',id:'mcp-demo'})
      expect(submit).not.toHaveBeenCalled()
    } finally {app.unmount()}
  })
})

 it('opens a bound panel and backgrounds once without submitting or erasing the draft', async () => {
  const submit=vi.fn(), backgroundSession=vi.fn().mockResolvedValue(null), app=await mount([], {submit,backgroundSession})
  try {
    app.store.set({...app.store.getSnapshot(), version:app.store.getSnapshot().version+1, keybindings:parseKeybindings(JSON.stringify({bindings:[{context:'Chat',bindings:{'ctrl+o':'chat:model','ctrl+b':'chat:background'}}]}))})
    await app.type('草稿🌏')
    await app.type('\x0f')
    expect(app.capture.screenLines().join('\n')).toMatch(/model|模型/i)
    // Protected panel input cannot activate a Chat background binding.
    await app.type('\x02')
    expect(backgroundSession).not.toHaveBeenCalled()
    await app.type('\x1b')
    expect(app.capture.screenLines().join('\n')).toContain('草稿🌏')
    await app.type('\x02')
    expect(backgroundSession).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    await app.type('\x1b')
    expect(app.capture.screenLines().join('\n')).toContain('草稿🌏')
  } finally {app.unmount()}
})

it('uses Settings navigation bindings without submitting the draft or changing the search query', async () => {
 const submit=vi.fn(), updateSetting=vi.fn().mockResolvedValue(undefined), app=await mount([], {submit,updateSetting})
 try {
  app.store.set({...app.store.getSnapshot(),version:app.store.getSnapshot().version+1,keybindings:parseKeybindings(JSON.stringify({bindings:[
   {context:'Chat',bindings:{'ctrl+o':'app:settings'}},
   {context:'Global',bindings:{'ctrl+n':'app:exit'}},
   {context:'Settings',bindings:{'ctrl+n':'panel:down','ctrl+k':'panel:up','ctrl+q':'panel:close'}}
  ]}))})
  await app.type('草稿🌏'); await app.type('\x0f')
  const before=app.capture.screenLines().join('\n')
  await app.type('\x0e')
  const after=app.capture.screenLines().join('\n')
  expect(after).not.toBe(before)
  expect(after).toMatch(/settings|设置/i)
  await app.type('\x11')
  expect(app.capture.screenLines().join('\n')).toContain('草稿🌏')
  expect(submit).not.toHaveBeenCalled()
  expect(updateSetting).not.toHaveBeenCalled()
 } finally {app.unmount()}
})


it('uses a block caret from the first current-theme frame and after activity changes', async () => {
  const app = await mount()
  try {
    const snapshot = app.store.getSnapshot()
    app.store.set({ ...snapshot, version: snapshot.version + 1, settings: { ...snapshot.settings!, general: { ...snapshot.settings!.general, appearance: 'claude-terminal-dark' } } })
    await app.type('')
    expect(app.capture.output).toContain('\x1b[2 q')
    expect(app.capture.terminal.options.cursorStyle).toBe('block')
    app.store.set({ ...app.store.getSnapshot(), version: app.store.getSnapshot().version + 1, busy: true })
    await app.type('中文🌏')
    expect(app.capture.terminal.options.cursorStyle).toBe('block')
    expect(app.capture.screenLines().join('\n')).toContain('中文🌏')
  } finally { app.unmount() }
})

it('installs a new bundle only after review without submitting a model request', async () => {
  const installPlugin = vi.fn().mockResolvedValue({ name:'new-bundle', phase:'applied', rollback:'not-needed' })
  const submit = vi.fn(), app = await mount([], { installPlugin, submit })
  try {
    const snapshot = app.store.getSnapshot()
    app.store.set({ ...snapshot, version: snapshot.version + 1, settings:{ ...snapshot.settings!, bundles:[], general:{...snapshot.settings!.general,appearance:'claude-terminal-dark',locale:'en'} } })
    await app.type('/settings plugins'); await app.type('\r'); await app.type('\r')
    await app.type('new-bundle@1.2.3'); await app.type('\r')
    expect(installPlugin).not.toHaveBeenCalled()
    expect(app.capture.screenLines().join('\n')).toContain('installed disabled')
    await app.type('\r')
    expect(installPlugin).toHaveBeenCalledExactlyOnceWith('new-bundle','1.2.3')
    expect(submit).not.toHaveBeenCalled()
  } finally { app.unmount() }
})

it('confirms future-session permissions separately from the current session preset', async () => {
  const setPermissionDefault=vi.fn().mockResolvedValue(undefined), selectPermissionPreset=vi.fn()
  const app=await mount([], {setPermissionDefault,selectPermissionPreset})
  try {
    const snapshot=app.store.getSnapshot()
    app.store.set({...snapshot,version:snapshot.version+1,permissionCatalog:{current:'workspace-write',options:[{value:'workspace-write',name:'Workspace'}],defaultPreset:'workspace-write',defaultWritable:true,defaultOptions:[{value:'read-only',name:'Future sessions read only'}]},settings:{...snapshot.settings!,general:{...snapshot.settings!.general,appearance:'claude-terminal-dark',locale:'en'}}})
    await app.type('/permissions');await app.type('\r');await app.type('Future sessions read only');await app.type('\r')
    expect(setPermissionDefault).not.toHaveBeenCalled()
    expect(app.capture.screenLines().join('\n')).toContain('Current and saved sessions stay unchanged')
    await app.type('\r')
    expect(setPermissionDefault).toHaveBeenCalledExactlyOnceWith('read-only')
    expect(selectPermissionPreset).not.toHaveBeenCalled()
    expect(app.store.getSnapshot().permissionCatalog?.current).toBe('workspace-write')
  } finally {app.unmount()}
})

it('requires explicit confirmation before removing a profile bundle', async () => {
  const removeBundle=vi.fn().mockResolvedValue({application:'restart-required',restartReason:'no-hmr'})
  const app=await mount([], {removeBundle})
  try {
    const snapshot=app.store.getSnapshot()
    app.store.set({...snapshot,version:snapshot.version+1,settings:{...snapshot.settings!,general:{...snapshot.settings!.general,appearance:'claude-terminal-dark',locale:'en'},bundles:[{name:'fixture-bundle',version:'1.0.0',installed:true,enabled:false,availability:'profile',removable:true}]}})
    await app.type('/settings plugins');await app.type('\r');await app.type('Remove bundle');await app.type('\r')
    expect(removeBundle).not.toHaveBeenCalled()
    expect(app.capture.screenLines().join('\n')).toContain('whole profile')
    await app.type('\r')
    expect(removeBundle).toHaveBeenCalledExactlyOnceWith('fixture-bundle')
    expect(app.capture.screenLines().join('\n')).toContain('restart-required')
  } finally {app.unmount()}
})
