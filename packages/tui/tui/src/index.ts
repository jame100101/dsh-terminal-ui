/**
 * @deepseek-ai/dsh-tui — the in-process terminal surface over the dsh core.
 * Creates one process-wide Agent through the core registry, folds its
 * event-sourced session log into transcript rows enriched with tool
 * render-intent cards, and drives either the Ink full-screen renderer (TTY)
 * or a line-driven fallback (pipes/CI).
 *
 * The plugin registers no tools, no prompt sections, and no providers that
 * alter requests: the approval answerer and user-questions provider only
 * ANSWER interactive questions, so the request envelope stays byte-identical
 * to the surface-less composition (KV-cache-safe by construction). In the
 * non-TTY fallback no answerer mounts at all — asks fail closed, matching
 * headless-strict semantics.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader/cmdline/approval/questions/commands/llm/
// tools Context merges the optional-service reads below depend on.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
// Empty import carries the workflow event-vocabulary merge the run listeners
// below consume.
import type {} from '@deepseek-ai/dsh-workflow'
// Empty imports carry the message-feedback/plan/goal Context and event
// merges the fold and the optional service reads below consume.
import type {} from '@deepseek-ai/dsh-message-feedback'
import type { MessageFeedbackItem } from '@deepseek-ai/dsh-message-feedback/types'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-attachment'
// Empty import carries the agent-presets Context merge and the
// `agent-preset/selected` session-event vocabulary the preset rows below read.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-app-boot'
// Empty type imports carry the sandbox-policy Context merge, the
// session-projection registry merge, and the token-meter `contextPressure`
// SessionProjectionMap key the publish path reads.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-token-meter'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-reference'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { SANDBOX_MODES, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import {
  anchorRetry, applyEvent, createScratch, decodeToolResult, foldFromLogYielding,
  initialState, rememberToolCallCard,
} from './fold'
import type { FoldScratch } from './fold'
import type { FoldState } from './types'
import { renderAssistantResultPlain, renderNodePlain } from './plain'
import { collectCredentialRefs, collectPluginFields, groupProviders, sessionTitlesById } from './settings-data'
import { createTuiStore } from './store'
import type { PendingImageChip } from './store'
import {
  attachmentsForSubmit, formatByteSize, imageChip, mediaTypeFromPath, modelRouteAcceptsImages,
  reconcileImageChips, rejectImageBatch, sniffMediaType, stripImageChips,
} from './image-intake'
import { readClipboardImage } from './image-clipboard'
import { createTuiUserMessage, encodeTuiCommandImages } from './image-submit'
import { compactCallCard, compactResultCard } from './card-project'
import { createUiPublishScheduler, shouldCoalesceSessionEvent, shouldPublishCoalescedFold } from './ui-publish'
import { selectPanelSnapshot } from './publish-snapshot'
import { buildTuiStartupProgram, parseTuiStartupIntent } from './startup-args'
import type { StartupIntent } from './startup-args'
import {
  createForkArtifact,
  createTuiAgent,
  createWorkflowProjection,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  foldWorkflowSessionEvents,
  lastTurnNumber,
  mapTurnEndToExitCode,
  prepareTuiResume,
  projectJobsRows,
  projectWorkflowSessionDelivery,
  recordedPreset,
  replayTuiResumeOrDispose,
  resolveContinueSession,
  resolveResumeTarget,
  resolveTuiReasoning,
  SessionPresetQueue,
  subscribeVisibleJobs,
  turnEndReasonAfter,
} from './harness'
import type { ResumeCandidate, ResumeResolution } from './harness'
import { SessionRecencyStore } from './session-recency'
import { ProjectionSidecarStore, foldIsIdle, projectionCheckpointIsComplete } from './projection-sidecar'
import {
  hasConditionalDisabledState,
  isProfilePatchEntry,
  pluginDisableBlockers,
  pluginInventoryEntries,
} from './patch-toggle'
import { toggleProfilePlugin } from './plugin-toggle-runtime'
import type {
  CommandEntry, CredentialRow, GeneralSettings, JobRow, ModelEntry, PendingApproval, PendingQuestion, SessionEntry,
  SettingsData, SkillEntry, SubagentRow, TuiStore, WorkflowRow,
} from './store'

/** Stable Cordis plugin name. */
export const name = 'tui'

/** Core services required before the surface can mount. */
export const inject = ['agents', 'agentDefaultModel', 'tools', 'settings', 'credentials', 'messageFeedback', 'sessionQuery', 'sessionTitle', 'attachments', 'sandboxPolicy']

/** Default maximum number of foreground-session observations retained by the TUI. */
export const DEFAULT_SESSION_RECENCY_MAX_ENTRIES = 1_000
/** Default time allowed for a profile-patch plugin toggle to hot-apply. */
export const DEFAULT_PLUGIN_TOGGLE_SETTLE_TIMEOUT_MS = 60_000

/** TUI plugin configuration. */
export interface Config {
  /** Maximum lifecycle observations in the TUI-owned session recency sidecar. */
  sessionRecencyMaxEntries?: number
  /** Absolute live user profile patch path; omission keeps plugin rows read-only. */
  profilePatchPath?: string
  /** Loader entry ids whose enabled state belongs to the profile composition. */
  pluginToggleProtectedIds?: string[]
  /** Maximum wait for one plugin toggle's Loader lifecycle to settle. */
  pluginToggleSettleTimeoutMs?: number
}

/** Validated TUI plugin configuration schema. */
export const Config: z<Config> = z.object({
  sessionRecencyMaxEntries: z.number().step(1).min(1).default(DEFAULT_SESSION_RECENCY_MAX_ENTRIES),
  profilePatchPath: z.string().required(false),
  pluginToggleProtectedIds: z.array(z.string()).default([]),
  pluginToggleSettleTimeoutMs: z.number().step(1).min(1).default(DEFAULT_PLUGIN_TOGGLE_SETTLE_TIMEOUT_MS),
})

/** Localized copy for a rejected feedback mutation. */
function feedbackErrorText(error: { code: string }, locale: 'zh' | 'en'): string {
  if (locale === 'en') {
    switch (error.code) {
      case 'session-not-found': return 'The session is not persisted yet; feedback was not recorded'
      case 'target-not-found': return 'The message is not a rateable final assistant message'
      case 'note-blank': return 'The feedback note must not be blank'
      case 'note-too-large': return 'The feedback note is too long'
      default: return 'Failed to write feedback'
    }
  }
  switch (error.code) {
    case 'session-not-found': return '会话尚未持久化，无法记录反馈'
    case 'target-not-found': return '该消息不是可评分的助手最终消息'
    case 'note-blank': return '反馈说明不能为空'
    case 'note-too-large': return '反馈说明过长'
    default: return '反馈写入失败'
  }
}

/** Image media types the attach command accepts, by file extension. */
const IMAGE_MEDIA_BY_EXT: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Project pending refs into Grok chips for the dock. */
function pendingImageChips(refs: readonly ImageAttachmentRef[]): PendingImageChip[] {
  return refs.map((ref, index) => ({
    chip: imageChip(index),
    name: ref.name ?? `image-${index + 1}`,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    mediaType: ref.mediaType,
  }))
}

/** Process-facing facts the surface owns across publishes. */
interface Surface {
  fold: FoldState
  scratch: FoldScratch
  version: number
  busy: boolean
  agent: Agent
  selection: ModelSelectionRef
  currentModel: string
  commands: CommandEntry[]
  skills: SkillEntry[]
  models: ModelEntry[]
  pendingApproval: PendingApproval | null
  pendingQuestion: PendingQuestion | null
  approvalResolve: ((outcome: 'allowed-once' | 'rejected') => void) | null
  questionResolve: ((answers: { id: string; selected: string[]; custom?: string }[]) => void) | null
  /** Loaded /settings page data; refreshed on settings and credential events. */
  settings: SettingsData | null
  /** /jobs panel rows (recomputed on every publish). */
  jobs: JobRow[]
  /** /subagents panel rows (loaded at boot and on panel open). */
  subagents: SubagentRow[]
  /** /workflows panel rows, keyed by run id (event-driven). */
  workflows: Map<string, WorkflowRow>
  /** Per-message feedback by message id; replaced on every mutation. */
  feedback: Map<string, MessageFeedbackItem>
  /** Reasoning-effort selection and the current route's exposed levels. */
  reasoning: { effort: string | undefined; levels: string[] }
  /** Image attachments queued for the next user message. */
  pendingAttachments: ImageAttachmentRef[]
  /** The surface's working directory (workspace). */
  cwd: string
  /** Fold replay progress while a session is resuming. */
  resumeProgress: { done: number; total: number } | null
}

/** Whether one asynchronous resume generation lost ownership before commit. */
function resumeWasCancelled(signal: AbortSignal, generation: number, currentGeneration: number): boolean {
  return signal.aborted || generation !== currentGeneration
}

/** Resolve the current agent scope's human-invocable skill catalog. */
async function loadSkillEntries(ctx: Context, surface: Surface): Promise<SkillEntry[]> {
  const skills = ctx.get('skills')
  if (skills === undefined) return []
  const entries = await skills.list({ cwd: surface.cwd, scope: surface.agent })
  return entries.filter(isUserInvocable).map(skill => ({
    name: skill.name,
    description: skill.description,
    modelInvocable: skill.invocation.modelInvocable,
  }))
}

/**
 * Read the Web-parity context occupancy for one session from the
 * token-meter's `contextPressure` projection: `projectedTokens` over the
 * newest known `contextWindow`. The projection answers for the NEXT request
 * — a compaction's surface replacement shrinks the running surface total
 * immediately, so the value drops live, exactly like the Web strip. Null
 * when the projection service (or the token-meter unit) is absent.
 * @param ctx - plugin context carrying the optional registry.
 * @param session - the surface agent's session.
 * @returns the occupancy pair, or null when unavailable.
 */
