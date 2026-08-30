import { describe, expect, it } from 'vitest'
import { deepSeekCostUsd, formatCostUsd } from '../src/deepseek-cost'

const oneMillionEach = {
  input: 1_000_000,
  output: 1_000_000,
  cacheRead: 1_000_000,
  cacheWrite: 1_000_000,
  reasoning: 900_000,
}

describe('DeepSeek cost estimation', () => {
  it('uses pi-ai rates and does not double-charge reasoning tokens', () => {
    expect(deepSeekCostUsd('deepseek-official', 'deepseek-v4-flash', oneMillionEach)).toBeCloseTo(0.4228)
    expect(deepSeekCostUsd('deepseek', 'deepseek-v4-pro', oneMillionEach)).toBeCloseTo(1.308625)
  })

  it('leaves unknown routes unpriced', () => {
    expect(deepSeekCostUsd('other', 'deepseek-v4-pro', oneMillionEach)).toBe(0)
    expect(deepSeekCostUsd('deepseek-official', 'future-model', oneMillionEach)).toBe(0)
  })

  it('formats dollars like pi session totals', () => {
    expect(formatCostUsd(0)).toBe('$0.000')
    expect(formatCostUsd(1.308625)).toBe('$1.309')
  })
})
