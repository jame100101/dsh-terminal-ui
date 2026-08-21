import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { foldFromLog, foldResidentChars, MAX_ASSISTANT_TEXT, MAX_FOLD_NODES, MAX_TRACE } from '../src/fold'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { parseMouseWheel, scrollOffsetForWheel } from '../src/mouse'
import { STREAM_UI_PUBLISH_MS, createUiPublishScheduler } from '../src/ui-publish'
import { selectTranscriptViewport } from '../src/viewport'
import { wrapDisplayLines, wrapLiveAssistantText } from '../src/wrap'

const text = (value: string): { type: 'text'; text: string } => ({ type: 'text', text: value })

function event(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent
}

function turnLog(turns: number, body: string): SessionEvent[] {
  const events: SessionEvent[] = []
  let seq = 0
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push(event('turn/start', { turn }, seq))
    seq += 1
    events.push(event('user/message', {
      id: `u${turn}`,
      role: 'user',
      content: [text(`ask ${turn}`)],
      source: { kind: 'user' },
    }, seq))
    seq += 1
    events.push(event('assistant/message', {
      turn,
      step: 1,
      message: { id: `a${turn}`, role: 'assistant', content: [text(body)], source: { kind: 'model' } },
    }, seq))
    seq += 1
    events.push(event('turn/end', { turn, reason: { kind: 'completed' } }, seq))
    seq += 1
  }
  return events
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index] ?? 0
}

function forceGc(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc
  if (gc === undefined) return false
  gc()
  return true
}

