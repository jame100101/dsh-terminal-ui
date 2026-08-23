/**
 * Tiny external store bridging the Cordis event world (fold + agent status +
 * pending interactions) to the React world (Ink). Zero React imports:
 * `render.tsx` binds this with `useSyncExternalStore`.
 * @module @deepseek-ai/dsh-tui/src/store
 */

import { countUiPublish } from './tui-perf'
import type { GoalRow, LiveBuffer, PlanState, SessionStats, TodoItem, TraceEntry, TuiNode } from './types'

/** One editable top-level field of a plugin's settings namespace. */
export interface PluginConfigField {
  key: string
  /** Editable kind: boolean toggles, string/number/secret edit in the composer. */
  kind: 'boolean' | 'string' | 'number' | 'secret' | 'other'
  /** Current display value (secrets never cross this boundary). */
  display: string
}

/** One slash-picker entry (host command or TUI-local command). */
export interface CommandEntry {
  name: string
  description: string
  /** Whether accepting inserts a trailing space (the command takes input). */
  needsArgs: boolean
}

/** One human-invocable skill advertised beside commands in the slash picker. */
export interface SkillEntry {
  name: string
  description: string
  /** Whether the same skill is also available through the model-facing tool. */
  modelInvocable: boolean
}

/** One selectable model route for the /model dialog. */
export interface ModelEntry {
  provider: string
  model: string
  label: string
  /** True when `inputModalities` includes `image`. */
  acceptsImage?: boolean
}

/** One live agent or persisted-session row for /sessions. */
export interface SessionEntry {
  id: string
  model: string
  status: string
  /** Latest folded title snapshot text (persisted corpus rows). */
  title?: string
  /** Corpus facts: whether the id is live / persisted. */
  live?: boolean
  persisted?: boolean
  /** Header creation time in epoch ms (persisted corpus rows). */
  createdAt?: number
}

/** A pending inbox message preview for the queue dock. */
export interface QueuedEntry {
  text: string
  steer: boolean
}

/** A pending approval question occupying the composer. */
export interface PendingApproval {
  toolName: string
  reason?: string
}

/** A pending ask_user question occupying the composer. */
export interface PendingQuestion {
  questions: {
    id: string
    question: string
    detail?: string
    options?: { label: string; description?: string }[]
    multiSelect?: boolean
  }[]
}

/** The TUI's own general settings (namespace `tui` in `$DSH_HOME/settings.yaml`). */
export interface GeneralSettings {
  /** What plain Enter means while a turn runs: queue behind it or steer it. */
  busyEnter: 'queue' | 'steer'
  /** Whether think rows start expanded without an explicit toggle. */
  thinking: 'collapsed' | 'expanded'
  /** Terminal palette: dark (bright ANSI remap) or light (bright-on-light remap). */
  theme: 'dark' | 'light'
  /** UI chrome language. */
  locale: 'zh' | 'en'
}

/** Value-free credential view: never carries the secret itself. */
export interface CredentialRow {
  ref: string
  configured: boolean
  source?: string
  writable: boolean
}

/** One provider group on the /settings models page. */
export interface SettingsProviderRow {
  provider: string
  models: { id: string; acceptsImage?: boolean }[]
}

/** One pending composer image chip (Grok `[Image #N]`). */
export interface PendingImageChip {
  chip: string
  name: string
  bytes: number
  width: number
  height: number
  mediaType: string
}

/** One plugin row on the /settings plugins page (loader-tree inventory). */
export interface SettingsPluginRow {
  id: string
  name: string
  enabled: boolean
  loaded: boolean
  /** The plugin's own settings namespace, when one matches the entry id. */
  namespace?: string
}

/** One selectable agent preset on the /settings presets page. */
export interface SettingsPresetRow {
  /** Stable id (the preset directory's name). */
  id: string
  /** Display name from the preset's metadata; absent falls back to the id. */
  name: string
  /** `system` ships with the deployment; `user` was authored locally. */
  trust: 'system' | 'user'
  /** Why this preset cannot compose a session, absent when usable. */
  broken?: string
}

/** One registered settings namespace on the /settings inventory page. */
export interface SettingsNamespaceRow {
  ns: string
  applies: string
  revision: number
  secretSlots: number
  secretSet: number
}

