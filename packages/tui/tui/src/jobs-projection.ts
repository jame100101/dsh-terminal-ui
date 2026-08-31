/**
 * Owner-scoped projection for the TUI jobs panel. The registry remains the
 * authority for visibility; this helper only formats fresh snapshots.
 * @module @deepseek-ai/dsh-tui/src/jobs-projection
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobRegistry, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { JobRow } from './store'

type JobsList = Pick<JobRegistry, 'list'>
type JobsChanges = Pick<JobRegistry, 'onJobsChanged'>

/**
 * Read the jobs visible to one exact agent and project elapsed time for the
 * panel. Passing the agent is intentional: an omitted caller only sees
 * unowned jobs under the JobRegistry contract.
 * @param jobs - process-local registry implementation.
 * @param agent - current TUI surface agent.
 * @param now - epoch milliseconds used for live rows.
 * @returns owner-scoped panel rows in registry order.
 */
export function projectJobsRows(jobs: JobsList, agent: Agent, now: number): JobRow[] {
  return jobs.list(agent).map((snapshot: JobSnapshot): JobRow => ({
    id: snapshot.id,
    kind: snapshot.kind,
    label: snapshot.label,
    status: snapshot.status,
    ...(snapshot.detail === undefined ? {} : { detail: snapshot.detail }),
    elapsedMs: (snapshot.finishedAt ?? now) - snapshot.startedAt,
  }))
}

/**
 * Decide whether an owner-relative registry change can alter one surface.
 * Unowned jobs are visible to every caller; owned jobs use exact Agent identity.
 * @param owner - owner reported by `onJobsChanged`, or undefined for unowned work.
 * @param current - surface Agent whose panel is subscribed.
 * @returns whether the surface should refresh.
 */
export function jobsChangeVisibleTo(owner: Agent | undefined, current: Agent): boolean {
  return owner === undefined || owner === current
}

/**
 * Subscribe one surface to registry changes visible to its current Agent. The
 * Agent is read for each notification so a surface swap never retains the old
 * owner identity; disposing the returned subscription stops all refreshes.
 * @param jobs - process-local registry change source.
 * @param current - returns the exact Agent currently owned by the surface.
 * @param refresh - re-reads and publishes the current visible job set.
 * @returns disposer for the registry observer.
 */
export function subscribeVisibleJobs(
  jobs: JobsChanges,
  current: () => Agent,
  refresh: () => void,
): () => void {
  return jobs.onJobsChanged((owner) => {
    if (jobsChangeVisibleTo(owner, current())) refresh()
  })
}
