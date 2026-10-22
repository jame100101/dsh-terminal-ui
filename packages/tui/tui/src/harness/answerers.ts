import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { PendingApproval, PendingQuestion, TuiStore } from '../store'
import { ownsPendingRequest, ownsRequest } from '../controller/request-identity'

type Answer = { id: string; selected: string[]; custom?: string }
export interface AnswererSurface {
  agent: Agent
  version: number
  pendingApproval: PendingApproval | null
  pendingQuestion: PendingQuestion | null
  approvalResolve: ((outcome: 'allowed-once' | 'rejected') => void) | null
  questionResolve: ((answers: Answer[]) => void) | null
}
let requestSequence = 0

export function settleApproval(store: TuiStore, surface: AnswererSurface, requestId: string | undefined, outcome: 'allowed-once' | 'rejected'): boolean {
  if (!ownsRequest(surface.pendingApproval, requestId, String(surface.agent.id))) return false
  const resolve = surface.approvalResolve
  surface.approvalResolve = null
  surface.pendingApproval = null
  surface.version++
  store.set({ ...store.getSnapshot(), pendingApproval: null, version: surface.version })
  resolve?.(outcome)
  return true
}

export function settleQuestion(store: TuiStore, surface: AnswererSurface, requestId: string | undefined, answers: Answer[]): boolean {
  if (!ownsRequest(surface.pendingQuestion, requestId, String(surface.agent.id))) return false
  const resolve = surface.questionResolve
  surface.questionResolve = null
  surface.pendingQuestion = null
  surface.version++
  store.set({ ...store.getSnapshot(), pendingQuestion: null, version: surface.version })
  resolve?.([...answers])
  return true
}

/** Mount the interactive answerers; in the non-TTY fallback none mount. */
export function mountAnswerers(ctx: Context, store: TuiStore, surface: AnswererSurface, locate?: (agent: Agent) => { store: TuiStore; surface: AnswererSurface } | undefined): void {
  const approval = ctx.get('approval')
  if (approval !== undefined) {
    const initial = { store, surface }
    ctx.on('approval/request', (req, next) => {
      const binding = locate ? locate(req.agent) : initial
      if (!binding) return next()
      const { store, surface } = binding
      if (req.agent !== surface.agent) return next()
      // A second concurrent question cannot be presented; fail it closed.
      if (surface.pendingApproval !== null || surface.pendingQuestion !== null || req.signal?.aborted) return Promise.resolve('rejected' as const)
      return new Promise<'allowed-once' | 'rejected'>((resolve) => {
        const pending: PendingApproval = {
          requestId: `approval-${++requestSequence}`, sessionId: String(surface.agent.id),
          toolName: req.toolName,
          ...(req.reason === undefined ? {} : { reason: req.reason }),
        }
        surface.pendingApproval = pending
        surface.version += 1
        store.set({ ...store.getSnapshot(), pendingApproval: pending, version: surface.version })
        // The answerer race: the service settles 'cancelled' on signal abort;
        // clear the overlay so the UI does not hold a dead question.
        const abort = (): void => {
          if (ownsPendingRequest(surface.pendingApproval, pending)) {
            surface.pendingApproval = null
            surface.approvalResolve = null
            surface.version += 1
            store.set({ ...store.getSnapshot(), pendingApproval: null, version: surface.version })
          }
          resolve('rejected')
        }
        surface.approvalResolve = outcome => {
          req.signal?.removeEventListener('abort', abort)
          resolve(outcome)
        }
        req.signal?.addEventListener('abort', abort, { once: true })
        if (req.signal?.aborted) abort()
      })
    })
  }
  if (ctx.get('userQuestions') !== undefined) {
    const initial = { store, surface }
    ctx.on('user-questions/request', (request, next) => {
      const binding = locate ? (request.agent ? locate(request.agent) : undefined) : initial
      if (!binding) return next()
      const { store, surface } = binding
      if (request.agent !== surface.agent || surface.pendingQuestion !== null || surface.pendingApproval !== null || request.signal?.aborted) return next()
      return new Promise((resolve, reject) => {
        const pending: PendingQuestion = {
          requestId: `question-${++requestSequence}`, sessionId: String(surface.agent.id),
          questions: request.questions.map(question => ({
            id: question.id,
            question: question.question,
            ...(question.detail === undefined ? {} : { detail: question.detail }),
            ...(question.options === undefined ? {} : { options: question.options }),
            ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
          })),
        }
        surface.pendingQuestion = pending
        surface.version += 1
        store.set({ ...store.getSnapshot(), pendingQuestion: pending, version: surface.version })
        const abort = (): void => {
          if (ownsPendingRequest(surface.pendingQuestion, pending)) {
            surface.pendingQuestion = null
            surface.questionResolve = null
            surface.version += 1
            store.set({ ...store.getSnapshot(), pendingQuestion: null, version: surface.version })
          }
          // The public service awaits the answerer waterfall; withdrawing the
          // overlay alone leaves the official tool awaiting an unresolved promise.
          reject(new UserQuestionError('Question cancelled before an answer', 'ASK_ABORTED'))
        }
        surface.questionResolve = answers => {
          request.signal?.removeEventListener('abort', abort)
          resolve({ answers })
        }
        request.signal?.addEventListener('abort', abort, { once: true })
        if (request.signal?.aborted) abort()
      })
    })
  }
}

