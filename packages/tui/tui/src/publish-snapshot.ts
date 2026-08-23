/**
 * Choose which snapshot fields a coalesced stream publish may reuse so a
 * text-delta does not rebuild sessions, jobs, settings, or occupancy.
 * @module @deepseek-ai/dsh-tui/src/publish-snapshot
 */

import type { TuiSnapshot } from './store'

/** Chrome and panel fields that a stream-chunk publish must not recompute. */
export type PanelSnapshot = Pick<TuiSnapshot,
  | 'commands'
  | 'skills'
  | 'models'
  | 'sessions'
  | 'queued'
  | 'settings'
  | 'jobs'
  | 'subagents'
  | 'workflows'
  | 'feedback'
  | 'reasoning'
  | 'attachmentCount'
  | 'pendingImages'
  | 'sandbox'
  | 'occupancy'
>

/**
 * Return the previous panel fields, or the freshly computed set.
 * @param previous - the last published snapshot.
 * @param reusePanels - true for coalesced assistant-chunk publishes.
 * @param compute - builds panel fields; skipped when `reusePanels` is true.
 * @returns panel fields to embed in the next snapshot.
 */
export function selectPanelSnapshot(
  previous: TuiSnapshot,
  reusePanels: boolean,
  compute: () => PanelSnapshot,
): PanelSnapshot {
  if (!reusePanels) return compute()
  return {
    commands: previous.commands,
    skills: previous.skills,
    models: previous.models,
    sessions: previous.sessions,
    queued: previous.queued,
    settings: previous.settings,
    jobs: previous.jobs,
    subagents: previous.subagents,
    workflows: previous.workflows,
    feedback: previous.feedback,
    reasoning: previous.reasoning,
    attachmentCount: previous.attachmentCount,
    pendingImages: previous.pendingImages,
    sandbox: previous.sandbox,
    occupancy: previous.occupancy,
  }
}