function readOccupancy(ctx: Context, session: Session): { projectedTokens: number; contextWindow: number } | null {
  const projections = ctx.get('sessionProjections') as SessionProjectionRegistry | undefined
  if (projections === undefined) return null
  try {
    const pressure = projections.snapshot(session).values.contextPressure
    if (pressure === undefined || pressure.projectedTokens === undefined || pressure.contextWindow === undefined) return null
    return { projectedTokens: pressure.projectedTokens, contextWindow: pressure.contextWindow }
  } catch {
    // A projection drive racing teardown must not disturb the surface.
    return null
  }
}

/**
 * Load the /sessions rows: live agents plus the newest 50 persisted-corpus
 * records with their latest folded titles. Fails soft to the live list when
 * the query service or any title read rejects.
 */
async function loadSessionRows(ctx: Context, liveRows: readonly SessionEntry[]): Promise<SessionEntry[]> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return [...liveRows]
  try {
    const records = await query.listSessions()
    const newest = records.slice(0, 50)
    // Titles fold once for every requested session. The live rows are usually
    // already among `newest`, and the corpus filter below drops live ids from
    // `newest` afterwards — so titles must be keyed BY SESSION ID, never read
    // by position: index-aligned lookups shifted by one for every corpus row
    // after a live record (the first-open bug where Enter resumed the NEXT
    // session below the selected one).
    const liveIds = liveRows.map(row => SessionId(row.id))
    const titles = sessionTitlesById(await query.readTitleSnapshots([...newest.map(record => record.header.id), ...liveIds]))
    const live = liveRows.map((row) => {
      const title = titles.get(row.id)
      return title === undefined ? row : { ...row, title }
    })
    const corpus: SessionEntry[] = newest
      .filter(record => !liveIds.includes(record.header.id))
      .map((record) => {
        const title = titles.get(record.header.id)
        return {
          id: record.header.id,
          model: '',
          status: record.live ? 'running' : 'persisted',
          ...(title === undefined ? {} : { title }),
          live: record.live,
          persisted: record.persisted,
          createdAt: record.header.createdAt,
        }
      })
    return [...live, ...corpus]
  } catch {
    return [...liveRows]
  }
}

/**
 * Attach the tool's presentCall/presentResult card to the folded tool row.
 * `tool/call` runs after `applyEvent` (the new running row is last).
 * `tool/result` runs before `applyEvent` so `presentResult` can still read
 * `args` on the running row; `applyEvent` then drops `args` and the call view.
 */
function enrichToolCards(ctx: Context, event: SessionEvent, fold: FoldState): void {
  const tools = ctx.get('tools')
  if (tools === undefined) return
  if (event.type === 'tool/call' || event.type === 'tool/code-dispatch-start') {
    const node = fold.nodes[fold.nodes.length - 1]
    if (node === undefined || node.kind !== 'tool') return
    const definition = tools.get(event.data.name)
    if (definition !== undefined && definition.presentCall !== undefined) {
      try {
        node.callCard = compactCallCard(definition.presentCall(node.args) ?? null)
      } catch {
        node.callCard = null
      }
    }
    return
  }
  let callId = ''
  let result: ToolResult | undefined
  if (event.type === 'tool/result') {
    const decoded = decodeToolResult(event)
    if (decoded === null) return
    callId = decoded.callId
    result = {
      content: decoded.content,
      isError: decoded.isError,
      ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
    }
  } else if (event.type === 'tool/code-dispatch') {
    callId = String(event.data.subCallId)
    result = { content: event.data.content, isError: event.data.isError }
  } else {
    return
  }
  // Result events run before applyEvent so presentResult can still read args.
  for (let index = fold.nodes.length - 1; index >= 0; index--) {
    const node = fold.nodes[index]
    if (node === undefined || node.kind !== 'tool' || node.status !== 'running') continue
    if (callId !== '' && node.callId !== callId) continue
    const definition = tools.get(node.name)
    if (definition !== undefined && definition.presentResult !== undefined && result !== undefined) {
      try {
        node.resultCard = compactResultCard(definition.presentResult(node.args, result) ?? null)
      } catch {
        node.resultCard = null
      }
    }
    break
  }
}

/** Read pending inbox previews for the queue dock (best-effort projection). */
function queuedEntries(agent: Agent): { text: string; steer: boolean }[] {
  const inbox = agent.inbox as unknown as {
    nextTurn?: readonly { content?: readonly { type?: string; text?: string }[] }[]
    nextStep?: readonly { content?: readonly { type?: string; text?: string }[] }[]
  }
  const textOf = (message: { content?: readonly { type?: string; text?: string }[] } | undefined): string =>
    (message?.content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('')
      .slice(0, 60)
  return [
    ...(inbox.nextStep ?? []).map(message => ({ text: textOf(message), steer: true })),
    ...(inbox.nextTurn ?? []).map(message => ({ text: textOf(message), steer: false })),
  ]
}

/**
 * Project the /settings four pages from the live services. Credential rows
 * stay value-free: the walker reads only reference names, and
 * `credentials.describe` reports configured/source/writable without the value.
 * @param ctx - plugin context.
 * @param surface - the surface whose model routes group into the models page.
 * @param tuiScope - the registered `tui` settings scope.
 * @returns the complete settings page data.
 */
async function loadSettingsData(
  ctx: Context,
  surface: Surface,
  tuiScope: SettingsScope<{ busyEnter: 'queue' | 'steer'; thinking: 'collapsed' | 'expanded' }>,
  config: Config,
): Promise<SettingsData> {
  const descriptors = ctx.settings.describe({ redactSecrets: true })
  const loaderEntries = [...ctx.loader.entries()]
  const protectedPluginIds = new Set(config.pluginToggleProtectedIds ?? [])
  const refs = new Map<string, string[]>()
  for (const descriptor of descriptors) {
    for (const slot of collectCredentialRefs(descriptor.schema, descriptor.value)) {
      if (slot.ref !== '' && !refs.has(slot.ref)) refs.set(slot.ref, slot.path)
    }
  }
  const credentialRows: CredentialRow[] = []
  for (const ref of refs.keys()) {
    try {
      const info = await ctx.credentials.describe(credentialRef(ref))
      credentialRows.push({
        ref,
        configured: info.configured,
        ...(info.source === undefined ? {} : { source: info.source }),
        writable: info.writable,
      })
    } catch {
      // A provider removed mid-read must not blank the whole page.
      credentialRows.push({ ref, configured: false, writable: false })
    }
  }
  const general = tuiScope.get() as GeneralSettings
  const inspect = ctx.get('cordisInspect') as { list(): readonly unknown[] } | undefined
  // The preset roster is optional (the tui profile mounts it; a bare profile
  // does not): the presets page degrades to its empty placeholder when the
  // service is absent, and a failed roster read must not blank the whole page.
  const presetService = ctx.get('agentPresets') as {
    list(): Promise<{ id: string; name?: string; trust: 'system' | 'user'; broken?: string }[]>
  } | undefined
  let presetRows: { id: string; name: string; trust: 'system' | 'user'; broken?: string }[] = []
  if (presetService !== undefined) {
    try {
      presetRows = (await presetService.list()).map(preset => ({
        id: preset.id,
        name: preset.name ?? preset.id,
        trust: preset.trust,
        ...(preset.broken === undefined ? {} : { broken: preset.broken }),
      }))
    } catch {
      // A roster read racing a preset edit must not blank the whole page.
    }
  }
  return {
    general,
    models: {
      providers: groupProviders(surface.models),
      credentials: credentialRows,
    },
    plugins: pluginInventoryEntries(loaderEntries)
      // The Loader can expose the same bare id from the host composition and
      // one or more Agent preset trees. The settings list is unique by id;
      // only the root boot Include is writable through this profile patch.
      .map((entry) => {
        const descriptor = descriptors.find(candidate => candidate.ns === entry.options.id)
        let toggleBlockedReason: 'conditional' | 'dependency' | 'managed' | 'surface' | 'unavailable' | undefined
        if (config.profilePatchPath === undefined) toggleBlockedReason = 'unavailable'
        else if (entry.options.id === name) toggleBlockedReason = 'surface'
        else if (!isProfilePatchEntry(entry)) toggleBlockedReason = 'managed'
        else if (protectedPluginIds.has(entry.options.id)) toggleBlockedReason = 'managed'
        else if (hasConditionalDisabledState(entry)) toggleBlockedReason = 'conditional'
        else if (!entry.disabled && pluginDisableBlockers(loaderEntries, entry).length > 0) {
          toggleBlockedReason = 'dependency'
        }
        return {
          // The BARE id is what the profile patch layer targets; the runtime
          // `entry.id` carries the include tree's prefix.
          id: entry.options.id,
          name: entry.options.name,
          enabled: !entry.disabled,
          loaded: entry.fiber !== undefined,
          toggleable: toggleBlockedReason === undefined,
          ...(toggleBlockedReason === undefined ? {} : { toggleBlockedReason }),
          ...(descriptor === undefined ? {} : { namespace: descriptor.ns }),
        }
      }),
    configs: Object.fromEntries(
      descriptors.map(descriptor => [descriptor.ns, collectPluginFields(descriptor.schema, descriptor.value, general.locale)]),
    ),
    inventory: {
      namespaces: descriptors.map(descriptor => ({
        ns: descriptor.ns,
        applies: descriptor.applies,
        revision: descriptor.revision,
        secretSlots: descriptor.secrets?.length ?? 0,
        secretSet: descriptor.secrets?.filter(secret => secret.set).length ?? 0,
      })),
      credentials: credentialRows,
      inspectProviders: inspect?.list().length ?? 0,
    },
    presets: presetRows,
    currentPreset: recordedPreset(surface.agent.session.header, surface.agent.session.snapshotEvents()),
  }
}

/**
 * Project the /jobs panel rows from the live registry (sync, in-memory).
 * @param ctx - plugin context.
 * @param now - current epoch ms.
 * @returns one row per registered job.
 */
function jobsRows(ctx: Context, agent: Agent, now: number): JobRow[] {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) return []
  return projectJobsRows(jobs, agent, now)
}

