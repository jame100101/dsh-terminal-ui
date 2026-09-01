/**
 * Preparation of a persisted Session for a TUI surface swap. Everything in
 * this module completes while the old surface still owns its Agent; callers
 * either adopt the returned handle or dispose it.
 * @module @deepseek-ai/dsh-tui/src/resume-lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { recordedPreset, resolveTuiPreset } from './preset-lifecycle'
import { selectionFromRequestHistory } from './startup'

/** Durable target facts read before a resume publishes an Agent. */
export interface TuiResumeSnapshot {
  /** Persisted Session metadata. */
  header: SessionHeader
  /** Replay-validated Session events in log order. */
  events: readonly SessionEvent[]
}

/** Model selector metadata presented by the resumed TUI surface. */
export interface TuiReasoningState {
  /** Explicit target effort or the adapter default. */
  effort: string | undefined
  /** Effort ids supported by the target adapter model. */
  levels: string[]
}

/** Fully published target Agent awaiting transcript replay and surface adoption. */
export interface PreparedTuiResume {
  /** Handle the caller must adopt or dispose. */
  handle: AgentHandle
  /** Route reconstructed from the target durable request history. */
  selection: ModelSelection
  /** Mutable request-routing state installed in the resumed Agent scope. */
  ref: ModelSelectionRef
  /** Reasoning metadata resolved from the same route. */
  reasoning: TuiReasoningState
  /** Authoritative events from the published resumed Session. */
  events: readonly SessionEvent[]
}

/** Throw the caller's cancellation reason at an awaited preparation boundary. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return
  throw signal.reason instanceof Error ? signal.reason : new Error('TUI resume cancelled')
}

/** Resolve exact-route reasoning metadata, propagating adapter lookup failure. */
async function resolveRequiredTuiReasoning(
  ctx: Context,
  selection: ModelSelection,
  signal?: AbortSignal,
): Promise<TuiReasoningState> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throwIfAborted(signal)
    return { effort: selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort), levels: [] }
  }
  const resolved = await llm.resolveModelInfo(selection.provider, selection.model, signal)
  throwIfAborted(signal)
  const reasoning = resolved.reasoning
  return {
    effort: selection.reasoningEffort === undefined
      ? reasoning?.defaultEffort === undefined ? undefined : String(reasoning.defaultEffort)
      : String(selection.reasoningEffort),
    levels: reasoning?.efforts.map(info => String(info.id)) ?? [],
  }
}

/**
 * Resolve reasoning metadata for a live route. A temporarily unavailable
 * adapter leaves the optional control empty; cancellation remains an operation
 * failure rather than an adapter fallback.
 * @param ctx - host context carrying the optional LLM registry.
 * @param selection - target provider, model, and optional explicit effort.
 * @param signal - optional preparation cancellation.
 * @returns reasoning state for the target route.
 */
export async function resolveTuiReasoning(
  ctx: Context,
  selection: ModelSelection,
  signal?: AbortSignal,
): Promise<TuiReasoningState> {
  try {
    return await resolveRequiredTuiReasoning(ctx, selection, signal)
  } catch (_error) {
    throwIfAborted(signal)
    return { effort: selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort), levels: [] }
  }
}

/**
 * Resume and fully compose a target Agent while the current surface remains
 * untouched. Setup failure is rolled back by AgentLoop; a failure after
 * publication disposes the returned handle before this function rejects.
 * @param ctx - host context carrying Agent, preset, model, and LLM services.
 * @param sessionId - persisted Session identity to resume.
 * @param snapshot - validated target metadata and events.
 * @param fallback - deployment model used only for a history without request headers.
 * @param signal - cancellation for persistence load, preset setup, and model metadata.
 * @returns a published, fully composed handle and its target projection facts.
 */
export async function prepareTuiResume(
  ctx: Context,
  sessionId: SessionId,
  snapshot: TuiResumeSnapshot,
  fallback: ModelSelection,
  signal?: AbortSignal,
): Promise<PreparedTuiResume> {
  throwIfAborted(signal)
  const selection = selectionFromRequestHistory(snapshot.events, fallback)
  const ref: ModelSelectionRef = { current: selection, assembled: undefined }
  const recorded = recordedPreset(snapshot.header, snapshot.events)
  const missingPresetMetadata = recorded === undefined
  const preset = await resolveTuiPreset(ctx, recorded)
  throwIfAborted(signal)
  // Resume is transactional: unlike a background catalog refresh, a recorded
  // route must resolve before the replacement Agent is published and adopted.
  const reasoning = await resolveRequiredTuiReasoning(ctx, selection, signal)
  throwIfAborted(signal)

  let handle: AgentHandle | undefined
  try {
    handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      ...(signal === undefined ? {} : { signal }),
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      },
      setup: async (agentCtx) => {
        installModelSelection(agentCtx, ref)
        if (preset.kind === 'preset') await preset.service.mount(agentCtx, preset.id)
      },
    })
    throwIfAborted(signal)
    if (missingPresetMetadata && preset.kind === 'preset') {
      // Persist the resolved fallback so a later roster-default change cannot
      // silently recompose this migrated Session under a different preset.
      handle.agent.session.append('agent-preset/selected', { agentPreset: preset.id })
    }
    return { handle, selection, ref, reasoning, events: handle.agent.session.events }
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.dispose()
      } catch (disposeError) {
        throw new AggregateError([error, disposeError], 'TUI resume preparation and rollback both failed')
      }
    }
    throw error
  }
}

/**
 * Run transcript/projection preparation for a published resume target and
 * dispose that target if preparation rejects. The old surface remains outside
 * this transaction and therefore stays unchanged.
 * @param handle - published target awaiting surface adoption.
 * @param replay - transcript and auxiliary projection preparation.
 * @returns the prepared projection value.
 */
export async function replayTuiResumeOrDispose<T>(
  handle: AgentHandle,
  replay: () => Promise<T>,
): Promise<T> {
  try {
    return await replay()
  } catch (error) {
    try {
      await handle.dispose()
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], 'TUI resume replay and rollback both failed')
    }
    throw error
  }
}
