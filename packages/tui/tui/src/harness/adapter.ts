/**
 * UI-owned capability contract. No Agent, Session, Context or credentials cross
 * this seam. The official host bridge in index.ts implements it; renderer tests
 * can supply deterministic capabilities without booting another Harness runtime.
 * IDs and image resources are opaque; successful receipts are not task completion.
 */
import type { AppearanceId } from '../theme'

export type McpOperation = { action: 'add'; file: string } | { action: 'update'; id: string; file: string } | { action: 'enable' | 'disable' | 'reconnect' | 'remove'; id: string }

export type TuiPanelKind = 'rewind' | 'tool-source' | 'history-search' | 'settings' | 'tasks' | 'jobs' | 'subagents' | 'workflows' | 'sessions' | 'plugin-config'

export interface PluginUpdateState {
  name: string
  phase: 'installing' | 'applied' | 'pending-restart' | 'overridden' | 'failed' | 'cancelled'
  requestedVersion: string
  installedVersion?: string
  /** Last version acknowledged applied by the host; not proof it is still active after external changes. */
  loadedVersion?: string
  restartReason?: string
  error?: string
  rollbackSpec?: string
  rollback: 'not-needed' | 'available' | 'unknown'
}

/** Failure categories rendered into localized TUI notices by the caller. */
export type PluginToggleFailureCode =
  | 'entry-unavailable'
  | 'surface-owned'
  | 'profile-managed'
  | 'conditional'
  | 'dependency-blocked'
  | 'apply-failed'

/** Outcome of one serialized profile plugin toggle. */
export type PluginToggleResult =
  | { ok: true; enabled: boolean }
  | {
    ok: false
    code: PluginToggleFailureCode
    detail?: string
    blockers?: readonly string[]
    rollback?: 'failed' | 'not-needed' | 'preserved-concurrent-edit' | 'restored'
  }


/** Result of one host image intake attempt. */
export interface ImageAttachResult {
  /** Localized failure text, or null after the attachment entered the pending list. */
  error: string | null
  /** Stable chip label assigned by the host after a successful append. */
  chip?: string
  /** Clipboard probe found no image; callers may fall back to text paste. */
  empty?: boolean
}

/** Result of atomic admission for a pasted image-file batch. */
export interface ImageAttachBatchResult {
  error: string | null
  /** Host-assigned chips in input order after the whole batch succeeds. */
  chips?: readonly string[]
}

/** One cross-session completion row carrying the official canonical mention. */
export interface SessionReferenceEntry {
  label: string
  mention: string
  cwd?: string
}

/** Persisted or live panel whose data is refreshed on open or polling. */
export type TuiPanelRefreshKind = 'jobs' | 'subagents' | 'sessions'

/** Host callbacks the renderer drives; supplied by the plugin. */
export interface ToolSourcePage {
  callId: string
  status: string
  warnings: readonly string[]
  text: string
  offset: number
  nextOffset: number | null
  totalChars: number
}

