import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { TuiSnapshot } from '../store'

/** Public host facts only; never infer approval policy from the sandbox mode. */
export function readApprovalPolicy(ctx: Context, agent: Agent): TuiSnapshot['approval'] {
  const service = ctx.get('approval')
  if (service === undefined) return undefined
  const override = service.overrideOf(agent.session)
  return { policy: override ?? service.config.policy ?? 'ask', source: override === undefined ? 'profile' : 'session' }
}

/** Use the live-agent API so policy changes are durable and visible to the model. */
export function changeApprovalPolicy(ctx: Context, agent: Agent, policy: 'ask' | 'never'): void {
  if (policy !== 'ask' && policy !== 'never') throw new Error('Unsupported approval policy')
  const service = ctx.get('approval')
  if (service === undefined) throw new Error('Approval service unavailable')
  if (readApprovalPolicy(ctx, agent)?.policy !== policy) service.setPolicy(agent, policy)
}
