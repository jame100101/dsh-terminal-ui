import { runInk } from '../../src/render'
import { createTuiStore } from '../../src/store'
import type { TuiHost } from '../../src/render'
import type { TuiNode } from '../../src/types'
import { appendFileSync, writeFileSync } from 'node:fs'

const requestedNodeCount = Number(process.env.TUI_PTY_NODE_COUNT ?? 80)
const nodeCount = Number.isFinite(requestedNodeCount)
  ? Math.max(1, Math.min(3_000, Math.floor(requestedNodeCount)))
  : 80
const requestedUpdateMs = Number(process.env.TUI_PTY_UPDATE_MS ?? 40)
const updateMs = Number.isFinite(requestedUpdateMs)
  ? Math.max(10, Math.min(1_000, Math.floor(requestedUpdateMs)))
  : 40
const memoryLog = process.env.TUI_PTY_MEMORY_LOG
const memoryTimer = memoryLog === undefined
  ? undefined
  : (() => {
    writeFileSync(memoryLog, '')
    const record = (): void => {
      appendFileSync(memoryLog, `${JSON.stringify({ at: Date.now(), ...process.memoryUsage() })}\n`)
    }
    record()
    return setInterval(record, 1_000)
  })()
const nodes: TuiNode[] = Array.from({ length: nodeCount }, (_, index) => ({
  kind: 'user',
  id: index,
  text: `第${index}行 😀 ⚙ ${'long '.repeat(20)}`,
}))

const initial = {
  version: 0,
  nodes,
  trace: [],
  todos: [],
  stats: {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    stepsWithTtft: 0,
    decodeMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    contextWindow: 0,
    costUsd: 0,
  },
  live: null,
  busy: false,
  provider: 'fixture',
  model: 'pty-fixture',
  sessionId: 'pty-fixture',
  cwd: '.',
  pendingApproval: null,
  pendingQuestion: null,
  commands: [],
  skills: [],
  models: [{ provider: 'fixture', model: 'pty-fixture', label: 'pty-fixture' }],
  sessions: [],
  queued: [],
  settings: {
    general: { busyEnter: 'queue', thinking: 'collapsed', theme: 'dark', locale: 'en' },
    models: { providers: [], credentials: [] },
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
} as const

const store = createTuiStore(initial)

let sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' = 'read-only'

const host: TuiHost = {
  submit: (text) => {
    const current = store.getSnapshot()
    store.set({
      ...current,
      version: current.version + 1,
      nodes: [...current.nodes, { kind: 'user', id: Date.now(), text: `accepted:${text}` }],
    })
  },
  cancel: () => {},
  exit: () => {},
  newSession: () => {},
  selectModel: () => {},
  setEffort: () => {},
  cycleSandbox: () => {
    sandbox = sandbox === 'read-only'
      ? 'workspace-write'
      : sandbox === 'workspace-write' ? 'danger-full-access' : 'read-only'
    const current = store.getSnapshot()
    store.set({ ...current, version: current.version + 1, sandbox })
    return sandbox
  },
  cancelResume: () => {},
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
  attachFile: () => Promise.resolve({ error: null, chip: '[Image #1]' }),
  attachFiles: () => Promise.resolve({ error: null, chips: ['[Image #1]'] }),
  listSessionReferences: () => Promise.resolve([]),
  attachClipboardImage: () => Promise.resolve({ error: null, chip: '[Image #1]' }),
  syncImageChips: (_previous, next) => next,
  forkSession: () => Promise.resolve(null),
}

const busyStartedAt = Date.now()
const busyTimer = process.env.TUI_PTY_BUSY === '1'
  ? setInterval(() => {
    const current = store.getSnapshot()
    const tick = current.stats.turns + 1
    store.set({
      ...current,
      version: current.version + 1,
      busy: true,
      live: { text: '', think: `fixture thinking ${tick}`, thinkSince: busyStartedAt },
      stats: { ...current.stats, turns: tick },
      todos: [
        { content: 'build', status: tick % 2 === 0 ? 'in_progress' : 'pending' },
        { content: 'test', status: tick % 3 === 0 ? 'completed' : 'pending' },
      ],
      goal: {
        objective: 'busy PTY fixture',
        phase: 'active',
        revision: tick,
        roundsStarted: tick,
        maxGoalRounds: 10_000,
        createdAt: busyStartedAt,
        updatedAt: Date.now(),
      },
    })
  }, updateMs)
  : undefined

await runInk(store, host)
if (busyTimer !== undefined) clearInterval(busyTimer)
if (memoryTimer !== undefined) clearInterval(memoryTimer)
