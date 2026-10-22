import { describe, expect, it } from 'vitest'
import { buildTaskCenterItems, buildTaskCenterRows, buildTaskDetailRows, TASK_FILTERS, type TaskSnapshot } from '../src/task-center'

function facts(): TaskSnapshot {
  return {
    jobs: [
      { id: 'same:id', kind: 'bash', label: 'compile', status: 'running', elapsedMs: 1200 },
      { id: 'wait', kind: 'tool', label: 'approval', status: 'waiting', elapsedMs: 0 },
      { id: 'lost', kind: 'bash', label: 'unknown result', status: 'interrupted', elapsedMs: 100 },
      { id: 'bad', kind: 'bash', label: 'failed build', status: 'failed', elapsedMs: 50 },
    ],
    subagents: [
      { id: 'same:id', label: 'review', mode: 'continuable', activity: 'running', depth: 1, preset: 'minimal' },
      { id: 'inactive', label: 'persisted', mode: 'one-shot', activity: 'inactive', depth: 2 },
      { id: 'diagnostic', label: 'missing record', mode: 'diagnostic', activity: 'diagnostic', depth: 1 },
    ],
    workflows: [
      { id: 'same:id', name: 'pipeline', status: 'completed', agentsStarted: 2 },
      { id: 'failure', name: 'pipeline', status: 'error', agentsStarted: 1, phase: 'build', error: 'exit 1', lastLog: 'actual output' },
      { id: 'cancel', name: 'cancelled', status: 'cancelled', agentsStarted: 0 },
    ],
  }
}

describe('unified task center host projection', () => {
  it('namespaces complete host IDs and keeps action metadata across filtering/reordering', () => {
    const snapshot = facts()
    const all = buildTaskCenterItems(snapshot)
    expect(new Set(all.map(row => row.key)).size).toBe(all.length)
    expect(all.filter(row => row.id === 'same:id').map(row => row.key)).toEqual(['jobs:same:id', 'subagents:same:id', 'workflows:same:id'])
    expect(all.every(entry => entry.row.action === 'inspect-task' && entry.row.meta?.id === entry.key)).toBe(true)
    const job = all[0]!
    expect(job.row.action).toBe('inspect-task')
    expect(job.row.meta).toEqual({ id: 'jobs:same:id' })
    expect(buildTaskCenterItems({ ...snapshot, jobs: [...snapshot.jobs].reverse() }, 'running')[0]).toEqual(job)
    for (const entry of all) {
      const details = buildTaskDetailRows(snapshot, entry.row.meta!.id!, 'en')
      expect(details.some(row => row.key === 'task-missing')).toBe(false)
    }
  })

  it('filters only justified host states; inactive, interrupted and cancelled never become done', () => {
    const snapshot = facts()
    expect(buildTaskCenterItems(snapshot, 'running').map(row => row.key)).toEqual(['jobs:same:id', 'subagents:same:id'])
    expect(buildTaskCenterItems(snapshot, 'waiting').map(row => row.id)).toEqual(['wait'])
    expect(buildTaskCenterItems(snapshot, 'done').map(row => row.key)).toEqual(['workflows:same:id'])
    expect(buildTaskCenterItems(snapshot, 'failed').map(row => row.id)).toEqual(['bad', 'failure'])
    for (const kind of ['jobs', 'subagents', 'workflows'] as const) expect(buildTaskCenterItems(snapshot, kind)).toHaveLength(snapshot[kind].length)
    expect(buildTaskCenterItems(snapshot).filter(row => ['lost', 'inactive', 'diagnostic'].includes(row.id)).every(row => row.state === 'unknown')).toBe(true)
  })

  it('reuses real job details and stops exposing stop after settlement or disappearance', () => {
    const snapshot = facts()
    expect(buildTaskDetailRows(snapshot, 'jobs:same:id', 'en').some(row => row.action === 'request-job-stop')).toBe(true)
    expect(buildTaskDetailRows(snapshot, 'jobs:same:id', 'en', true).some(row => row.action === 'kill-job')).toBe(true)
    const stopping = { ...snapshot, jobs: snapshot.jobs.map(job => ({ ...job, status: 'stopping' })) }
    expect(buildTaskDetailRows(stopping, 'jobs:same:id').some(row => row.action)).toBe(false)
    expect(buildTaskDetailRows(snapshot, 'jobs:lost').some(row => row.action)).toBe(false)
    expect(buildTaskDetailRows({ ...snapshot, jobs: [] }, 'jobs:same:id', 'en')).toEqual([{ key: 'task-missing', text: 'Task no longer available · Esc returns to list', dim: true }])
  })

  it('shows durable child/workflow facts without inventing resume, cancellation or retry actions', () => {
    const snapshot = facts()
    for (const kind of ['subagents', 'workflows'] as const) {
      expect(buildTaskCenterItems(snapshot, kind).every(row => row.row.action === 'inspect-task' && row.row.meta?.id === row.key)).toBe(true)
      expect(buildTaskDetailRows(snapshot, `${kind}:same:id`).every(row => row.action === undefined)).toBe(true)
    }
    expect(buildTaskDetailRows(snapshot, 'subagents:same:id', 'en').map(row => row.text)).toContain('preset: minimal')
    expect(buildTaskDetailRows(snapshot, 'workflows:failure', 'en').map(row => row.text)).toEqual(expect.arrayContaining(['error: exit 1', 'lastLog: actual output', 'phase: build']))
  })

  it('renders all empty filters honestly in both locales without mutating frozen facts', () => {
    const snapshot: TaskSnapshot = Object.freeze({ jobs: Object.freeze([]), subagents: Object.freeze([]), workflows: Object.freeze([]) })
    for (const filter of TASK_FILTERS) for (const locale of ['en', 'zh'] as const) {
      const rows = buildTaskCenterRows(snapshot, filter, locale)
      expect(rows).toHaveLength(2)
      expect(rows[1]?.key).toBe('tasks-empty')
      expect(rows.every(row => row.action === undefined)).toBe(true)
    }
  })
})
