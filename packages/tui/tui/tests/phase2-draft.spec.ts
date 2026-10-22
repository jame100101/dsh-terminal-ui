import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { DraftImageRegistry } from '../src/draft-images'
import { Writable, PassThrough } from 'node:stream'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink'
import xtermHeadless from '@xterm/headless'
import { App } from '../src/render'
import type { TuiHost } from '../src/harness/adapter'
import { createTuiStore } from '../src/store'
import type { TuiStore, PendingImageChip } from '../src/store'
import type { TuiNode } from '../src/types'
const COLUMNS = 100
const ROWS = 30
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
    version: 1,
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
      general: { busyEnter: 'queue', thinking: 'collapsed', theme: 'dark', locale: 'en', keymap: 'claude-fullscreen' },
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
  // Ink 7 probes the kitty keyboard protocol for the first ~200ms after
  // mount (a 'data' listener swallows input during that window); settle past
  // it before driving keys, exactly like a real user's first keystroke.
  const settle = async (): Promise<void> => { await new Promise<void>(resolve => setTimeout(resolve, 320)) }
  await settle()
  return { store, capture, stdin, unmount: () => instance.unmount(), type: async (text) => { stdin.write(text); await settle() } }
}

const chip = (resource: string): PendingImageChip => ({ resource, chip: '[Image #1]', name: 'fixture.png', bytes: 1, width: 1, height: 1, mediaType: 'image/png' })
function publishImages(store: TuiStore, resources: readonly string[]): void {
  const current = store.getSnapshot()
  store.set({ ...current, version: current.version + 1, attachmentCount: resources.length, pendingImages: resources.map(chip) })
}
const composer = (capture: Capture): string => capture.screenLines().find(line => line.trimStart().startsWith('❯')) ?? ''

describe('Phase 2 Ctrl+S complete draft transactions', () => {
  it('retains the active draft while image intake is pending', async () => {
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    let active!: TuiStore
    const restore = vi.fn((resources: readonly string[]) => publishImages(active, resources))
    const fixture = await mount([], { restoreDraftImages: restore, attachClipboardImage: async () => {
      await ready
      publishImages(active, ['image-original'])
      return { error: null, chip: '[Image #1]' }
    } })
    active = fixture.store
    try {
      await fixture.type('original')
      await fixture.type('\x16')
      await fixture.type('\x13')
      expect(composer(fixture.capture)).toContain('original')
      expect(restore).not.toHaveBeenCalled()
      release()
      await fixture.type('')
      expect(composer(fixture.capture)).toContain('original')
      expect(composer(fixture.capture)).toContain('[Image #1]')
    } finally { release(); fixture.unmount() }
  })

  it('does not commit a stash until the host accepts the resource replacement', async () => {
    let active!: TuiStore
    const restore = vi.fn((resources: readonly string[]) => publishImages(active, resources))
      .mockImplementationOnce(() => { throw new Error('fixture resource rejection') })
    const fixture = await mount([], { restoreDraftImages: restore })
    active = fixture.store
    try {
      await fixture.type('must retain')
      await fixture.type('\x13')
      expect(composer(fixture.capture)).toContain('must retain')
      await fixture.type('\x13')
      expect(composer(fixture.capture)).not.toContain('must retain')
      await fixture.type('\x13')
      expect(composer(fixture.capture)).toContain('must retain')
    } finally { fixture.unmount() }
  })

  it('preserves image-only scratch snapshots when swapping an earlier text stash', async () => {
    let active!: TuiStore
    const fixture = await mount([], { restoreDraftImages: resources => publishImages(active, resources) })
    active = fixture.store
    try {
      await fixture.type('saved text')
      await expect.poll(() => composer(fixture.capture)).toContain('saved text')
      await fixture.type('\x13')
      await expect.poll(() => composer(fixture.capture)).not.toContain('saved text')
      publishImages(active, ['scratch-image'])
      await fixture.type('')
      await fixture.type('\x13')
      await expect.poll(() => composer(fixture.capture)).toContain('saved text')
      expect(active.getSnapshot().pendingImages).toEqual([])
      await fixture.type('\x13')
      await expect.poll(() => active.getSnapshot().pendingImages.map(image => image.resource)).toEqual(['scratch-image'])
    } finally { fixture.unmount() }
  })

  it('swaps collapsed paste resources and image registry identities without sending capsules', async () => {
    let active!: TuiStore
    const submit = vi.fn()
    const registry = new DraftImageRegistry()
    registry.remember([{ attachmentId: AttachmentId('saved-image'), bytes: 1, width: 1, height: 1, mediaType: 'image/png' }])
    const fixture = await mount([], { submit, restoreDraftImages: resources => publishImages(active, registry.restore(resources).map(ref => String(ref.attachmentId))), attachClipboardImage: async () => {
      publishImages(active, ['saved-image'])
      return { error: null, chip: '[Image #1]' }
    } })
    active = fixture.store
    const pasted = Array.from({ length: 20 }, (_, index) => `中文 ${index} 😀`).join('\n')
    try {
      await fixture.type('picture')
      await fixture.type('\x16')
      await fixture.type('\x13')
      await fixture.type(`\x1b[200~${pasted}\x1b[201~`)
      expect(composer(fixture.capture)).toContain('[Pasted text #1')
      await fixture.type('\x13')
      expect(active.getSnapshot().pendingImages.map(image => image.resource)).toEqual(['saved-image'])
      await fixture.type('\x13')
      expect(active.getSnapshot().pendingImages).toEqual([])
      await fixture.type('\r')
      expect(submit).toHaveBeenCalledWith(pasted, false)
    } finally { fixture.unmount() }
  })

  it('never restores the old stash after an authoritative session switch', async () => {
    const restore = vi.fn()
    const fixture = await mount([], { restoreDraftImages: restore })
    try {
      await fixture.type('old session draft')
      await fixture.type('\x13')
      const current = fixture.store.getSnapshot()
      fixture.store.set({ ...current, version: current.version + 1, sessionId: 'new-session' })
      await fixture.type('')
      restore.mockClear()
      await fixture.type('\x13')
      expect(restore).not.toHaveBeenCalled()
      expect(composer(fixture.capture)).not.toContain('old session draft')
    } finally { fixture.unmount() }
  })
})
