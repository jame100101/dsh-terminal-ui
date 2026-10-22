import { describe, expect, it } from 'vitest'
import { ownsRequest, ownsPendingRequest } from '../src/controller/request-identity'

describe('approval and question request ownership', () => {
  it('rejects missing identity, old UI responses and cross-session responses', () => {
    const pending = { requestId: 'B', sessionId: 's2' }
    expect(ownsRequest(pending, 'B', 's2')).toBe(true)
    expect(ownsRequest(pending, 'A', 's2')).toBe(false)
    expect(ownsRequest(pending, 'B', 's1')).toBe(false)
    expect(ownsRequest(pending, undefined, 's2')).toBe(false)
    expect(ownsRequest(null, 'B', 's2')).toBe(false)
  })
  it('does not let a late abort of A withdraw B after A was answered', () => {
    const a = { requestId: 'A', sessionId: 's1' }
    const b = { requestId: 'B', sessionId: 's1' }
    let pending: typeof a | null = a
    const abortA = (): void => { if (ownsPendingRequest(pending, a)) pending = null }
    pending = b
    abortA()
    expect(pending).toBe(b)
    expect(ownsRequest(pending, 'B', 's1')).toBe(true)
    if (ownsPendingRequest(pending, b)) pending = null
    expect(ownsRequest(pending, 'B', 's1')).toBe(false)
  })
})