/**
 * Project the /subagents panel rows from the durable descendant tree of the
 * surface's own agent.
 * @param ctx - plugin context.
 * @param rootSessionId - the surface agent's session id.
 * @returns one row per child, depth-ordered.
 */
async function subagentRows(ctx: Context, rootSessionId: SessionId): Promise<SubagentRow[]> {
  const subagents = ctx.get('subagents') as {
    listDescendants(root: SessionId): Promise<readonly SubagentDescendantListEntry[]>
  } | undefined
  if (subagents === undefined) return []
  try {
    const entries = await subagents.listDescendants(rootSessionId)
    return entries.map((entry): SubagentRow => entry.kind === 'child'
      ? {
        id: entry.id,
        label: entry.mode === 'continuable' ? entry.label : (entry.label ?? entry.id),
        mode: entry.mode,
        activity: entry.activity,
        depth: entry.depth,
      }
      : { id: entry.id, label: entry.reason, mode: 'diagnostic', activity: 'diagnostic', depth: entry.depth })
  } catch {
    // A listing racing teardown must not blank the panel.
    return []
  }
}

/**
 * Subscribe the fold and busy status to the Cordis event world through the
 * same raw `internal/dispatch` global channel the invariant companions use,
 * refresh the settings pages on settings/credential commits, and fold durable
 * workflow session events into /workflows rows.
 * @param ctx - plugin context.
 * @param store - the UI store to publish into.
 * @param surface - mutable surface facts.
 * @param refreshSettings - reloads and publishes the /settings page data.
 * @param foldSidecar - TUI fold projection sidecar.
 * @returns the disposer.
 */
function subscribe(
  ctx: Context,
  store: TuiStore,
  surface: Surface,
  refreshSettings: () => void,
  foldSidecar: ProjectionSidecarStore,
): () => void {
  const publish = (reusePanels = false): void => {
    const previous = store.getSnapshot()
    surface.version += 1
    const panels = selectPanelSnapshot(previous, reusePanels, () => ({
      commands: surface.commands,
      skills: surface.skills,
      models: surface.models,
      sessions: ctx.agents.list().map((agent): SessionEntry => ({
        id: agent.id,
        model: agent.options.model ?? '',
        status: agent.status,
      })),
      queued: queuedEntries(surface.agent),
      settings: surface.settings,
      jobs: jobsRows(ctx, surface.agent, Date.now()),
      subagents: surface.subagents,
      workflows: [...surface.workflows.values()],
      feedback: surface.feedback,
      reasoning: surface.reasoning,
      attachmentCount: surface.pendingAttachments.length,
      pendingImages: pendingImageChips(surface.pendingAttachments),
      sandbox: ctx.sandboxPolicy.resolve({ session: surface.agent.session }).mode,
      occupancy: readOccupancy(ctx, surface.agent.session),
    }))
    store.set({
      version: surface.version,
      nodes: surface.fold.nodes,
      trace: surface.fold.trace,
      todos: surface.fold.todos,
      stats: surface.fold.stats,
      live: surface.fold.live,
      busy: surface.busy || surface.agent.status === 'running',
      provider: (surface.selection.current ?? ctx.agentDefaultModel.currentSelection()).provider,
      model: surface.currentModel,
      sessionId: surface.agent.id,
      cwd: surface.cwd,
      pendingApproval: surface.pendingApproval,
      pendingQuestion: surface.pendingQuestion,
      plan: surface.fold.plan,
      goal: surface.fold.goal,
      compaction: surface.fold.compaction,
      resumeProgress: surface.resumeProgress,
      ...panels,
    })
    if (foldIsIdle(surface.fold) && !surface.busy && projectionCheckpointIsComplete(surface.agent.session.snapshotEvents())) {
      const last = surface.agent.session.snapshotEvents().at(-1)
      foldSidecar.write(surface.agent.session.header, last?.seq ?? 0, surface.fold)
    }
  }
  const uiPublish = createUiPublishScheduler(() => { publish(true) })
  const off = ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'session/event') {
      // Only the surface's own session feeds the fold: a foreign agent's
      // events (a leaked lifecycle or a fork racing a switch) must never
      // scramble the visible transcript or collide on node ids.
      const session = (args as unknown[])[0] as Session | undefined
      if (session !== surface.agent.session) return
      const event = (args as unknown[])[1] as SessionEvent
      // presentResult needs the running row's args; applyEvent drops them.
      if (event.type === 'tool/result' || event.type === 'tool/code-dispatch') {
        enrichToolCards(ctx, event, surface.fold)
      }
      // Workflow rows are owned by the durable event stream of this exact
      // Session, not by the process-global workflow lifecycle channel.
      const workflowUpdate = projectWorkflowSessionDelivery(
        surface.agent.session,
        session,
        surface.workflows,
        event,
      )
      if (workflowUpdate !== null) {
        surface.workflows = workflowUpdate
      }
      const previousFold = surface.fold
      surface.fold = applyEvent(surface.fold, event, surface.scratch)
      if (event.type === 'tool/call' || event.type === 'tool/code-dispatch-start') {
        enrichToolCards(ctx, event, surface.fold)
        const node = surface.fold.nodes[surface.fold.nodes.length - 1]
        if (node?.kind === 'tool') {
          const callId = event.type === 'tool/call' ? String(event.data.callId) : String(event.data.subCallId)
          rememberToolCallCard(surface.scratch, callId, node.callCard)
        }
      }
      anchorRetry(surface.fold, event)
      if (shouldCoalesceSessionEvent(event)) {
        if (!shouldPublishCoalescedFold(previousFold, surface.fold)) return
        uiPublish.request(false)
      } else {
        uiPublish.dispose()
        publish()
      }
      return
    }
    if (eventName === 'agent/status') {
      // Only the surface's own agent drives the busy flag; a leaked agent
      // running its loop must not mark this surface busy.
      const payload = (args as unknown[])[0] as { agent?: unknown; status?: unknown } | undefined
      if (payload?.agent !== surface.agent) return
      surface.busy = payload.status === 'running'
      uiPublish.dispose()
      publish()
    }
  }, { global: true })
  // The occupancy projection can change on the same session event the fold
  // just handled; re-publish on its change feed so the strip reflects the
  // post-compaction surface immediately, not one event later.
  const projections = ctx.get('sessionProjections') as SessionProjectionRegistry | undefined
  const offOccupancy = projections === undefined
    ? (): void => {}
    : projections.onChanged((session, key) => {
      if (key !== 'contextPressure' || session !== surface.agent.session) return
      publish()
    })
  const offSettings = ctx.on('settings/updated', refreshSettings)
  const offCredentialReference = ctx.on('credentials/reference-updated', refreshSettings)
  const offCredentialRecord = ctx.on('credentials/record-updated', refreshSettings)
  const jobs = ctx.get('jobs')
  const offJobsChanged = jobs === undefined
    ? (): void => {}
    : subscribeVisibleJobs(jobs, () => surface.agent, publish)
  publish()
  return () => {
    uiPublish.flush()
    uiPublish.dispose()
    off()
    offSettings()
    offCredentialReference()
    offCredentialRecord()
    offOccupancy()
    offJobsChanged()
  }
}

/** Mount the interactive answerers; in the non-TTY fallback none mount. */
function mountAnswerers(ctx: Context, store: TuiStore, surface: Surface): void {
  const approval = ctx.get('approval')
  if (approval !== undefined) {
    ctx.on('approval/request', (req, next) => {
      if (req.agent !== surface.agent) return next()
      // A second concurrent question cannot be presented; fail it closed.
      if (surface.pendingApproval !== null) return Promise.resolve('rejected' as const)
      return new Promise<'allowed-once' | 'rejected'>((resolve) => {
        surface.approvalResolve = resolve
        surface.pendingApproval = {
          toolName: req.toolName,
          ...(req.reason === undefined ? {} : { reason: req.reason }),
        }
        surface.version += 1
        store.set({ ...store.getSnapshot(), pendingApproval: surface.pendingApproval, version: surface.version })
        // The answerer race: the service settles 'cancelled' on signal abort;
        // clear the overlay so the UI does not hold a dead question.
        req.signal?.addEventListener('abort', () => {
          if (surface.pendingApproval !== null) {
            surface.pendingApproval = null
            surface.approvalResolve = null
            surface.version += 1
            store.set({ ...store.getSnapshot(), pendingApproval: null, version: surface.version })
          }
        }, { once: true })
      })
    })
  }
  if (ctx.get('userQuestions') !== undefined) {
    ctx.on('user-questions/request', request => new Promise((resolve) => {
      surface.questionResolve = answers => resolve({ answers })
      surface.pendingQuestion = {
        questions: request.questions.map(question => ({
          id: question.id,
          question: question.question,
          ...(question.detail === undefined ? {} : { detail: question.detail }),
          ...(question.options === undefined ? {} : { options: question.options }),
          ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
        })),
      }
      surface.version += 1
      store.set({ ...store.getSnapshot(), pendingQuestion: surface.pendingQuestion, version: surface.version })
      request.signal?.addEventListener('abort', () => {
        if (surface.pendingQuestion !== null) {
          surface.pendingQuestion = null
          surface.questionResolve = null
          surface.version += 1
          store.set({ ...store.getSnapshot(), pendingQuestion: null, version: surface.version })
        }
      }, { once: true })
    }))
  }
}

/** Request process exit through the launcher-provided host value (bounded shutdown). */
function requestExit(ctx: Context, code: number): void {
  ctx.get('appExit')?.(code)
}

/** Report a boot or surface failure and request a failing exit. */
function fail(ctx: Context, error: unknown, code: number = EXIT_FAILURE): void {
  console.error(`dsh: ${error instanceof Error ? error.message : String(error)}`)
  requestExit(ctx, code)
}