/** Everything the /settings five pages render, loaded by the plugin. */
export interface SettingsData {
  general: GeneralSettings
  models: {
    providers: readonly SettingsProviderRow[]
    credentials: readonly CredentialRow[]
  }
  plugins: readonly SettingsPluginRow[]
  /** Per-namespace editable top-level fields (plugin config editors). */
  configs: Readonly<Record<string, readonly PluginConfigField[]>>
  inventory: {
    namespaces: readonly SettingsNamespaceRow[]
    credentials: readonly CredentialRow[]
    inspectProviders: number
  }
  /** Agent presets the roster currently supplies (presets page). */
  presets: readonly SettingsPresetRow[]
  /** The preset the surface's session currently runs, when any. */
  currentPreset: string | undefined
}

/** One background job row for the /jobs panel. */
export interface JobRow {
  id: string
  kind: string
  label: string
  status: string
  detail?: string
  /** Wall-clock elapsed ms since registration (bounded by the panel tick). */
  elapsedMs: number
}

/** One durable subagent tree entry for the /subagents panel. */
export interface SubagentRow {
  id: string
  /** Display label, or the diagnostic reason for uninterpretable entries. */
  label: string
  /** `one-shot` / `continuable`, or `diagnostic`. */
  mode: string
  /** `running` / `inactive` / `diagnostic`. */
  activity: string
  /** Edge distance from the root session. */
  depth: number
}

/** One workflow run row for the /workflows panel (event-driven projection). */
export interface WorkflowRow {
  id: string
  name: string
  status: 'running' | 'completed' | 'cancelled' | 'error'
  phase?: string
  lastLog?: string
  agentsStarted: number
  error?: string
}

/** One durable feedback item for an assistant message (value-only view). */
export interface FeedbackItem {
  messageId: string
  rating: 'positive' | 'negative'
  note?: string
  /** Opaque compare-and-set token required by the next mutation. */
  version: string
}

/** Immutable render snapshot published on every fold or status change. */
export interface TuiSnapshot {
  /** Bumped on every publish; lets consumers skip no-op redraws. */
  version: number
  nodes: readonly TuiNode[]
  trace: readonly TraceEntry[]
  todos: readonly TodoItem[]
  stats: SessionStats
  live: LiveBuffer | null
  busy: boolean
  /** Provider route paired with `model`. */
  provider: string
  model: string
  sessionId: string
  cwd: string
  pendingApproval: PendingApproval | null
  pendingQuestion: PendingQuestion | null
  commands: readonly CommandEntry[]
  /** User-invocable skills resolved in the current agent/preset scope. */
  skills: readonly SkillEntry[]
  models: readonly ModelEntry[]
  sessions: readonly SessionEntry[]
  queued: readonly QueuedEntry[]
  /** Loaded /settings page data; null until the first load settles. */
  settings: SettingsData | null
  /** /jobs panel rows (recomputed on every publish). */
  jobs: readonly JobRow[]
  /** /subagents panel rows (loaded at boot and on panel open). */
  subagents: readonly SubagentRow[]
  /** /workflows panel rows (event-driven). */
  workflows: readonly WorkflowRow[]
  /** Per-message feedback by message id (host-loaded, value-only). */
  feedback: ReadonlyMap<string, FeedbackItem>
  /** Plan-mode facts folded from the session log. */
  plan: PlanState
  /** The current durable goal, or null. */
  goal: GoalRow | null
  /** Reasoning-effort selection for the current model route. */
  reasoning: { effort: string | undefined; levels: readonly string[] }
  /** Image attachments queued for the next user message. */
  attachmentCount: number
  /** Grok-style chips for the pending images (name, pixels, bytes). */
  pendingImages: readonly PendingImageChip[]
  /** Whether a compaction run is in flight (drives the live gradient row). */
  compaction: boolean
  /** The resolved session file-policy mode (sandbox/mode override or default). */
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Web-parity context occupancy projection; null without the projection service. */
  occupancy: { projectedTokens: number; contextWindow: number } | null
}

/** Minimal subscribe/getSnapshot store contract for useSyncExternalStore. */
export interface TuiStore {
  getSnapshot(): TuiSnapshot
  subscribe(listener: () => void): () => void
  set(next: TuiSnapshot): void
}

/**
 * Create the UI store with its first snapshot.
 * @param initial - the boot snapshot.
 * @returns the store.
 */
export function createTuiStore(initial: TuiSnapshot): TuiStore {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      if (next.version === snapshot.version) return
      snapshot = next
      countUiPublish()
      for (const listener of [...listeners]) listener()
    },
  }
}
