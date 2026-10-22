import { isAppearance } from '../src/theme'
/** Real App → patched Ink → headless terminal measurement; synthetic host, no provider calls. */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { performance } from 'node:perf_hooks'
import { cpus, platform, arch } from 'node:os'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { createElement } from 'react'
import { render } from 'ink'
import xtermHeadless from '@xterm/headless'
import { expect, it } from 'vitest'
import { App, type TuiHost } from '../src/render'
import { createTuiStore } from '../src/store'
import { initialState } from '../src/fold'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!
it('measures real App input paint, ANSI volume and backpressure recovery', { timeout: 30_000 }, async () => {
  const paths = ['packages/tui/tui/src/render.tsx', 'packages/tui/tui/src/transcript-anchor.ts',
    'packages/tui/tui/src/viewport.ts', 'packages/tui/tui/src/wrap.ts', 'packages/tui/tui/src/fold.ts',
    'packages/tui/tui/tests/render-performance.spec.ts', 'patches/ink@7.1.1.patch',
    'node_modules/ink/build/ink.js', 'pnpm-lock.yaml']
  const hashes = () => Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]))
  const sourceSha256 = hashes()
  const scenes: unknown[] = []
  for (const nodeCount of [1_000, 3_000]) {
    const terminal = new xtermHeadless.Terminal({ cols: 100, rows: 30, allowProposedApi: true, convertEol: true })
    const chunks: string[] = []
    let accept = true
    let painted: (() => void) | undefined
    const stdout = Object.assign(new EventEmitter(), { columns: 100, rows: 30, isTTY: true,
      write(chunk: string) {
        chunks.push(String(chunk))
        terminal.write(String(chunk), () => painted?.())
        return accept
      },
    })
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} })
    const store = createTuiStore({ ...initialState(), version: 1,
      nodes: Array.from({ length: nodeCount }, (_, id) => ({ kind: 'user' as const, id, text: `History item ${id} 中文` })),
      provider: 'fixture', model: 'fixture', sessionId: 'perf-fixture', cwd: '.', pendingApproval: null, pendingQuestion: null,
      commands: [], skills: [], models: [], sessions: [], queued: [], jobs: [], subagents: [], workflows: [], feedback: new Map(),
      plan: { active: false, pending: false }, goal: null, reasoning: { effort: undefined, levels: [] },
      attachmentCount: 0, pendingImages: [], compaction: false, sandbox: 'read-only', occupancy: null, resumeProgress: null,
      settings: { general: { busyEnter: 'queue', thinking: 'collapsed', theme: 'dark', locale: 'en', appearance: isAppearance(process.env.DSH_RENDER_APPEARANCE ?? '') ? process.env.DSH_RENDER_APPEARANCE as 'claude-terminal-dark' | 'claude-terminal-light' | 'dsh-classic' : 'dsh-classic' },
        models: { providers: [], credentials: [] }, plugins: [], configs: {},
        inventory: { namespaces: [], credentials: [], inspectProviders: 0 }, presets: [], currentPreset: undefined },
    })
    // No host execution is exercised; unexpected backend actions fail this benchmark.
    const host = new Proxy({ listSessionReferences: async () => [], syncImageChips: (_before: string, after: string) => after }, {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target]
        return () => { throw new Error(`Unexpected synthetic host action: ${String(key)}`) }
      },
    }) as unknown as TuiHost
    const screen = () => Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n')
    const waitPaint = (text: string, action: () => void): Promise<number> => new Promise((resolve, reject) => {
      const started = performance.now()
      const timeout = setTimeout(() => { painted = undefined; reject(new Error(`Paint timeout for ${text}`)) }, 3_000)
      painted = () => {
        if (!screen().includes(text)) return
        clearTimeout(timeout); painted = undefined; resolve(performance.now() - started)
      }
      action()
    })
    const instance = render(createElement(App, { store, host }), {
      stdout: stdout as never, stdin: stdin as never, exitOnCtrlC: false, patchConsole: false,
      alternateScreen: true, interactive: true, incrementalRendering: true, windowsFullscreenDiff: true,
      coalesceBackpressuredFrames: true,
    })
    try {
      await delay(150)
      const cpuBefore = process.cpuUsage()
      const memoryBefore = process.memoryUsage()
      const samples: Array<{ inputToHeadlessPaintMs: number; ansiBytes: number; writeCalls: number; csiSequences: number }> = []
      let draft = ''
      for (let i = 0; i < 24; i++) {
        draft += 'Z'
        const begin = chunks.length
        const ms = await waitPaint(draft, () => stdin.write('Z'))
        const emitted = chunks.slice(begin).join('')
        if (i >= 3) samples.push({ inputToHeadlessPaintMs: ms, ansiBytes: Buffer.byteLength(emitted),
          writeCalls: chunks.length - begin, csiSequences: [...emitted.matchAll(/\x1b\[[0-?]*[ -/]*[@-~]/g)].length })
      }
      const cpu = process.cpuUsage(cpuBefore)
      const memoryAfter = process.memoryUsage()
      const update = (number: number) => {
        const snapshot = store.getSnapshot()
        store.set({ ...snapshot, version: snapshot.version + 1,
          nodes: [...snapshot.nodes.slice(0, nodeCount), { kind: 'assistant', id: nodeCount + 1, messageId: 'pressure', text: `BACKPRESSURE-${number}` }] })
      }
      accept = false
      await waitPaint('BACKPRESSURE-1', () => update(1))
      const blockedStart = chunks.length
      for (let i = 2; i <= 8; i++) { update(i); await delay(5) }
      const writesWhileBlocked = chunks.length - blockedStart
      expect(writesWhileBlocked).toBe(0)
      const recoveryMs = await waitPaint('BACKPRESSURE-8', () => { accept = true; stdout.emit('drain') })
      expect(screen()).toContain('BACKPRESSURE-8')
      expect(store.getSnapshot().nodes.at(-1)).toMatchObject({ text: 'BACKPRESSURE-8' })
      const times = samples.map(sample => sample.inputToHeadlessPaintMs)
      scenes.push({ nodeCount, warmups: 3, samples, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), p99Ms: percentile(times, 0.99),
        cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, memoryBefore, memoryAfter,
        backpressure: { updates: 8, writesWhileBlocked, drainToLatestHeadlessPaintMs: recoveryMs,
          recoveryAnsiBytes: Buffer.byteLength(chunks.slice(blockedStart).join('')) } })
    } finally { instance.unmount(); terminal.dispose() }
  }
  expect(hashes()).toEqual(sourceSha256)
  const report = { recordedAt: new Date().toISOString(), environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    appearance: process.env.DSH_RENDER_APPEARANCE ?? 'dsh-classic',
    scope: 'Actual App + patched Ink input handling through ANSI output into a headless xterm grid',
    limitations: ['Synthetic host; no model requests or approvals.', 'Headless-grid visibility is not physical display/input-method/SSH latency.',
      'Backpressure stream is controlled in-process, not an OS PTY congestion measurement.', '21 warm samples; p99 is the maximum.',
      'Memory/CPU shared-process snapshots, not isolated allocations or leak evidence.'],
    sourceSha256, scenes }
  if (process.env.DSH_RENDER_PERF_OUTPUT) {
    mkdirSync(dirname(process.env.DSH_RENDER_PERF_OUTPUT), { recursive: true })
    writeFileSync(process.env.DSH_RENDER_PERF_OUTPUT, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify({ renderPerformance: scenes }))
})
