import { afterEach, describe, expect, it } from 'vitest'
import {
  countUiInputDelay, countUiPublish, countUiRender, resetTuiPerf, tuiPerfEnabled,
} from '../src/tui-perf'

describe('tuiPerf', () => {
  const original = process.env.TUI_PERF
  afterEach(() => {
    resetTuiPerf()
    if (original === undefined) delete process.env.TUI_PERF
    else process.env.TUI_PERF = original
  })

  it('stays silent when TUI_PERF is unset', () => {
    delete process.env.TUI_PERF
    expect(tuiPerfEnabled()).toBe(false)
    countUiPublish()
    countUiRender()
    countUiInputDelay(4)
  })

  it('reports publish, render, heap, wheel, and lag after one second', async () => {
    process.env.TUI_PERF = '1'
    resetTuiPerf()
    expect(tuiPerfEnabled()).toBe(true)
    const chunks: string[] = []
    const write = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(String(chunk))
      return write(chunk as never, ...rest as never[])
    }) as typeof process.stderr.write
    const now = Date.now
    let current = 1_000_000
    Date.now = () => current
    try {
      countUiPublish()
      countUiRender()
      countUiInputDelay(Number.NaN)
      countUiInputDelay(-2)
      countUiInputDelay(1.25)
      current += 1_001
      countUiPublish()
      expect(chunks.some(chunk =>
        chunk.includes('[dsh-perf]')
        && chunk.includes('heap=')
        && chunk.includes('wheel_avg=')
        && chunk.includes('lag='))).toBe(true)
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
      current += 1_001
      countUiRender()
      expect(chunks.filter(chunk => chunk.includes('[dsh-perf]')).length).toBeGreaterThanOrEqual(1)
      current += 1_001
      countUiPublish()
      delete process.env.TUI_PERF
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
    } finally {
      Date.now = now
      process.stderr.write = write
    }
  })
})
