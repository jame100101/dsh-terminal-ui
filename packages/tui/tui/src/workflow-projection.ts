/**
 * Durable workflow projection for the TUI. The workflow tool records its
 * top-level lifecycle in the calling Session; this module folds those events
 * identically for replay and live session-event delivery.
 * @module @deepseek-ai/dsh-tui/src/workflow-projection
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkflowRow } from './store'

/** Cosmetic workflow facts that exist only while the owning process is live. */
export interface WorkflowOverlay {
  phase?: string
  lastLog?: string
}

/** One accepted update to the current surface's workflow projection. */
export interface WorkflowProjectionUpdate {
  workflows: Map<string, WorkflowRow>
  overlays: Map<string, WorkflowOverlay>
}

interface RunStartData {
  runId: string
  name: string
}

interface AgentStartData {
  runId: string
  phase?: string
}

interface RunEndData {
  runId: string
  stopReason: string
}

type DurableWorkflowEvent =
  | { type: 'tool-workflow/run-start'; data: RunStartData }
  | { type: 'tool-workflow/agent-start'; data: AgentStartData }
  | { type: 'tool-workflow/agent-end'; data: { runId: string } }
  | { type: 'tool-workflow/run-end'; data: RunEndData }

/** Read the workflow event family without making process-global lifecycle events authoritative. */
function durableEvent(event: SessionEvent): DurableWorkflowEvent | null {
  const value = event as unknown as { type?: unknown; data?: unknown }
  const type = value.type
  if (typeof type !== 'string' || !type.startsWith('tool-workflow/')) return null
  if (typeof value.data !== 'object' || value.data === null || Array.isArray(value.data)) return null
  const data = value.data as Record<string, unknown>
  if (typeof data.runId !== 'string') return null
  if (type === 'tool-workflow/run-start' && typeof data.name === 'string') {
    return { type, data: { runId: data.runId, name: data.name } }
  }
  if (type === 'tool-workflow/agent-start') {
    return {
      type,
      data: { runId: data.runId, ...(typeof data.phase === 'string' ? { phase: data.phase } : {}) },
    }
  }
  if (type === 'tool-workflow/agent-end') return { type, data: { runId: data.runId } }
  if (type === 'tool-workflow/run-end' && typeof data.stopReason === 'string') {
    return { type, data: { runId: data.runId, stopReason: data.stopReason } }
  }
  return null
}

/** Map a durable workflow stop reason to the TUI row status. */
function statusFromStopReason(stopReason: string): WorkflowRow['status'] {
  if (stopReason === 'completed') return 'completed'
  if (stopReason === 'cancelled') return 'cancelled'
  return 'error'
}

/**
 * Create an empty workflow projection.
 * @returns a new projection map.
 */
export function createWorkflowProjection(): Map<string, WorkflowRow> {
  return new Map()
}

/**
 * Apply one durable workflow event. Unknown or out-of-order updates leave the
 * projection unchanged; a member event cannot invent a run absent its start.
 * @param current - current rows.
 * @param event - session event to fold.
 * @returns the updated map, or the same map when the event is unrelated.
 */
export function applyWorkflowSessionEvent(
  current: Map<string, WorkflowRow>,
  event: SessionEvent,
): Map<string, WorkflowRow> {
  const durable = durableEvent(event)
  if (durable === null) return current
  const id = durable.data.runId
  const next = new Map(current)
  if (durable.type === 'tool-workflow/run-start') {
    next.set(id, { id, name: durable.data.name, status: 'running', agentsStarted: 0 })
    return next
  }
  const row = current.get(id)
  if (row === undefined) return current
  if (durable.type === 'tool-workflow/agent-start') {
    next.set(id, {
      ...row,
      agentsStarted: row.agentsStarted + 1,
      ...(durable.data.phase === undefined ? {} : { phase: durable.data.phase }),
    })
    return next
  }
  if (durable.type === 'tool-workflow/agent-end') return current
  next.set(id, { ...row, status: statusFromStopReason(durable.data.stopReason) })
  return next
}

/**
 * Replay all durable workflow events in log order.
 * @param events - session events from one session.
 * @returns the workflow rows owned by that session.
 */
export function foldWorkflowSessionEvents(events: readonly SessionEvent[]): Map<string, WorkflowRow> {
  let current = createWorkflowProjection()
  for (const event of events) current = applyWorkflowSessionEvent(current, event)
  return current
}

/**
 * Merge a current-session cosmetic phase/log update onto one durable row.
 * @param row - durable row already proven to belong to the current session.
 * @param update - latest ephemeral fields.
 * @returns a row with the cosmetic fields applied.
 */
export function applyWorkflowOverlay(
  row: WorkflowRow,
  update: WorkflowOverlay,
): WorkflowRow {
  return {
    ...row,
    ...(update.phase === undefined ? {} : { phase: update.phase }),
    ...(update.lastLog === undefined ? {} : { lastLog: update.lastLog.slice(0, 200) }),
  }
}

/**
 * Apply one durable delivery only when its exact Session is the surface owner.
 * Existing cosmetic values are retained for a live row and forgotten after a
 * terminal durable event; unknown events return null without publishing.
 * @param owner - exact Session currently owned by the TUI surface.
 * @param source - Session carried by the global dispatch event.
 * @param workflows - current durable rows with any applied live cosmetics.
 * @param overlays - current live-only cosmetic values.
 * @param event - delivered Session event.
 * @returns replacement maps, or null when the delivery is foreign/unrelated.
 */
export function projectWorkflowSessionDelivery(
  owner: Session,
  source: Session,
  workflows: Map<string, WorkflowRow>,
  overlays: Map<string, WorkflowOverlay>,
  event: SessionEvent,
): WorkflowProjectionUpdate | null {
  if (source !== owner) return null
  const durable = durableEvent(event)
  if (durable === null) return null
  const nextWorkflows = applyWorkflowSessionEvent(workflows, event)
  if (nextWorkflows === workflows) return null
  const id = durable.data.runId
  const overlay = overlays.get(id)
  if (overlay !== undefined) {
    const row = nextWorkflows.get(id)
    if (row !== undefined) nextWorkflows.set(id, applyWorkflowOverlay(row, overlay))
  }
  if (durable.type !== 'tool-workflow/run-end' || !overlays.has(id)) {
    return { workflows: nextWorkflows, overlays }
  }
  const nextOverlays = new Map(overlays)
  nextOverlays.delete(id)
  return { workflows: nextWorkflows, overlays: nextOverlays }
}

/**
 * Apply a process-global phase/log update only after the current Session's
 * durable projection proves ownership of its run id.
 * @param workflows - current durable rows.
 * @param overlays - current live-only cosmetics.
 * @param runId - process-global workflow run id.
 * @param update - latest phase or log value.
 * @returns replacement maps, or null when this surface owns no such run.
 */
export function projectWorkflowOverlay(
  workflows: Map<string, WorkflowRow>,
  overlays: Map<string, WorkflowOverlay>,
  runId: string,
  update: WorkflowOverlay,
): WorkflowProjectionUpdate | null {
  const row = workflows.get(runId)
  if (row === undefined || row.status !== 'running') return null
  const nextOverlay = { ...overlays.get(runId), ...update }
  const nextOverlays = new Map(overlays)
  nextOverlays.set(runId, nextOverlay)
  const nextWorkflows = new Map(workflows)
  nextWorkflows.set(runId, applyWorkflowOverlay(row, nextOverlay))
  return { workflows: nextWorkflows, overlays: nextOverlays }
}