/** Discover the selectable model routes from the registered LLM adapters. */
async function loadModels(ctx: Context, current: { provider: string; model: string }): Promise<ModelEntry[]> {
  const llm = ctx.get('llm')
  if (llm === undefined) return [{ provider: current.provider, model: current.model, label: `${current.provider}/${current.model}` }]
  const entries: ModelEntry[] = []
  for (const provider of llm.listProviders()) {
    try {
      const models = await llm.listModels(provider.id)
      for (const model of models) {
        entries.push({
          provider: provider.id,
          model: model.id,
          label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
          ...(model.inputModalities?.includes('image') === true ? { acceptsImage: true } : {}),
        })
      }
    } catch {
      // A provider that cannot list models still routes; skip its catalog.
    }
  }
  if (entries.length === 0) {
    entries.push({ provider: current.provider, model: current.model, label: `${current.provider}/${current.model}` })
  }
  return entries
}

/**
 * Read the launcher's inner argv into a startup intent. Embeddings without a
 * launcher (tests, bare trees) parse the empty argument list into the
 * default interactive intent; the launcher path runs the grammar through
 * `parseCmdline`, whose help/version/usage handling requests process exit
 * itself and yields null — boot must stop without creating a surface.
 * @param ctx - plugin context carrying the optional cmdline host values.
 * @returns the intent, or null when the invocation already exited.
 */
function readStartupIntent(ctx: Context): StartupIntent | null {
  const args = ctx.get('cmdlineArgs')
  if (args === undefined) return parseTuiStartupIntent([])
  let intent: StartupIntent | undefined
  parseCmdline(ctx, buildTuiStartupProgram((parsed) => { intent = parsed }))
  return intent ?? null
}

/**
 * Create the agent, mount the store and answerers, and drive the matching
 * surface until it exits.
 * @param ctx - plugin context carrying the agent registry, default model, tool registry, settings, and credentials.
 * @param tuiScope - the registered `tui` settings namespace scope.
 * @param config - validated TUI-local persistence limits.
 */