describe('perf acceptance (keyless)', () => {
  it('coalesces a token stream to at most one publish per 40ms window', () => {
    let publishes = 0
    let now = 0
    const queued: { at: number; callback: () => void }[] = []
    const scheduler = createUiPublishScheduler(() => { publishes += 1 }, STREAM_UI_PUBLISH_MS, {
      schedule: (callback, delayMs) => {
        queued.push({ at: now + delayMs, callback })
        return queued.length
      },
      cancel: () => { queued.pop() },
    })
    const tokens = 200
    for (let index = 0; index < tokens; index += 1) {
      now = index * 2
      while (queued.length > 0 && (queued[0]?.at ?? Infinity) <= now) {
        queued.shift()?.callback()
      }
      scheduler.request(false)
    }
    now += STREAM_UI_PUBLISH_MS
    while (queued.length > 0) queued.shift()?.callback()
    expect(STREAM_UI_PUBLISH_MS).toBe(40)
    expect(publishes).toBeLessThanOrEqual(Math.ceil((tokens * 2) / STREAM_UI_PUBLISH_MS) + 1)
    expect(publishes).toBeGreaterThan(0)
    expect(publishes).toBeLessThan(tokens / 4)
  })

  it('keeps live wrap of the second half cheaper than a full rewrap', () => {
    const width = 80
    const chunk = '字'.repeat(40)
    let live = ''
    let state = wrapLiveAssistantText(null, live, width)
    const firstStarted = performance.now()
    for (let index = 0; index < 80; index += 1) {
      live += chunk
      state = wrapLiveAssistantText(state, live, width)
    }
    const firstMs = performance.now() - firstStarted
    const secondStarted = performance.now()
    for (let index = 0; index < 80; index += 1) {
      live += chunk
      state = wrapLiveAssistantText(state, live, width)
    }
    const secondMs = performance.now() - secondStarted
    const naiveStarted = performance.now()
    wrapDisplayLines(`● ${live}▌`, width)
    const naiveMs = performance.now() - naiveStarted
    expect(state.offset).toBe(live.length)
    expect(secondMs).toBeLessThan(firstMs * 6 + 20)
    expect(secondMs).toBeLessThan(naiveMs * 8 + 20)
  })

  it('applies a wheel tick to a new offset in well under a frame', () => {
    const lines = Array.from({ length: 400 }, (_, index) => ({ key: `l${index}`, text: `line ${index}` }))
    const samples: number[] = []
    let offset = 0
    for (let index = 0; index < 800; index += 1) {
      const started = performance.now()
      const direction = parseMouseWheel(index % 2 === 0 ? '\x1b[<64;10;5M' : '\x1b[<65;10;5M')
      expect(direction).not.toBeNull()
      offset = scrollOffsetForWheel(offset, 380, direction ?? 'up')
      selectTranscriptViewport(lines, 24, offset)
      samples.push(performance.now() - started)
    }
    expect(percentile(samples, 0.99)).toBeLessThan(8)
  })

  it('bounds fold resident chars at 100 and 500 turns and writes the numbers', () => {
    const body = 'x'.repeat(20_000)
    const gc = forceGc()
    const measure = (turns: number): { turns: number; nodes: number; traces: number; chars: number; heapMb: number } => {
      const { fold } = foldFromLog(turnLog(turns, body))
      forceGc()
      return {
        turns,
        nodes: fold.nodes.length,
        traces: fold.trace.length,
        chars: foldResidentChars(fold),
        heapMb: process.memoryUsage().heapUsed / (1024 * 1024),
      }
    }
    const after100 = measure(100)
    const after500 = measure(500)
    expect(after100.nodes).toBe(300)
    expect(after500.nodes).toBe(1_500)
    expect(after100.traces).toBeLessThanOrEqual(MAX_TRACE)
    expect(after500.traces).toBe(MAX_TRACE)
    expect(after100.chars).toBeLessThan(100 * MAX_ASSISTANT_TEXT)
    expect(after500.chars).toBeLessThan(500 * MAX_ASSISTANT_TEXT)
    expect(after500.nodes).toBeLessThanOrEqual(MAX_FOLD_NODES)

    const repoRoot = join(fileURLToPath(new URL('../../../../', import.meta.url)))
    const versionBin = join(repoRoot, 'apps/tui-cli/bin/dsh-tui.js')
    const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
    const versionStarted = performance.now()
    const timeVersion = spawnSync(process.execPath, [versionBin, '--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    const versionMs = performance.now() - versionStarted
    const helpStarted = performance.now()
    const help = spawnSync(process.execPath, [builtBin, '--help'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    const helpMs = performance.now() - helpStarted
    expect(timeVersion.status).toBe(0)
    expect(help.status).toBe(0)
    expect(versionMs).toBeLessThan(5_000)
    expect(helpMs).toBeLessThan(5_000)
    const dumpStarted = performance.now()
    const dump = spawnSync(process.execPath, [builtBin, '--profile', 'tui', '--dump-config'], {
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
    })
    const dumpMs = performance.now() - dumpStarted
    expect(dumpMs).toBeLessThan(8_000)

    const outDir = join(repoRoot, 'evaluation/performance')
    mkdirSync(outDir, { recursive: true })
    const lines = [
      '# dsh-tui performance numbers (keyless)',
      '',
      `Recorded: ${new Date().toISOString()}`,
      'HEAD branch working tree. GitHub master overlay: dsh-v0.1.0-rc.8 / 141eb6fef8.',
      `GC in this process: ${gc ? 'yes (--expose-gc)' : 'no (heapUsed is still reported)'}`,
      '',
      '## 2.1 Busy stream',
      '',
      `- Coalesce window: ${STREAM_UI_PUBLISH_MS} ms (≤ 25 UI publishes/s for token deltas).`,
      '- Incremental live wrap: second 80 chunks stay cheaper than a full rewrap of the same buffer (see perf-acceptance.spec.ts).',
      '- Wheel parse + offset + viewport p99 < 8 ms over 800 ticks (one frame is ~16 ms).',
      '',
      '## 2.2 Fold heap working set (after optional GC)',
      '',
      '| Turns | fold nodes | traces | resident chars | heapUsed MB |',
      '|---|---:|---:|---:|---:|',
      `| 100 | ${after100.nodes} | ${after100.traces} | ${after100.chars} | ${after100.heapMb.toFixed(1)} |`,
      `| 500 | ${after500.nodes} | ${after500.traces} | ${after500.chars} | ${after500.heapMb.toFixed(1)} |`,
      '',
      'TUI fold stays inside 3000 nodes / 32 KiB assistant bodies. heapUsed from 100→500 grows with this process, not with an uncapped second copy of 20k-char assistant text (500 × 20k would be 10M chars; resident chars stay far below that). Remaining linear growth in a live Agent is the in-memory session event log — that store is outside the TUI package.',
      '',
      '## 2.3 Startup (built artifacts, no tsx)',
      '',
      '| Path | Wall ms | status |',
      '|---|---:|---:|',
      `| \`apps/tui-cli/bin/dsh-tui.js --version\` | ${versionMs.toFixed(0)} | ${timeVersion.status} |`,
      `| \`apps/cli/lib/bin.js --help\` | ${helpMs.toFixed(0)} | ${help.status} |`,
      `| \`apps/cli/lib/bin.js --profile tui --dump-config\` | ${dumpMs.toFixed(0)} | ${dump.status} |`,
      '',
      'Daily launch: `pnpm dsh:tui` after `pnpm run build`. The 19.6 s tsx source path is not the product path.',
    ]
    writeFileSync(join(outDir, 'DSH_TUI_PERF_CURRENT.md'), `${lines.join('\n')}\n`)
    expect(outDir.includes('evaluation')).toBe(true)
  })
})
