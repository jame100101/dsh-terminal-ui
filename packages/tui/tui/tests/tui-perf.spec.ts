import { afterEach, describe, expect, it } from 'vitest'
import { countUiPublish, countUiRender, tuiPerfEnabled } from '../src/tui-perf'

describe('tuiPerf', () => {
  const original = process.env.TUI_PERF
  afterEach(() => {
    if (original === undefined) delete process.env.TUI_PERF
    else process.env.TUI_PERF = original
  })

  it('stays silent when TUI_PERF is unset', () => {
    delete process.env.TUI_PERF
    expect(tuiPerfEnabled()).toBe(false)
    countUiPublish()
    countUiRender()
  })

  it('reports publish and render rates on stderr after one second', async () => {
    process.env.TUI_PERF = '1'
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
      current += 1_001
      countUiPublish()
      expect(chunks.some(chunk => chunk.includes('[dsh-perf]'))).toBe(true)
    } finally {
      Date.now = now
      process.stderr.write = write
    }
  })
})