async function boot(
  ctx: Context,
  tuiScope: SettingsScope<{ busyEnter: 'queue' | 'steer'; thinking: 'collapsed' | 'expanded' }>,
  config: Config,
): Promise<void> {
  // Parse the startup argv first: help, version, and usage rejections must
  // exit before any agent is created, and the intent routes the whole boot.
  const intent = readStartupIntent(ctx)
  if (intent === null) return
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const homePath = ctx.dshHomePath
  if (homePath === undefined) throw new Error('TUI session recency requires the app boot home-path provider')
  const recency = new SessionRecencyStore(
    homePath('tui', 'session-recency.json'),
    config.sessionRecencyMaxEntries ?? DEFAULT_SESSION_RECENCY_MAX_ENTRIES,
    (error) => { ctx.logger.warn(`tui: session recency sidecar fault: ${error instanceof Error ? error.message : String(error)}`) },
  )
  const projections = new ProjectionSidecarStore(
    homePath('tui', 'projections'),
    (error) => { ctx.logger.warn(`tui: fold projection sidecar fault: ${error instanceof Error ? error.message : String(error)}`) },
  )
  const created = await createTuiAgent(ctx, process.cwd())
  // Handle of the surface's CURRENT agent. Switches dispose THIS handle before
  // replacing it — disposing the boot-time `created.handle` on every switch
  // leaked each intermediate agent (multiple live sessions the /sessions
  // panel shows as inert live rows, which can never be resumed again).
  let currentHandle: AgentHandle = created.handle
  const hostCommands = ctx.get('commands')?.list(created.agent) ?? []
  const commandEntries = hostCommands.map(command => ({
    name: command.name,
    description: command.description,
    needsArgs: command.input !== undefined,
  }))
  const bootGeneral = tuiScope.get() as GeneralSettings
  const bootSettings: SettingsData = {
    general: bootGeneral,
    models: { providers: [], credentials: [] },
    plugins: [],
    configs: {},
    inventory: { namespaces: [], credentials: [], inspectProviders: 0 },
    presets: [],
    currentPreset: undefined,
  }
  // First paint does not wait for catalog/settings/feedback I/O. Those
  // loads start after this function yields so they cannot contend with
  // Cordis boot or the first Ink frame. Print mode never starts them.
  // Chrome locale/busyEnter/theme still come from the live `tui` scope so
  // the first frame cannot paint zh/queue and then overlay en/steer.
  const bootModels: ModelEntry[] = [{
    provider: created.selection.provider,
    model: created.selection.model,
    label: `${created.selection.provider}/${created.selection.model}`,
  }]
  const store = createTuiStore({
    version: 0,
    nodes: [],
    trace: [],
    todos: [],
    stats: initialState().stats,
    live: null,
    busy: false,
    provider: created.selection.provider,
    model: created.selection.model,
    sessionId: created.agent.id,
    cwd: process.cwd(),
    pendingApproval: null,
    pendingQuestion: null,
    commands: commandEntries,
    skills: [],
    models: bootModels,
    sessions: [],
    queued: [],
    settings: bootSettings,
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
    sandbox: ctx.sandboxPolicy.resolve({ session: created.agent.session }).mode,
    occupancy: null,
    resumeProgress: null,
  })
  const surface: Surface = {
    fold: initialState(),
    scratch: createScratch(),
    version: 0,
    busy: false,
    agent: created.agent,
    selection: created.ref,
    currentModel: created.selection.model,
    commands: commandEntries,
    skills: [],
    models: bootModels,
    pendingApproval: null,
    pendingQuestion: null,
    approvalResolve: null,
    questionResolve: null,
    settings: bootSettings,
    jobs: [],
    subagents: [],
    workflows: new Map(),
    feedback: new Map(),
    reasoning: {
      effort: created.selection.reasoningEffort === undefined ? undefined : String(created.selection.reasoningEffort),
      levels: [],
    },
    pendingAttachments: [],
    cwd: process.cwd(),
    resumeProgress: null,
  }
  let settingsGeneration = 0
  /** Reload and publish the settings projection; only the newest read commits. */
  const reloadSettings = async (): Promise<void> => {
    const generation = ++settingsGeneration
    const data = await loadSettingsData(ctx, surface, tuiScope, config)
    if (generation !== settingsGeneration) return
    surface.settings = data
    surface.version += 1
    store.set({ ...store.getSnapshot(), settings: data, version: surface.version })
  }
  /** Load the model catalog, then the settings pages it feeds (parallel). */
  const loadPanels = (): void => {
    void loadModels(ctx, created.selection).then((models) => {
      surface.models = models
      surface.version += 1
      store.set({ ...store.getSnapshot(), models, version: surface.version })
    }).catch(() => {}).then(() => {
      void reloadSettings().catch(() => {})
    })
  }
  let catalogGeneration = 0
  /** Refresh agent-scoped commands immediately and skills without blocking input. */
  const refreshCatalogs = (): void => {
    const generation = ++catalogGeneration
    surface.commands = (ctx.get('commands')?.list(surface.agent) ?? []).map(command => ({
      name: command.name,
      description: command.description,
      needsArgs: command.input !== undefined,
    }))
    surface.version += 1
    store.set({ ...store.getSnapshot(), commands: surface.commands, version: surface.version })
    void loadSkillEntries(ctx, surface).then((skills) => {
      if (generation !== catalogGeneration) return
      surface.skills = skills
      surface.version += 1
      store.set({ ...store.getSnapshot(), skills, version: surface.version })
    }).catch(() => {
      // Catalog discovery racing a preset/session teardown keeps the last settled list;
      // the generation check prevents an older successful read from replacing a newer one.
    })
  }
  /** Publish one replaced feedback map. */
  const publishFeedback = (): void => {
    surface.version += 1
    store.set({ ...store.getSnapshot(), feedback: surface.feedback, version: surface.version })
  }
  /** Load durable feedback for the live session (best-effort sidecar read). */
  const loadFeedback = async (): Promise<void> => {
    const service = ctx.get('messageFeedback')
    if (service === undefined) return
    try {
      const result = await service.list({ sessionId: surface.agent.id })
      if (result.ok) {
        surface.feedback = new Map(result.value.items.map(item => [item.messageId, item]))
        publishFeedback()
      }
    } catch {
      // A sidecar read racing teardown must not disturb the surface.
    }
  }
  const loadReasoning = (): void => {
    void resolveTuiReasoning(ctx, created.selection).then((reasoning) => {
      surface.reasoning = reasoning
      surface.version += 1
      store.set({ ...store.getSnapshot(), reasoning: surface.reasoning, version: surface.version })
    }).catch(() => {})
  }
  // Catalog, settings, and feedback stay off the first-paint path. Subagent
  // rows load when `/subagents` opens (`refreshPanels`), same as sessions.
  if (intent.mode !== 'print') {
    setImmediate(() => {
      loadPanels()
      refreshCatalogs()
      loadReasoning()
      void loadFeedback()
    })
  }
  // Session titles require inspecting persisted logs. Keep that work off the
  // startup path; opening /sessions calls refreshPanels() and loads the same
  // rows on demand after the first terminal frame is interactive.
  /** Reload the /settings pages after any settings or credential commit. */
  const refreshSettings = (): void => {
    void reloadSettings().catch(() => {
      // A refresh racing service teardown must not disturb the exit path.
    })
  }
  /** Current UI locale, including the initial settings value before publish. */
  const uiLocale = (): 'zh' | 'en' => surface.settings?.general.locale ?? (tuiScope.get() as GeneralSettings).locale
  /** Select copy without passing display language into Harness services. */
  const uiText = (zh: string, en: string): string => uiLocale() === 'en' ? en : zh
  let pluginToggleTail: Promise<void> = Promise.resolve()
  /** Serialize profile writes and Loader recompositions across rapid Enter presses. */
  const togglePlugin = (id: string): ReturnType<typeof toggleProfilePlugin> => {
    const run = pluginToggleTail.then(async () => {
      if (config.profilePatchPath === undefined) return { ok: false as const, code: 'entry-unavailable' as const }
      const result = await toggleProfilePlugin({
        ctx,
        patchPath: config.profilePatchPath,
        id,
        surfacePluginId: name,
        protectedIds: config.pluginToggleProtectedIds ?? [],
        settleTimeoutMs: config.pluginToggleSettleTimeoutMs ?? DEFAULT_PLUGIN_TOGGLE_SETTLE_TIMEOUT_MS,
      })
      if (result.ok) {
        try {
          await reloadSettings()
        } catch {
          // Loader already settled the toggle; the settings event or next
          // panel refresh supplies the same inventory after teardown races.
        }
      }
      return result
    })
    pluginToggleTail = run.then(() => {}, () => {})
    return run
  }
  let unsubscribe = subscribe(ctx, store, surface, refreshSettings, projections)
  const offSkillsChange = ctx.on('skills/change', () => { refreshCatalogs() }, { global: true })
  const isTty = process.stdin.isTTY === true && process.stdout.isTTY === true
  // Print mode never mounts the interactive answerers: asks fail closed,
  // matching the non-TTY fallback semantics.
  if (isTty && intent.mode !== 'print') mountAnswerers(ctx, store, surface)
  /** Host-command passthrough: registered slash commands dispatch without a model turn; unknown lines go to the model. */
  const publishPendingImages = (): void => {
    surface.version += 1
    store.set({
      ...store.getSnapshot(),
      attachmentCount: surface.pendingAttachments.length,
      pendingImages: pendingImageChips(surface.pendingAttachments),
      version: surface.version,
    })
  }
  const currentModelAcceptsImage = (): boolean => modelRouteAcceptsImages(
    surface.models,
    (surface.selection.current ?? ctx.agentDefaultModel.currentSelection()).provider,
    surface.currentModel,
  )
  const ingestImageBatch = async (
    inputs: readonly { data: Uint8Array; mediaType: ImageMediaType; name: string }[],
  ): Promise<{ error: string | null; chips?: readonly string[] }> => {
    const attachments = ctx.get('attachments')
    if (attachments === undefined) {
      return {
        error: uiText(
          '附件服务未加载（bundle 缺 dsh-attachment-local）',
          'Attachment service is not loaded (bundle lacks dsh-attachment-local)',
        ),
      }
    }
    const refused = rejectImageBatch(
      surface.pendingAttachments.length,
      surface.pendingAttachments.reduce((sum, ref) => sum + ref.bytes, 0),
      inputs.map(input => ({ bytes: input.data.byteLength, mediaType: input.mediaType })),
      attachments.imageLimits,
    )
    if (refused !== null) {
      switch (refused.code) {
        case 'unsupported-type':
          return { error: uiText('仅支持图片附件（png/jpg/gif/webp）', 'Only png/jpg/gif/webp image attachments are supported') }
        case 'too-many':
          return { error: uiText(`一条消息最多添加 ${refused.max} 张图片`, `A message can include up to ${refused.max} images`) }
        case 'file-too-large':
          return { error: uiText(`单张图片不能超过 ${formatByteSize(refused.max)}`, `Each image must be smaller than ${formatByteSize(refused.max)}`) }
        case 'total-too-large':
          return {
            error: uiText(
              `图片总大小超过 ${formatByteSize(refused.max)}，请移除部分图片`,
              `Images exceed ${formatByteSize(refused.max)} in total; remove some and try again`,
            ),
          }
      }
    }
    try {
      const start = surface.pendingAttachments.length
      const refs = await attachments.saveImages(inputs)
      surface.pendingAttachments = [...surface.pendingAttachments, ...refs]
      publishPendingImages()
      return { error: null, chips: refs.map((_ref, index) => imageChip(start + index)) }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : ''
      if (code === 'IMAGE_TOO_MANY_PIXELS') {
        return { error: uiText('图片分辨率过大，请压缩后重试', 'Image resolution is too high; compress it and try again') }
      }
      if (code === 'IMAGE_DIMENSION_TOO_LARGE') {
        return { error: uiText('图片边长过大，请压缩后重试', 'Image dimension is too large; compress it and try again') }
      }
      return { error: `${uiText('附加失败', 'Attach failed')}: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const ingestImageBytes = async (
    input: { data: Uint8Array; mediaType: ImageMediaType; name: string },
  ): Promise<{ error: string | null; chip?: string }> => {
    const result = await ingestImageBatch([input])
    return result.error === null
      ? { error: null, ...(result.chips?.[0] === undefined ? {} : { chip: result.chips[0] }) }
      : { error: result.error }
  }
  /** Read and classify one local image before the attachment service admits its batch. */
  const readImageFileInput = (path: string): { data: Uint8Array; mediaType: ImageMediaType; name: string } => {
    const absolute = resolve(path)
    const bytes = new Uint8Array(readFileSync(absolute))
    const mediaType = sniffMediaType(bytes)
      ?? mediaTypeFromPath(absolute)
      ?? IMAGE_MEDIA_BY_EXT[extname(absolute).slice(1).toLowerCase()]
    if (mediaType === undefined) {
      throw new TypeError(uiText('仅支持图片附件（png/jpg/gif/webp）', 'Only png/jpg/gif/webp image attachments are supported'))
    }
    return { data: bytes, mediaType, name: basename(absolute) }
  }
  const presetQueue = new SessionPresetQueue()
  // Prompt admission and preset selection share the same session queue. The
  // claim lands before the next switch checks blank state, closing the event gap.
  const dispatchOrFollowup = async (text: string, steer: boolean): Promise<void> => {
    const commandAgent = surface.agent
    const submit = async (): Promise<void> => {
      await presetQueue.run(commandAgent.id, () => {
        // A delayed fallback from a replaced session never lands in the new
        // session's composer or attachment queue.
        if (surface.agent !== commandAgent) return
        const sending = attachmentsForSubmit(text, surface.pendingAttachments)
        surface.pendingAttachments = sending
        const prose = stripImageChips(text)
        if (sending.length > 0 && !currentModelAcceptsImage()) {
          publishPendingImages()
          process.stderr.write(`${uiText(
            '当前模型不接受图片。请在 /settings models 选择带 · 图 的模型，或在 settings.yaml 为该模型声明 input: [text, image]。',
            'The current model does not accept images. Pick a model marked · image in /settings models, or set input: [text, image] for it in settings.yaml.',
          )}\n`)
          return
        }
        const message = createTuiUserMessage(prose, sending)
        surface.pendingAttachments = []
        publishPendingImages()
        if (steer) commandAgent.steer(message)
        else commandAgent.followup(message)
        presetQueue.claimPrompt(commandAgent.id)
        recency.touch(commandAgent.session.header)
      })
    }
    if (!text.startsWith('/')) {
      await submit()
      return
    }
    const commands = ctx.get('commands')
    if (commands === undefined) {
      await submit()
      return
    }
    try {
      const images = await encodeTuiCommandImages(ctx.attachments, surface.pendingAttachments)
      const execution = await commands.execute(commandAgent, text, images, new AbortController().signal)
      if (execution !== undefined) {
        surface.pendingAttachments = []
        publishPendingImages()
        recency.touch(commandAgent.session.header)
        return
      }
      await submit()
    } catch {
      await submit()
    }
  }
  const foldHooks = {
    before(event: SessionEvent, state: FoldState): void {
      if (event.type === 'tool/result' || event.type === 'tool/code-dispatch') {
        enrichToolCards(ctx, event, state)
      }
    },
    after(event: SessionEvent, state: FoldState, replayScratch: FoldScratch): void {
      if (event.type !== 'tool/call' && event.type !== 'tool/code-dispatch-start') return
      enrichToolCards(ctx, event, state)
      const node = state.nodes[state.nodes.length - 1]
      if (node?.kind === 'tool') {
        const callId = event.type === 'tool/call' ? String(event.data.callId) : String(event.data.subCallId)
        rememberToolCallCard(replayScratch, callId, node.callCard)
      }
    },
  }
  let resumeGeneration = 0
  let resumeAbort: AbortController | null = null
  const publishSurfaceFold = (): void => {
    surface.version += 1
    store.set({
      ...store.getSnapshot(),
      nodes: surface.fold.nodes,
      trace: surface.fold.trace,
      todos: surface.fold.todos,
      stats: surface.fold.stats,
      live: surface.fold.live,
      plan: surface.fold.plan,
      goal: surface.fold.goal,
      compaction: surface.fold.compaction,
      sessionId: String(surface.agent.id),
      resumeProgress: surface.resumeProgress,
      version: surface.version,
    })
  }
  const cancelResume = (): void => {
    if (resumeAbort === null) return
    resumeGeneration += 1
    resumeAbort.abort()
    resumeAbort = null
    surface.resumeProgress = null
    publishSurfaceFold()
  }
  /** Dispose a prepared replacement without letting rollback hide the primary outcome. */
  const disposePrepared = async (handle: AgentHandle): Promise<void> => {
    try {
      await handle.dispose()
    } catch (error) {
      fail(ctx, error)
    }
  }
  /** Swap the surface onto a freshly created agent (/new). */
  const newSession = async (): Promise<void> => {
    try {
      if (projectionCheckpointIsComplete(surface.agent.session.snapshotEvents())) {
        projections.write(
          surface.agent.session.header,
          surface.agent.session.snapshotEvents().at(-1)?.seq ?? 0,
          surface.fold,
        )
      }
      // A new session continues the preset the surface currently runs; a
      // metadata-free session resolves the roster default instead.
      const previousSessionId = surface.agent.id
      const nextPreset = recordedPreset(surface.agent.session.header, surface.agent.session.snapshotEvents())
      const next = await createTuiAgent(ctx, surface.cwd, nextPreset)
      const nextReasoning = await resolveTuiReasoning(ctx, next.selection)
      unsubscribe()
      await currentHandle.dispose()
      presetQueue.forget(previousSessionId)
      currentHandle = next.handle
      surface.fold = initialState()
      surface.scratch = createScratch()
      surface.agent = next.agent
      surface.selection = next.ref
      surface.currentModel = next.selection.model
      surface.busy = false
      surface.pendingApproval = null
      surface.pendingQuestion = null
      surface.feedback = new Map()
      surface.pendingAttachments = []
      surface.commands = []
      surface.skills = []
      surface.jobs = []
      surface.subagents = []
      surface.workflows = createWorkflowProjection()
      surface.reasoning = nextReasoning
      unsubscribe = subscribe(ctx, store, surface, refreshSettings, projections)
      refreshCatalogs()
      void loadFeedback()
    } catch (error) {
      fail(ctx, error)
    }
  }
  /** Resume one persisted session onto the surface; rebuilds the transcript from its log. */
  const resumeSession = async (id: string): Promise<string | null> => {
    const gen = ++resumeGeneration
    resumeAbort?.abort()
    const controller = new AbortController()
    resumeAbort = controller
    // Publish before disk access. Large logs can take long enough to read that
    // the user needs visible progress and a working Escape key during phase 0.
    surface.resumeProgress = { done: 0, total: 1 }
    publishSurfaceFold()
    const fallback = ctx.agentDefaultModel.currentSelection()
    // Phase 0 — read the persisted log once (replay-validated): its header
    // and events resolve the session's recorded preset (mounted in setup
    // below) AND rebuild the fold after the swap, with no second read.
    let snapshot
    const query = ctx.get('sessionQuery')
    if (query === undefined) {
      resumeAbort = null
      surface.resumeProgress = null
      publishSurfaceFold()
      return `${uiText('恢复失败', 'Resume failed')}: session query service is not loaded`
    }
    try {
      const read = await query.readSession(SessionId(id))
      snapshot = { header: read.session, events: read.events }
    } catch (error) {
      if (gen === resumeGeneration) {
        resumeAbort = null
        surface.resumeProgress = null
        publishSurfaceFold()
      }
      return `${uiText('恢复失败', 'Resume failed')}: ${error instanceof Error ? error.message : String(error)}`
    }
    if (resumeWasCancelled(controller.signal, gen, resumeGeneration)) {
      return uiText('已取消恢复', 'Resume cancelled')
    }
    surface.resumeProgress = { done: 0, total: Math.max(1, snapshot.events.length) }
    publishSurfaceFold()
    // Phase 1 — prepare the next agent. A failure here leaves the current
    // surface (agent and subscription) untouched: report it as a notice.
    let prepared
    try {
      prepared = await prepareTuiResume(ctx, SessionId(id), snapshot, fallback, controller.signal)
    } catch (error) {
      if (gen === resumeGeneration) {
        resumeAbort = null
        surface.resumeProgress = null
        publishSurfaceFold()
      }
      if (resumeWasCancelled(controller.signal, gen, resumeGeneration)) {
        return uiText('已取消恢复', 'Resume cancelled')
      }
      return `${uiText('恢复失败', 'Resume failed')}: ${error instanceof Error ? error.message : String(error)}`
    }
    const next = prepared.handle
    const selection = prepared.selection
    const ref = prepared.ref
    const nextReasoning = prepared.reasoning
    const events = prepared.events
    if (resumeWasCancelled(controller.signal, gen, resumeGeneration)) {
      await disposePrepared(next)
      return uiText('已取消恢复', 'Resume cancelled')
    }
    // Phase 2 — fold while the current agent and subscription remain owned by
    // the surface. Cancellation therefore discards only the prepared handle;
    // the visible session never observes a partial projection.
    const lastSeq = events.at(-1)?.seq ?? 0
    let fold: FoldState
    let scratch: FoldScratch
    let nextWorkflows: Map<string, WorkflowRow>
    try {
      const replayed = await replayTuiResumeOrDispose(next, async () => {
        const sidecar = await projections.read(String(next.agent.session.header.id), next.agent.session.header.createdAt)
        let targetFold: FoldState
        let targetScratch: FoldScratch
        if (sidecar !== null && sidecar.lastSeq <= lastSeq) {
          const suffix = events.filter(event => event.seq > sidecar.lastSeq)
          surface.resumeProgress = { done: 0, total: Math.max(1, suffix.length) }
          publishSurfaceFold()
          const folded = await foldFromLogYielding(suffix, foldHooks, {
            seed: { fold: sidecar.fold, scratch: createScratch() },
            signal: controller.signal,
            onProgress: (done, total) => {
              if (gen !== resumeGeneration) return
              surface.resumeProgress = { done, total }
              surface.version += 1
              store.set({ ...store.getSnapshot(), resumeProgress: surface.resumeProgress, version: surface.version })
            },
          })
          targetFold = folded.fold
          targetScratch = folded.scratch
        } else {
          const folded = await foldFromLogYielding(events, foldHooks, {
            signal: controller.signal,
            onProgress: (done, total) => {
              if (gen !== resumeGeneration) return
              surface.resumeProgress = { done, total }
              surface.version += 1
              store.set({ ...store.getSnapshot(), resumeProgress: surface.resumeProgress, version: surface.version })
            },
          })
          targetFold = folded.fold
          targetScratch = folded.scratch
        }
        return {
          fold: targetFold,
          scratch: targetScratch,
          workflows: foldWorkflowSessionEvents(events),
        }
      })
      fold = replayed.fold
      scratch = replayed.scratch
      nextWorkflows = replayed.workflows
    } catch (error) {
      if (gen === resumeGeneration) {
        resumeAbort = null
        surface.resumeProgress = null
        publishSurfaceFold()
      }
      fail(ctx, error)
      return `${uiText('恢复失败', 'Resume failed')}: ${error instanceof Error ? error.message : String(error)}`
    }
    if (resumeWasCancelled(controller.signal, gen, resumeGeneration)) {
      await disposePrepared(next)
      return uiText('已取消恢复', 'Resume cancelled')
    }

    // Preparation is complete. Clear the abort handle before crossing the
    // swap's point of no return so a late Escape cannot invalidate the
    // generation after old-handle teardown starts. Keep replay progress
    // visible until the new subscription publishes the replacement surface.
    resumeAbort = null
    const replayTotal = surface.resumeProgress.total
    surface.resumeProgress = { done: replayTotal, total: replayTotal }
    publishSurfaceFold()
    if (projectionCheckpointIsComplete(surface.agent.session.snapshotEvents())) {
      projections.write(
        surface.agent.session.header,
        surface.agent.session.snapshotEvents().at(-1)?.seq ?? 0,
        surface.fold,
      )
    }
    const previousAgent = surface.agent
    const previousSessionId = previousAgent.id
    unsubscribe()
    try {
      await currentHandle.dispose()
    } catch (error) {
      // A disposer that rejected before unregistering leaves the old surface
      // adoptable. Restore its subscription and discard the prepared target.
      if (ctx.agents.get(previousSessionId) === previousAgent) {
        unsubscribe = subscribe(ctx, store, surface, refreshSettings, projections)
        await disposePrepared(next)
        surface.resumeProgress = null
        publishSurfaceFold()
        fail(ctx, error)
        return `${uiText('恢复失败', 'Resume failed')}: ${error instanceof Error ? error.message : String(error)}`
      }
      // The old Agent reached registry quiescence despite a contained teardown
      // callback failure. Adopt the prepared target rather than strand the UI.
      fail(ctx, error)
    }
    presetQueue.forget(previousSessionId)
    currentHandle = next
    surface.fold = fold
    surface.scratch = scratch
    surface.agent = next.agent
    surface.selection = ref
    surface.currentModel = selection.model
    surface.busy = false
    surface.pendingApproval = null
    surface.pendingQuestion = null
    surface.feedback = new Map()
    surface.pendingAttachments = []
    surface.commands = []
    surface.skills = []
    surface.jobs = []
    surface.subagents = []
    surface.workflows = nextWorkflows
    surface.reasoning = nextReasoning
    surface.resumeProgress = null
    unsubscribe = subscribe(ctx, store, surface, refreshSettings, projections)
    // The presets page marks the CURRENT preset: republish settings so the
    // marker follows the resumed session.
    refreshSettings()
    refreshCatalogs()
    void loadFeedback()
    recency.touch(next.agent.session.header)
    if (projectionCheckpointIsComplete(events)) {
      projections.write(next.agent.session.header, lastSeq, surface.fold)
    }
    return null
  }
  /**
   * Switch the CURRENT session onto one agent preset, in place — the exact
   * Web mechanism. The agent and the session survive; only the composition is
   * swapped, and it is recorded in the log afterwards.
   */
  const switchPreset = async (id: string): Promise<string | null> => {
    const agent = surface.agent
    return await presetQueue.run(agent.id, async () => {
      if (surface.agent !== agent) {
        return uiText('会话已切换，未应用预设', 'The session changed before the preset could be applied')
      }
      // Re-read after earlier queued work. A prompt claims the session in this
      // queue before `turn/start` becomes observable.
      if (presetQueue.presetLocked(agent.id, agent.session.snapshotEvents())) {
        return uiText(
          '预设已锁定：当前会话已经开始对话，预设不可再变更（请 /new 开新会话后再切换）',
          'Preset locked: this conversation has started; use /new before selecting another preset',
        )
      }
      const presetService = ctx.get('agentPresets')
      if (presetService === undefined) {
        return uiText(
          'agent 预设服务未加载（bundle 缺 dsh-agent-presets）',
          'Agent preset service is not loaded (bundle lacks dsh-agent-presets)',
        )
      }
      try {
        // recompose resolves and prepares the target before moving the scope;
        // an invalid target leaves the previous composition installed.
        const preset = await presetService.recompose(agent.ctx, id)
        agent.session.append('agent-preset/selected', { agentPreset: preset.id })
        if (surface.agent === agent) {
          refreshSettings()
          refreshCatalogs()
        }
        return null
      } catch (error) {
        return `${uiText('切换预设失败', 'Preset switch failed')}: ${error instanceof Error ? error.message : String(error)}`
      }
    })
  }
  /** Print the ambiguous-resume candidates to stderr and request the usage exit. */
  const failAmbiguous = (candidates: readonly ResumeCandidate[]): void => {
    const cap = 10
    const lines = candidates.slice(0, cap).map((candidate) => {
      const title = candidate.title === undefined ? '' : ` · ${candidate.title}`
      const cwd = candidate.cwd === undefined ? '' : ` · ${candidate.cwd}`
      return `  ${candidate.id}${title}${cwd} · ${new Date(candidate.createdAt).toISOString()}`
    })
    process.stderr.write(`恢复目标不唯一，匹配到 ${candidates.length} 个会话：\n${lines.join('\n')}\n`)
    requestExit(ctx, EXIT_USAGE)
  }
  /**
   * Resolve the startup base onto the surface through the existing
   * `resumeSession` (the two-phase swap keeps the single-live-session
   * invariant). Returns the sessions panel to open for the interactive
   * picker/ambiguity paths, null when the surface is ready, or 'exit' when
   * a terminal path already requested exit.
   */
  const applyStartupBase = async (): Promise<{ kind: 'sessions'; filter?: string } | null | 'exit'> => {
    switch (intent.base.kind) {
      case 'new': return null
      case 'continue': {
        const query = ctx.get('sessionQuery')
        if (query === undefined) { fail(ctx, new Error('会话查询服务未加载，无法恢复会话')); return 'exit' }
        let id: SessionId | null
        try {
          id = await resolveContinueSession(query, process.cwd(), await recency.read())
        } catch (error) {
          fail(ctx, error)
          return 'exit'
        }
        if (id === null) {
          fail(ctx, new Error(`当前目录没有可恢复的会话（${process.cwd()}）；--continue 不会恢复其他目录的会话`))
          return 'exit'
        }
        const error = await resumeSession(String(id))
        if (error !== null) { fail(ctx, new Error(error)); return 'exit' }
        return null
      }
      case 'resume-picker': return { kind: 'sessions' }
      case 'resume': {
        const query = ctx.get('sessionQuery')
        if (query === undefined) { fail(ctx, new Error('会话查询服务未加载，无法恢复会话')); return 'exit' }
        let resolution: ResumeResolution
        try {
          resolution = await resolveResumeTarget(query, intent.base.query)
        } catch (error) {
          fail(ctx, error)
          return 'exit'
        }
        if (resolution.kind === 'none') { fail(ctx, new Error(`找不到会话：${intent.base.query}`)); return 'exit' }
        if (resolution.kind === 'ambiguous') {
          // Print mode never opens the interactive picker: list the
          // candidates and fail with the usage code.
          if (intent.mode === 'print') { failAmbiguous(resolution.candidates); return 'exit' }
          return { kind: 'sessions', filter: intent.base.query }
        }
        const error = await resumeSession(String(resolution.id))
        if (error !== null) { fail(ctx, new Error(error)); return 'exit' }
        return null
      }
    }
  }
  /**
   * One-shot --print executor: submit through the unified dispatch path,
   * wait for the turn to settle, print only the assistant result to stdout,
   * and exit with the turn's end code. No Ink, no composer, no mouse
   * tracking, no interactive input.
   */
  const runPrintOnce = async (): Promise<void> => {
    const prompt = intent.prompt
    if (prompt === undefined) {
      fail(ctx, new Error('--print 需要一个任务参数'))
      return
    }
    if (prompt.startsWith('/')) {
      // TUI-local slash commands have no print surface; only host commands
      // and plain prompts proceed.
      const known = ctx.get('commands')?.list(surface.agent) ?? []
      if (!known.some(command => command.name === prompt.split(' ')[0])) {
        process.stderr.write('(print mode: this command is only available in the interactive TUI)\n')
        requestExit(ctx, EXIT_USAGE)
        return
      }
    }
    const firstCount = store.getSnapshot().nodes.length
    const turnBefore = lastTurnNumber(surface.agent.session.snapshotEvents())
    await dispatchOrFollowup(prompt, false)
    try {
      await surface.agent.whenIdle()
    } catch {
      // A signal-triggered tree disposal rejects the idle wait; the launcher owns that exit code.
      return
    }
    const result = renderAssistantResultPlain(store.getSnapshot().nodes.slice(firstCount))
    if (result !== '') process.stdout.write(result + '\n')
    const reason = turnEndReasonAfter(surface.agent.session.snapshotEvents(), turnBefore)
    requestExit(ctx, reason === undefined ? (prompt.startsWith('/') ? EXIT_OK : EXIT_FAILURE) : mapTurnEndToExitCode(reason))
  }
  try {
    // Resolve the base session FIRST, in every mode: `-c -p` and
    // `-r <id> -p` must resume before the print turn submits, or the task
    // would land on the fresh boot session instead of the resumed history.
    const panel = await applyStartupBase()
    if (panel === 'exit') return
    if (intent.fork && panel !== null) {
      fail(ctx, new Error('--fork-session 的恢复目标不唯一，无法确定分叉基底'), EXIT_USAGE)
      return
    }
    if (intent.fork) {
      let forkId: SessionId | null
      try {
        forkId = await createForkArtifact(ctx, { source: surface.agent, cwd: surface.cwd })
      } catch (error) {
        fail(ctx, error)
        return
      }
      if (forkId === null) {
        fail(ctx, new Error('没有已完成回合可分叉'))
        return
      }
      const error = await resumeSession(String(forkId))
      if (error !== null) {
        fail(ctx, new Error(error))
        return
      }
    }
    if (intent.mode === 'print') {
      await runPrintOnce()
      return
    }
    if (isTty) {
      const { runInk } = await import('./render')
      const inkDone = runInk(store, {
        submit: (text, steer) => { void dispatchOrFollowup(text, steer).catch((error: unknown) => { fail(ctx, error) }) },
        cancel: () => { surface.agent.cancel({ kind: 'user' }) },
        exit: () => {
          // Cancel first so whenIdle in the teardown settles promptly even
          // when the user quits mid-turn; nothing here may throw, or the
          // launcher's teardown race escalates into a failing exit code.
          try { surface.agent.cancel({ kind: 'user' }) } catch {}
          requestExit(ctx, EXIT_OK)
        },
        newSession: () => { void newSession() },
        resumeSession: resumeSession,
        switchPreset: switchPreset,
        renameSession: async (title) => {
          const service = ctx.get('sessionTitle') as { rename(session: unknown, title: string): unknown } | undefined
          try {
            service?.rename(surface.agent.session, title)
            return null
          } catch (error) {
            return `${uiText('重命名失败', 'Rename failed')}: ${error instanceof Error ? error.message : String(error)}`
          }
        },
        changeWorkspace: async (path) => {
          try {
            const target = resolve(path)
            const { statSync } = await import('node:fs')
            if (!statSync(target).isDirectory()) return uiText('目标不是目录', 'The target is not a directory')
            process.chdir(target)
            surface.cwd = target
            surface.version += 1
            store.set({ ...store.getSnapshot(), cwd: target, version: surface.version })
            refreshCatalogs()
            return null
          } catch (error) {
            return `${uiText('切换失败', 'Workspace switch failed')}: ${error instanceof Error ? error.message : String(error)}`
          }
        },
        listSessionReferences: async (query) => {
          const resolver = ctx.get('sessionReferenceResolver')
          if (resolver === undefined) return []
          try {
            const candidates = await resolver.listCandidates(surface.agent, query)
            return candidates.map(candidate => ({
              label: candidate.label,
              mention: formatSessionReferenceMention({ sessionId: candidate.sessionId, label: candidate.label }),
              ...(candidate.cwd === undefined ? {} : { cwd: candidate.cwd }),
            }))
          } catch {
            return []
          }
        },
        attachFiles: async (paths) => {
          try {
            return ingestImageBatch(paths.map(readImageFileInput))
          } catch (error) {
            return { error: `${uiText('附加失败', 'Attach failed')}: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
        attachFile: async (path) => {
          try {
            const result = await ingestImageBatch([readImageFileInput(path)])
            if (result.error !== null) return { error: result.error }
            const chip = result.chips?.[0]
            return { error: null, ...(chip === undefined ? {} : { chip }) }
          } catch (error) {
            return { error: `${uiText('附加失败', 'Attach failed')}: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
        attachClipboardImage: async () => {
          const image = await readClipboardImage()
          if (image === null) {
            return {
              error: uiText('剪贴板里没有图片（Windows 请用 Alt+V）', 'No image on the clipboard (on Windows use Alt+V)'),
              empty: true,
            }
          }
          return ingestImageBytes(image)
        },
        syncImageChips: (previousDraft, nextDraft) => {
          const next = reconcileImageChips(previousDraft, nextDraft, surface.pendingAttachments)
          if (next.attachments.length === surface.pendingAttachments.length
            && next.attachments.every((ref, index) => ref === surface.pendingAttachments[index])) {
            return next.draft
          }
          surface.pendingAttachments = next.attachments
          publishPendingImages()
          return next.draft
        },
        forkSession: async (atSeq) => {
          try {
            const forkId = await createForkArtifact(ctx, {
              source: surface.agent,
              cwd: surface.cwd,
              ...(atSeq === undefined ? {} : { atSeq }),
            })
            return forkId === null ? uiText('没有已完成回合可分叉', 'There is no completed turn to fork') : null
          } catch (error) {
            return `${uiText('分叉失败', 'Fork failed')}: ${error instanceof Error ? error.message : String(error)}`
          }
        },
        selectModel: (provider, model, reasoningEffort) => {
          const effort = reasoningEffort === undefined ? undefined : ReasoningEffortId(reasoningEffort)
          surface.selection.current = {
            provider,
            model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
          }
          surface.currentModel = model
          void ctx.agentDefaultModel.saveSelection(surface.selection.current)
          surface.reasoning = {
            effort: effort === undefined ? undefined : String(effort),
            levels: surface.reasoning.levels,
          }
          surface.version += 1
          store.set({
            ...store.getSnapshot(),
            provider,
            model,
            reasoning: surface.reasoning,
            version: surface.version,
          })
          const nextSelection = {
            provider,
            model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
          }
          void resolveTuiReasoning(ctx, nextSelection).then((reasoning) => {
            surface.reasoning = reasoning
            surface.version += 1
            store.set({ ...store.getSnapshot(), reasoning: surface.reasoning, version: surface.version })
          }).catch(() => {})
        },
        setEffort: (effort) => {
          // `/effort off|low|high|max`: set (or clear, for off) the persisted
          // reasoning effort on the current default route.
          const selected = surface.selection.current ?? ctx.agentDefaultModel.currentSelection()
          const reasoningEffort = effort === undefined ? undefined : ReasoningEffortId(effort)
          surface.selection.current = {
            provider: selected.provider,
            model: selected.model,
            ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          }
          surface.currentModel = selected.model
          void ctx.agentDefaultModel.saveSelection(surface.selection.current)
          surface.reasoning = { effort, levels: surface.reasoning.levels }
          surface.version += 1
          store.set({ ...store.getSnapshot(), reasoning: surface.reasoning, version: surface.version })
        },
        cycleSandbox: () => {
          // Shift+Tab: rotate the session's file-policy override. Write the
          // snapshot immediately so the permission chip does not wait for the
          // fold subscription; appending `sandbox/mode` keeps the log durable.
          const current = ctx.sandboxPolicy.resolve({ session: surface.agent.session }).mode
          const index = SANDBOX_MODES.indexOf(current)
          const next = SANDBOX_MODES[(index + 1) % SANDBOX_MODES.length] ?? 'read-only'
          setSandboxMode(surface.agent.session, next)
          surface.version += 1
          store.set({ ...store.getSnapshot(), sandbox: next, version: surface.version })
          return next
        },
        cancelResume,
        approve: (outcome) => {
          surface.pendingApproval = null
          const resolve = surface.approvalResolve
          surface.approvalResolve = null
          surface.version += 1
          store.set({ ...store.getSnapshot(), pendingApproval: null, version: surface.version })
          resolve?.(outcome)
        },
        answerQuestion: (answers) => {
          surface.pendingQuestion = null
          const resolve = surface.questionResolve
          surface.questionResolve = null
          surface.version += 1
          store.set({ ...store.getSnapshot(), pendingQuestion: null, version: surface.version })
          resolve?.([...answers])
        },
        updateSetting: patch => ctx.settings.update('tui', patch as object),
        togglePlugin,
        updatePluginConfig: async (ns, patch) => {
          try {
            await ctx.settings.update(ns, patch as object)
            return null
          } catch (error) {
            return `${uiText('写入失败', 'Write failed')}: ${error instanceof Error ? error.message : String(error)}`
          }
        },
        setCredential: (ref, value) => ctx.credentials.set(credentialRef(ref), value),
        unsetCredential: ref => ctx.credentials.unset(credentialRef(ref)),
        refreshSettings: refreshSettings,
        refreshPanels: (kind) => {
          if (kind === 'jobs') {
            surface.jobs = jobsRows(ctx, surface.agent, Date.now())
            surface.version += 1
            store.set({ ...store.getSnapshot(), jobs: surface.jobs, version: surface.version })
            return
          }
          if (kind === 'subagents') {
            void subagentRows(ctx, surface.agent.id).then((rows) => {
              surface.subagents = rows
              surface.version += 1
              store.set({ ...store.getSnapshot(), subagents: rows, version: surface.version })
            }).catch(() => {})
            return
          }
          const liveRows: SessionEntry[] = ctx.agents.list().map((agent): SessionEntry => ({
            id: agent.id,
            model: agent.options.model ?? '',
            status: agent.status,
          }))
          void loadSessionRows(ctx, liveRows).then((rows) => {
            surface.version += 1
            store.set({ ...store.getSnapshot(), sessions: rows, version: surface.version })
          }).catch(() => {})
        },
        killJob: (id) => {
          const jobs = ctx.get('jobs')
          try { jobs?.kill(JobId(id), surface.agent) } catch {}
          surface.jobs = jobsRows(ctx, surface.agent, Date.now())
          surface.version += 1
          store.set({ ...store.getSnapshot(), jobs: surface.jobs, version: surface.version })
        },
        rateMessage: async (messageId, rating) => {
          const service = ctx.get('messageFeedback')
          if (service === undefined) {
            return uiText('消息反馈服务未加载（bundle 缺 dsh-message-feedback）', 'Message feedback service is not loaded (bundle lacks dsh-message-feedback)')
          }
          const sessionId = surface.agent.id
          const current = surface.feedback.get(messageId)
          // Rating the same value again removes the item (Web toggle parity).
          if (current !== undefined && current.rating === rating) {
            const result = await service.delete({ sessionId, messageId: MessageId(messageId), ifVersion: current.version })
            if (result.ok) {
              surface.feedback = new Map(surface.feedback)
              surface.feedback.delete(messageId)
              publishFeedback()
              return null
            }
            if (result.error.code === 'version-conflict') {
              await loadFeedback()
              return null
            }
            return feedbackErrorText(result.error, uiLocale())
          }
          const result = await service.put({
            sessionId,
            messageId: MessageId(messageId),
            rating,
            ifVersion: current?.version ?? null,
          })
          if (result.ok) {
            surface.feedback = new Map(surface.feedback)
            surface.feedback.set(messageId, result.value)
            publishFeedback()
            return null
          }
          if (result.error.code === 'version-conflict') {
            // Someone else changed the item: re-apply against the
            // authoritative current value exactly once.
            const retry = await service.put({
              sessionId,
              messageId: MessageId(messageId),
              rating,
              ifVersion: result.error.current?.version ?? null,
            })
            if (retry.ok) {
              surface.feedback = new Map(surface.feedback)
              surface.feedback.set(messageId, retry.value)
              publishFeedback()
              return null
            }
            if (retry.error.code === 'version-conflict') {
              await loadFeedback()
              return null
            }
            return feedbackErrorText(retry.error, uiLocale())
          }
          return feedbackErrorText(result.error, uiLocale())
        },
        ...(panel === null ? {} : { startup: { panel } }),
      })
      // The startup prompt is a real user submission through the unified
      // dispatch path once Ink owns the terminal — never a simulated Enter.
      if (intent.prompt !== undefined) void dispatchOrFollowup(intent.prompt, false).catch((error: unknown) => { fail(ctx, error) })
      await inkDone
    } else {
      if (panel !== null) {
        // The sessions picker (bare --resume or an ambiguous query) needs an
        // interactive surface; the line-driven fallback has no panel.
        fail(ctx, new Error('--resume 面板需要交互终端'), EXIT_USAGE)
        return
      }
      const { runLegacy } = await import('./legacy')
      /**
       * One linear-mode submission: guard TUI-local slash commands, dispatch
       * through the unified path, wait for the turn, and render the new rows.
       * Shared by the REPL prompt handler and the startup prompt, so both
       * produce the same plain output for the same submission.
       */
      const runLinearPrompt = async (text: string): Promise<void> => {
        // TUI-local slash commands (panels, selection, sessions, presets…)
        // have no linear-mode surface. Only host commands and plain prompts
        // proceed — sending a UI directive to the model would pollute the turn.
        if (text.startsWith('/')) {
          const known = ctx.get('commands')?.list(surface.agent) ?? []
          if (!known.some(command => command.name === text.split(' ')[0])) {
            process.stdout.write('(linear mode: this command is only available in the interactive TUI)\n')
            return
          }
        }
        const firstCount = store.getSnapshot().nodes.length
        await dispatchOrFollowup(text, false)
        await surface.agent.whenIdle()
        const nodes = store.getSnapshot().nodes
        for (const node of nodes.slice(firstCount)) {
          const rendered = renderNodePlain(node, (tuiScope.get() as GeneralSettings).locale)
          if (rendered !== '') process.stdout.write(rendered + '\n')
        }
      }
      // The startup prompt runs through the same linear path as a REPL line;
      // it settles BEFORE the REPL starts so an immediate piped EOF cannot
      // exit mid-turn and swallow the rendered result.
      if (intent.prompt !== undefined) await runLinearPrompt(intent.prompt)
      const legacyDone = runLegacy({
        onPrompt: async (text) => { await runLinearPrompt(text) },
        onExit: () => requestExit(ctx, EXIT_OK),
      }, (tuiScope.get() as GeneralSettings).locale)
      await legacyDone
    }
  } catch (error) {
    fail(ctx, error)
  } finally {
    try { offSkillsChange() } catch {}
    try { unsubscribe() } catch {}
    try { await surface.agent.whenIdle() } catch {}
    await recency.drain()
    await projections.drain()
  }
}

/**
 * Mount the TUI surface and register its settings namespace (`tui` in
 * `$DSH_HOME/settings.yaml`): busyEnter and the thinking display default.
 * Registering a namespace does not touch the request envelope, so the
 * cache-safety contract stands.
 * @param ctx - plugin context carrying the agent registry, default model, tool registry, settings, and credentials.
 * @param config - validated TUI plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const tuiScope = ctx.settings.register('tui', z.object({
    busyEnter: z.union(['queue', 'steer']).default('queue'),
    thinking: z.union(['collapsed', 'expanded']).default('collapsed'),
    theme: z.union(['dark', 'light']).default('dark'),
    locale: z.union(['zh', 'en']).default('zh'),
  }))
  void boot(ctx, tuiScope, config).catch((error: unknown) => { fail(ctx, error) })
}
