/**
 * Agent-preset lifecycle helpers owned by the terminal surface.
 *
 * The bundle keeps model-facing rows behind presets, so every TUI agent must
 * resolve and mount one preset before its session header is created. Preset
 * switches and prompt admission share a per-session queue: their order is the
 * order the user submitted, and an accepted prompt reserves the session before
 * the next queued switch can observe it as blank.
 *
 * @module @deepseek-ai/dsh-tui/preset-lifecycle
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** A deployment with no preset roster, or the exact preset resolved for an agent. */
export type TuiPresetResolution =
  | { kind: 'none' }
  | { kind: 'preset'; id: string; service: AgentPresets }

/** The live agent and model-selection state created for one TUI session. */
export interface CreatedTuiAgent {
  /** The registered live agent. */
  agent: Agent
  /** The handle whose disposer owns the live agent. */
  handle: AgentHandle
  /** The model route captured when the agent was created. */
  selection: ModelSelection
  /** Mutable model selection installed in the agent scope. */
  ref: ModelSelectionRef
  /** The actual preset id written to the session header, when presets are composed. */
  presetId?: string
}

/**
 * Resolve the exact preset id an agent will mount.
 *
 * An explicit recorded id requires a roster because silently dropping it
 * would resume a session under a different tool and prompt composition. A
 * rosterless deployment remains valid only for sessions that record no
 * preset.
 * @param ctx - host context carrying the optional preset roster.
 * @param requestedId - recorded or selected id, or undefined for the roster default.
 * @returns the resolved preset service and id, or a rosterless result.
 * @throws when a recorded id has no roster or resolution rejects the id.
 */
export async function resolveTuiPreset(ctx: Context, requestedId?: string): Promise<TuiPresetResolution> {
  const service = ctx.get('agentPresets')
  if (service === undefined) {
    if (requestedId !== undefined) {
      throw new Error(`agent preset "${requestedId}" is recorded but this deployment composes no preset roster`)
    }
    return { kind: 'none' }
  }
  const preset = await service.resolve(requestedId)
  return { kind: 'preset', id: preset.id, service }
}

/**
 * Create one TUI agent under the resolved preset and record the same id in
 * its immutable session header.
 * @param ctx - host context carrying agents, the default model, and optional presets.
 * @param cwd - working directory written to the session header.
 * @param requestedPreset - explicit preset to continue, or undefined for the roster default.
 * @returns the live agent, its owning handle, model selection, and resolved preset id.
 * @throws when preset resolution, mounting, or agent creation fails.
 */
export async function createTuiAgent(
  ctx: Context,
  cwd: string,
  requestedPreset?: string,
): Promise<CreatedTuiAgent> {
  const selection = ctx.agentDefaultModel.currentSelection()
  const ref: ModelSelectionRef = { current: selection, assembled: undefined }
  const preset = await resolveTuiPreset(ctx, requestedPreset)
  const handle = await ctx.agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd, ...(preset.kind === 'preset' ? { agentPreset: preset.id } : {}) },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, ref)
      if (preset.kind === 'preset') await preset.service.mount(agentCtx, preset.id)
    },
  })
  return {
    agent: handle.agent,
    handle,
    selection,
    ref,
    ...(preset.kind === 'preset' ? { presetId: preset.id } : {}),
  }
}

/**
 * Serializes preset switches and prompt admission independently per session.
 * A rejected operation does not poison later work, and a settled tail is
 * removed when no newer operation replaced it.
 */
export class SessionPresetQueue {
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly admittedPrompts = new Set<SessionId>()

  /**
   * Run one operation after all earlier operations for the same session.
   * @param sessionId - session whose composition or prompt admission is changing.
   * @param operation - work to run after the preceding session operation settles.
   * @returns the operation's value or rejection.
   */
  run<T>(sessionId: SessionId, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(sessionId, tail)
    void tail.then(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId)
    })
    return result
  }

  /**
   * Reserve a session for a prompt before the next queued preset check.
   * Call only from inside {@link run} after local validation accepts the prompt.
   * @param sessionId - session receiving the prompt.
   */
  claimPrompt(sessionId: SessionId): void {
    this.admittedPrompts.add(sessionId)
  }

  /**
   * Whether a preset switch must reject because a prompt was admitted or a
   * durable turn already exists.
   * @param sessionId - session whose blank-state is being checked.
   * @param events - current durable session events.
   * @returns true once prompt admission or `turn/start` fixes the composition.
   */
  presetLocked(sessionId: SessionId, events: readonly SessionEvent[]): boolean {
    return this.admittedPrompts.has(sessionId) || events.some(event => event.type === 'turn/start')
  }

  /**
   * Release TUI-local admission state after the session leaves the surface.
   * @param sessionId - replaced session id.
   */
  forget(sessionId: SessionId): void {
    this.admittedPrompts.delete(sessionId)
  }
}