export interface HarnessAdapter {
  editDraft?(text: string, signal?: AbortSignal): Promise<string>
  sendChild?(id: string, text: string, delivery: 'queue' | 'steer'): Promise<{ messageId: string }>
  removeBundle?(name: string): Promise<{ application: string; restartReason?: string; error?: string }>
  setBundleEnabled?(name: string, enabled: boolean): Promise<{ application: string; restartReason?: string; error?: string }>
  installPlugin?(name: string, exactVersion: string): Promise<PluginUpdateState>
  updatePlugin?(name: string, exactVersion: string): Promise<PluginUpdateState>
  readSessionSource?(offset?: number, size?: number, fresh?: boolean): Promise<ToolSourcePage>
  exportSessionSource?(): Promise<string>
  readToolSource?(callId: string, offset?: number, size?: number, fresh?: boolean): Promise<ToolSourcePage>
  exportToolSource?(callId: string): Promise<string>
  submit(text: string, steer: boolean): void | Promise<void>
  /** Export the redacted visible projection to a local text file. */
  exportTranscript?(): Promise<string>
  cancel(): void
  exit(): void
  listRewindPoints?(): readonly { atSeq: number; turn: number }[]
  rewindSession?(atSeq: number): Promise<string | null>
  newSession(): void
  /** Park this exact Agent in-process; no new writer for its session log. */
  backgroundSession?(): Promise<string | null>
  selectModel(provider: string, model: string, reasoningEffort?: string): void | Promise<void>
  /** `/effort off|low|high|max`: set or clear the reasoning effort on the current route. */
  setEffort(effort: string | undefined): void | Promise<void>
  /** Shift+Tab: rotate the session's file-policy mode; returns the new mode. */
  cycleSandbox(): 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Select the official session approval policy; the never policy rejects approval requests. */
  setPermissionDefault?(name: string): Promise<void>
  selectPermissionPreset?(name: string): void | Promise<void>
  setApprovalPolicy?(policy: 'ask' | 'never'): void | Promise<void>
  /** Abort an in-flight session resume fold. */
  cancelResume(): void
  approve(outcome: 'allowed-once' | 'rejected', requestId?: string): void
  answerQuestion(answers: { id: string; selected: string[]; custom?: string }[], requestId?: string): void
  /** Write one `tui` namespace setting (busyEnter / thinking / theme / locale). */
  updateSetting(patch: { taskNotifications?: 'off' | 'always'; busyEnter?: 'queue' | 'steer'; thinking?: 'collapsed' | 'expanded'; theme?: 'dark' | 'light'; appearance?: AppearanceId; locale?: 'zh' | 'en'; keymap?: 'legacy-dsh' | 'claude-fullscreen' }): Promise<void>
  /** Durably store one credential; the renderer never sees the previous value. */
  setCredential(ref: string, value: string): Promise<void>
  /** Remove one credential from the managed store. */
  unsetCredential(ref: string): Promise<void>
  /** Reload only the panel whose data is opening or polling. */
  refreshPanels(kind: TuiPanelRefreshKind): void
  /** Reload the /settings page data (settings panel open). */
  refreshSettings(): void
  /** Persist and hot-apply one host plugin's enabled state. */
  manageMcp?(request: McpOperation): Promise<string | null>
  togglePlugin(id: string): Promise<PluginToggleResult>
  /** Request one running job to stop. */
  killJob(id: string): void
  /** Create/replace/remove feedback for one assistant message (toggle on re-rate). */
  rateMessage(messageId: string, rating: 'positive' | 'negative'): Promise<string | null>
  /** Resume one persisted session onto the surface (null on success). */
  resumeSession(sessionId: string): Promise<string | null>
  /** Recompose the blank live session from one agent preset (null on success). */
  switchPreset(presetId: string): Promise<string | null>
  /** Write one field of a plugin's settings namespace (null on success). */
  updatePluginConfig(ns: string, patch: Record<string, unknown>): Promise<string | null>
  /** Rename the live session (explicit user title). */
  renameSession(title: string): Promise<string | null>
  /** Switch the workspace directory for this and future sessions. */
  changeWorkspace(path: string): Promise<string | null>
  /** Discover other sessions for the trailing `@token`. */
  listSessionReferences(query: string): Promise<readonly SessionReferenceEntry[]>
  /** Attach one image file to the next user message. */
  attachFile(path: string, signal?: AbortSignal): Promise<ImageAttachResult>
  /** Attach an ordered image-file batch without partially admitting it. */
  attachFiles(paths: readonly string[], signal?: AbortSignal): Promise<ImageAttachBatchResult>
  /** Attach a bitmap from the desktop clipboard (Windows: Alt+V). */
  attachClipboardImage(signal?: AbortSignal): Promise<ImageAttachResult>
  /** Drop pending images whose chips disappeared and return renumbered chip text. */
  restoreDraftImages?(resources: readonly string[]): void
  syncImageChips(previousDraft: string, nextDraft: string): string
  /** Fork the session at the last completed turn (or the turn containing atSeq). */
  forkSession(atSeq?: number): Promise<string | null>
  /** Boot-time panel request: open this panel (with an optional filter) once the app mounts. */
  startup?: { panel?: { kind: TuiPanelKind; filter?: string } }
}

/** Compatibility name retained for existing embedders and rendering fixtures. */
export type TuiHost = HarnessAdapter
