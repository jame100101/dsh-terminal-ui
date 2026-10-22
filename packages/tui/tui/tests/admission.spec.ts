import { describe, expect, it } from 'vitest'
import { DraftAdmission } from '../src/controller/admission'

describe('host input admission', () => {
  it('blocks repeated Enter until acceptance and only clears the accepted draft', () => {
    const gate = new DraftAdmission()
    const draft = { sessionId: 's1', revision: 1 }
    const token = gate.begin(draft)!
    expect(gate.begin(draft)).toBeNull()
    expect(gate.settle(token, draft)).toBe(true)
    expect(gate.settle(token, draft)).toBe(false)
    expect(gate.begin({ ...draft, revision: 2 })).not.toBeNull()
  })

  it('does not clear edits or another session after delayed acceptance', () => {
    for (const current of [{ sessionId: 's1', revision: 2 }, { sessionId: 's2', revision: 1 }]) {
      const gate = new DraftAdmission()
      const token = gate.begin({ sessionId: 's1', revision: 1 })!
      expect(gate.settle(token, current)).toBe(false)
      expect(gate.begin(current)).not.toBeNull()
    }
  })

  it('permits retry after failure and ignores late settlement of the failed attempt', () => {
    const gate = new DraftAdmission()
    const draft = { sessionId: 's1', revision: 1 }
    const failed = gate.begin(draft)!
    gate.fail(failed)
    const retry = gate.begin(draft)!
    expect(gate.settle(failed, draft)).toBe(false)
    expect(gate.begin(draft)).toBeNull()
    expect(gate.settle(retry, draft)).toBe(true)
  })
})
