/** Pure task inventory over adapter-owned facts; never an execution-state owner. */
import { buildJobDetailRows, buildJobsRows, buildSubagentRows, buildWorkflowRows, type PanelRow } from './settings-data'
import type { SubagentRow, TuiSnapshot, WorkflowRow } from './store'

export const TASK_FILTERS = ['all', 'jobs', 'subagents', 'workflows', 'running', 'waiting', 'done', 'failed'] as const
export type TaskFilter = typeof TASK_FILTERS[number]
export type TaskKind = 'jobs' | 'subagents' | 'workflows'
export type TaskState = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled' | 'unknown'
export type TaskSnapshot = Pick<TuiSnapshot, 'jobs' | 'subagents' | 'workflows'>
export interface TaskCenterItem {
  /** The complete host identity, namespaced across registries, never an array index. */
  key: string
  id: string
  kind: TaskKind
  /** Raw host status remains available even when no filter bucket is justified. */
  status: string
  state: TaskState
  row: PanelRow
}

function stateOf(status: string): TaskState {
  switch (status) {
    case 'running': case 'stopping': return 'running'
    case 'waiting': case 'queued': case 'pending': case 'awaiting-approval': return 'waiting'
    case 'completed': return 'done'
    case 'error': case 'failed': return 'failed'
    case 'cancelled': case 'killed': return 'cancelled'
    // Inactive children, interrupted jobs and diagnostics are not successful completions.
    default: return 'unknown'
  }
}

function item(kind: TaskKind, id: string, status: string, row: PanelRow): TaskCenterItem {
  const key = `${kind}:${id}`
  return { key, id, kind, status, state: stateOf(status), row: { ...row, key, action: 'inspect-task', meta: { id: key } } }
}

/** Preserve each official inventory's ordering; filtering preserves the namespaced detail identity. */
export function buildTaskCenterItems(snapshot: TaskSnapshot, filter: TaskFilter = 'all', locale: 'zh' | 'en' = 'zh'): TaskCenterItem[] {
  const jobs = buildJobsRows(snapshot.jobs, locale).slice(1)
  const children = buildSubagentRows(snapshot.subagents, locale).slice(1)
  const workflows = buildWorkflowRows(snapshot.workflows, locale).slice(1)
  const items = [
    ...snapshot.jobs.map((job, i) => item('jobs', job.id, job.status, jobs[i]!)),
    ...snapshot.subagents.map((child, i) => item('subagents', child.id, child.activity, children[i]!)),
    ...snapshot.workflows.map((run, i) => item('workflows', run.id, run.status, workflows[i]!)),
  ]
  return filter === 'all' ? items : items.filter(row => row.kind === filter || row.state === filter)
}

/** Every unified row opens details only; execution actions require a current detail snapshot. */
export function buildTaskCenterRows(snapshot: TaskSnapshot, filter: TaskFilter = 'all', locale: 'zh' | 'en' = 'zh'): PanelRow[] {
  const items = buildTaskCenterItems(snapshot, filter, locale)
  return [
    { key: 'tasks-head', text: locale === 'en' ? `Tasks · ${filter} · ${items.length}` : `任务中心 · ${filter} · ${items.length}`, color: 'cyan' },
    ...items.map(entry => entry.row),
    ...(items.length === 0 ? [] : [{ key: 'tasks-hint', text: locale === 'en' ? 'Enter views details · /tasks all|jobs|subagents|workflows|running|waiting|done|failed' : 'Enter 查看详情 · /tasks all|jobs|subagents|workflows|running|waiting|done|failed', dim: true }]),
    ...(items.length ? [] : [{ key: 'tasks-empty', text: locale === 'en' ? '(no matching tasks)' : '（没有匹配的任务）', dim: true }]),
  ]
}

/** Resolve detail against the current snapshot so stale selection cannot retain stop authority. */
export function buildTaskDetailRows(snapshot: TaskSnapshot, key: string, locale: 'zh' | 'en' = 'zh', confirmStop = false): PanelRow[] {
  const entry = buildTaskCenterItems(snapshot, 'all', locale).find(candidate => candidate.key === key)
  if (!entry) return [{ key: 'task-missing', text: locale === 'en' ? 'Task no longer available · Esc returns to list' : '任务已不可用 · Esc 返回列表', dim: true }]
  if (entry.kind === 'jobs') return buildJobDetailRows(snapshot.jobs.find(job => job.id === entry.id), locale, confirmStop)
  const fields: [string, string][] = entry.kind === 'subagents'
    ? childFields(snapshot.subagents.find(child => child.id === entry.id)!)
    : workflowFields(snapshot.workflows.find(run => run.id === entry.id)!)
  return [
    { key: `${key}:title`, text: entry.row.text, color: 'cyan' },
    ...fields.map(([name, value]) => ({ key: `${key}:${name}`, text: `${name}: ${value}` })),
    { key: `${key}:readonly`, text: locale === 'en' ? 'Read-only host facts' : '宿主事实 · 只读', dim: true },
  ]
}

function childFields(child: SubagentRow): [string, string][] {
  return [['id', child.id], ['activity', child.activity], ['mode', child.mode], ['depth', String(child.depth)], ...(child.preset === undefined ? [] : [['preset', child.preset] as [string, string]])]
}
function workflowFields(run: WorkflowRow): [string, string][] {
  return [['id', run.id], ['status', run.status], ['agentsStarted', String(run.agentsStarted)],
    ...(run.phase === undefined ? [] : [['phase', run.phase] as [string, string]]),
    ...(run.lastLog === undefined ? [] : [['lastLog', run.lastLog] as [string, string]]),
    ...(run.error === undefined ? [] : [['error', run.error] as [string, string]])]
}
