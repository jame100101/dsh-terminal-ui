/**
 * Owner-scoped projection for the TUI jobs panel. The registry remains the
 * authority for visibility; this helper only formats fresh snapshots.
 * @module @deepseek-ai/dsh-tui/src/jobs-projection
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobRegistry, JobView } from '@deepseek-ai/dsh-jobs'
import type { JobRow } from './store'

type JobsList = Pick<JobRegistry, 'list'>
type JobsChanges = Pick<JobRegistry, 'events'>
const historyCache = new WeakMap<object, { count: number; last: SessionEvent | undefined; rows: JobRow[] }>()

/**
 * Read the jobs visible to one exact agent and project elapsed time for the
 * panel. Passing the session ID is intentional: an omitted caller only sees
 * unowned jobs under the JobRegistry contract.
 * @param jobs - process-local registry implementation.
 * @param agent - current TUI surface agent.
 * @param now - epoch milliseconds used for live rows.
 * @returns owner-scoped panel rows in registry order.
 */
export function projectJobsRows(jobs: JobsList, agent: Agent, now: number): JobRow[] {
  const liveRows = jobs.list(agent.id).map((snapshot: JobView): JobRow => ({
    id: snapshot.id,
    kind: snapshot.kind,
    label: snapshot.label,
    status: snapshot.status,
    ...(snapshot.detail === undefined ? {} : { detail: snapshot.detail }),
    elapsedMs: (snapshot.finishedAt ?? now) - snapshot.startedAt,
  }))
  if (!agent.session) return liveRows
  const events = agent.session.snapshotEvents()
  const cached = historyCache.get(agent.session)
  const extendsCached = cached !== undefined && events.length >= cached.count && (cached.count === 0 || events[cached.count - 1] === cached.last)
  const history = extendsCached ? mergeHistoricalJobs([], events.slice(cached.count), agent.id, cached.rows) : mergeHistoricalJobs([], events, agent.id)
  historyCache.set(agent.session, { count: events.length, last: events.at(-1), rows: history })
  return mergeHistoricalJobs(liveRows, [], agent.id, history)
}

/**
 * Decide whether an owner-relative registry change can alter one surface.
 * Unowned jobs are visible to every caller; owned jobs use Session identity.
 * @param owner - owner reported by the public event stream, or undefined for unowned work.
 * @param current - surface Agent whose panel is subscribed.
 * @returns whether the surface should refresh.
 */
export function jobsChangeVisibleTo(owner: SessionId | undefined, current: Agent): boolean {
  return owner === undefined || owner === current.id
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
  return jobs.events.subscribe({ owners: 'all' }, (event) => {
    const owner = event.type === 'output' ? event.owner : event.job.owner
    if (jobsChangeVisibleTo(owner, current())) refresh()
  })
}

/** Replay is evidence of past work, never authority to restart or cancel an execution. */
export function mergeHistoricalJobs(liveRows: readonly JobRow[], events: readonly SessionEvent[], owner: SessionId, previous: readonly JobRow[] = []): JobRow[] {
  const rows = new Map<string, JobRow>(previous.map(row => [row.id, row]))
  for (const event of events) {
    if ((event.type !== 'job/registered' && event.type !== 'job/settled') || event.data.owner !== owner) continue
    const data = event.data
    if (event.type === 'job/settled') {
      rows.set(String(data.jobId), { id: String(data.jobId), kind: data.kind, label: data.label,
        status: event.data.status, elapsedMs: Math.max(0, event.data.finishedAt - data.startedAt),
        ...(event.data.detail === undefined ? {} : { detail: event.data.detail }) })
    } else if (!rows.has(String(data.jobId))) {
      rows.set(String(data.jobId), { id: String(data.jobId), kind: data.kind, label: data.label, status: 'interrupted',
        elapsedMs: Math.max(0, event.time - data.startedAt), detail: 'No live registry owner; execution outcome is unknown' })
    }
  }
  // The live registry wins even when session persistence has only seen registration.
  const liveIds = new Set(liveRows.map(row => row.id))
  return [...liveRows, ...[...rows.values()].filter(row => !liveIds.has(row.id))]
}
