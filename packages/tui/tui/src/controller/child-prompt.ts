import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentPromptRequest, SubagentPromptReceipt } from '@deepseek-ai/dsh-subagent/client'

/** The official human-prompt capability, intentionally distinct from model-authored sendMessage. */
export interface ChildPromptService {
  prompt(request: SubagentPromptRequest, signal: AbortSignal): Promise<SubagentPromptReceipt>
}

/** Host authorization and inbox acceptance remain authoritative; no local execution or synthetic success. */
export async function sendChildPrompt(
  service: ChildPromptService | undefined,
  parentSessionId: SessionId,
  childSessionId: string,
  text: string,
  delivery: 'queue' | 'steer',
  signal: AbortSignal,
): Promise<SubagentPromptReceipt> {
  signal.throwIfAborted()
  if (!service || typeof service.prompt !== 'function') throw new Error('subagent-prompt-unavailable')
  if (!text.trim()) throw new Error('subagent-prompt-empty')
  if (!childSessionId.trim()) throw new Error('subagent-id-empty')
  if (delivery !== 'queue' && delivery !== 'steer') throw new Error('subagent-delivery-invalid')
  // The public request brand is compile-time only; this UUID is minted once before admission.
  const requestId = randomUUID() as SubagentPromptRequest['requestId']
  return await service.prompt({ requestId, parentSessionId, childSessionId: SessionId(childSessionId), mode: 'continuable', delivery, content: [{ type: 'text', text }] }, signal)
}
