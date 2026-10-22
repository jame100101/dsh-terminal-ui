import { describe, expect, it } from 'vitest'
import { fallbackToolLabel } from '../src/tool-label'
import { foldFromLog } from '../src/fold'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

describe('tool presentation fallback', () => {
  it('shows the actual Bash command without JSON or a fabricated description', () => {
    expect(fallbackToolLabel('bash', { description: 'scan machine', command: 'uname -a' })).toBe('Bash(uname -a)')
    expect(fallbackToolLabel('custom', { secret: 'private' })).toBe('custom')
    expect(fallbackToolLabel('bash', null)).toBe('bash')
  })
  it('bounds lines and graphemes without modifying original arguments', () => {
    const args = { command: 'echo 中文🙂\nnext\nthird' }
    expect(fallbackToolLabel('bash', args)).toBe('Bash(echo 中文🙂\nnext…)')
    expect(args.command).toContain('third')
    const title = fallbackToolLabel('bash', { command: 'a'.repeat(159) + '👩🏽‍💻' })
    expect(title).toBe('Bash(' + 'a'.repeat(159) + '…)')
  })
  it('keeps the command label after settled arguments are released and during replay', () => {
    const events = [
      { type: 'tool/call', seq: 1, time: 1, data: { callId: 'a', name: 'bash', arguments: '{"command":"uname -a"}' } },
      { type: 'tool/result', seq: 2, time: 2, data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'a', content: [{ type: 'text', text: 'Darwin' }] }] } } },
    ] as SessionEvent[]
    const { fold: state } = foldFromLog(events)
    expect(state.nodes[0]).toMatchObject({ name: 'bash', displayTitle: 'Bash(uname -a)', status: 'done' })
  })
})
