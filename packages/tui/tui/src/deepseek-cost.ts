/**
 * DeepSeek session-cost estimation for the terminal surface.
 *
 * Rates mirror the DeepSeek entries shipped by pi-ai 0.82.1 and use the
 * same USD-per-million-token arithmetic as pi's footer. The TUI keeps the
 * two small catalog rows locally instead of importing pi-ai's provider graph
 * into the terminal render bundle.
 * @module @deepseek-ai/dsh-tui/src/deepseek-cost
 */

import type { TokenTotals } from './types'

interface ModelRates {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** USD prices per one million tokens, synchronized with pi-ai 0.82.1. */
const DEEPSEEK_RATES: Readonly<Record<string, ModelRates>> = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
}

const DEEPSEEK_PROVIDERS = new Set(['deepseek', 'deepseek-official'])
const TOKENS_PER_MILLION = 1_000_000

/**
 * Estimate one completed DeepSeek request's price in US dollars.
 * `output` already includes reasoning tokens in the provider usage record, so
 * the separately reported reasoning count is intentionally not added again.
 *
 * @param provider - Harness provider route that served the request.
 * @param model - Exact model id that served the request.
 * @param usage - Disjoint Harness token buckets for the completed request.
 * @returns The pi-compatible USD estimate, or zero for a route without known rates.
 */
export function deepSeekCostUsd(provider: string, model: string, usage: TokenTotals): number {
  if (!DEEPSEEK_PROVIDERS.has(provider)) return 0
  const rates = DEEPSEEK_RATES[model]
  if (rates === undefined) return 0
  return (
    rates.input * Math.max(0, usage.input)
    + rates.output * Math.max(0, usage.output)
    + rates.cacheRead * Math.max(0, usage.cacheRead)
    + rates.cacheWrite * Math.max(0, usage.cacheWrite)
  ) / TOKENS_PER_MILLION
}

/**
 * Format accumulated spend like pi's session footer.
 * @param costUsd - Accumulated estimated cost in US dollars.
 * @returns A dollar-prefixed value with three fractional digits.
 */
export function formatCostUsd(costUsd: number): string {
  return `$${Math.max(0, Number.isFinite(costUsd) ? costUsd : 0).toFixed(3)}`
}
