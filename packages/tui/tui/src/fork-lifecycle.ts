/**
 * Agent creation used by the TUI fork command. Keeping this lifecycle in a
 * small module makes the preset, route, seed, and rollback contract directly
 * testable without exposing the renderer's private surface state.
 * @module @deepseek-ai/dsh-tui/src/fork-lifecycle
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { recordedPreset, resolveTuiPreset } from './preset-lifecycle'
import { forkCutPoint, selectionFromRequestHistory } from './startup'

/** Inputs needed to create and publish one fork Agent. */
export interface ForkAgentInput {
  /** Prefix of the source log at the chosen fork boundary. */
  seed: readonly SessionEvent[]
  /** Workspace metadata copied to the child session. */
  cwd: string
  /** Durable parent lineage id. */
  parentSession: SessionId
  /** Effective preset recorded by the source prefix, when one is composed. */
  presetId?: string
  /** Model route reconstructed from the source prefix. */
  selection: ModelSelection
}

/** Inputs for the persisted artifact semantics used by the TUI fork command. */
export interface ForkArtifactInput {
  /** Current surface Agent whose durable log supplies the fork seed. */
  source: Agent
  /** Workspace metadata copied to the child Session. */
  cwd: string
  /** Optional event sequence anchoring the containing completed turn. */
  atSeq?: number
}

/**
 * Create and persist one fork child under the exact preset and model route
 * selected for its seed. Agent-loop publication remains the rollback boundary:
 * a rejected preset mount disposes the unpublished child and leaves no live
 * registry entry.
 * @param ctx - host context carrying the agent registry and preset roster.
 * @param input - source seed, lineage, and effective route.
 * @returns the unpublished-then-published child handle.
 * @throws when preset resolution, mounting, or child creation fails.
 */
export async function createForkAgent(ctx: Context, input: ForkAgentInput): Promise<AgentHandle> {
  const preset = await resolveTuiPreset(ctx, input.presetId)
  const ref: ModelSelectionRef = { current: { ...input.selection }, assembled: undefined }
  return ctx.agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    seed: input.seed,
    inheritedEventCount: SessionLogOffset(input.seed.length),
    meta: {
      cwd: input.cwd,
      parentSession: input.parentSession,
      isSeeded: true,
      ...(preset.kind === 'preset' ? { agentPreset: preset.id } : {}),
    },
    agentOptions: {
      provider: input.selection.provider,
      model: input.selection.model,
      ...(input.selection.reasoningEffort === undefined ? {} : { reasoningEffort: input.selection.reasoningEffort }),
    },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, ref)
      if (preset.kind === 'preset') await preset.service.mount(agentCtx, preset.id)
    },
  })
}

/**
 * Create a fork at one completed-turn boundary, persist it, and immediately
 * dispose its live handle. The resulting Session is a cold artifact ready for
 * the caller to resume; the source remains the only live surface Agent.
 * @param ctx - host context carrying Agent, preset, and default-model services.
 * @param input - source Agent, workspace, and optional event anchor.
 * @returns the persisted child id, or null when no completed turn exists.
 */
export async function createForkArtifact(ctx: Context, input: ForkArtifactInput): Promise<SessionId | null> {
  const events = input.source.session.snapshotEvents()
  const cut = forkCutPoint(events, input.atSeq)
  if (cut === null) return null
  const seed = events.slice(0, cut)
  const presetId = recordedPreset(input.source.session.header, seed)
  const fork = await createForkAgent(ctx, {
    seed,
    cwd: input.cwd,
    parentSession: input.source.id,
    ...(presetId === undefined ? {} : { presetId }),
    selection: selectionFromRequestHistory(seed, ctx.agentDefaultModel.currentSelection()),
  })
  const forkId = fork.agent.id
  try {
    if (!await ctx.sessions.flush(fork.agent.session)) {
      throw new Error('cannot persist TUI fork: no session durability provider participated')
    }
  } catch (error) {
    try {
      await fork.dispose()
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], 'TUI fork persistence and rollback both failed')
    }
    throw error
  }
  await fork.dispose()
  return forkId
}
