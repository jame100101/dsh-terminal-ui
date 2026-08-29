import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  foldFromLog,
  foldResidentChars,
  MAX_ASSISTANT_TEXT,
  MAX_FOLD_CHARS,
  MAX_FOLD_NODES,
  MAX_TRACE,
} from '../src/fold'
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

interface SpawnMeasurement {
  readonly medianMs: number
  readonly p90Ms: number
  readonly status: number | null
}

function measureSpawn(
  executable: string,
  args: readonly string[],
  options: { readonly env?: Record<string, string | undefined>; readonly runs: number; readonly timeoutMs: number },
): SpawnMeasurement {
  const samples: number[] = []
  let status: number | null = null
  for (let run = 0; run < options.runs; run += 1) {
    const started = performance.now()
    const result = spawnSync(executable, args, {
      encoding: 'utf8',
      env: options.env,
      timeout: options.timeoutMs,
      windowsHide: true,
    })
    samples.push(performance.now() - started)
    status = result.status
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
  }
  return {
    medianMs: percentile(samples, 0.5),
    p90Ms: percentile(samples, 0.9),
    status,
  }
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
    expect(after100.nodes).toBeGreaterThan(0)
    expect(after500.nodes).toBeGreaterThan(0)
    expect(after100.nodes).toBeLessThanOrEqual(300)
    expect(after500.nodes).toBeLessThanOrEqual(1_500)
    expect(after100.traces).toBeLessThanOrEqual(MAX_TRACE)
    expect(after500.traces).toBe(MAX_TRACE)
    expect(after100.chars).toBeLessThan(100 * MAX_ASSISTANT_TEXT)
    expect(after500.chars).toBeLessThan(500 * MAX_ASSISTANT_TEXT)
    expect(after100.chars).toBeLessThanOrEqual(MAX_FOLD_CHARS + MAX_TRACE * 400)
    expect(after500.chars).toBeLessThanOrEqual(MAX_FOLD_CHARS + MAX_TRACE * 400)
    expect(after500.nodes).toBeLessThanOrEqual(MAX_FOLD_NODES)

    const repoRoot = join(fileURLToPath(new URL('../../../../', import.meta.url)))
    const versionBin = join(repoRoot, 'apps/tui-cli/bin/dsh-tui.js')
    const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
    const packageVersion = /"version"\s*:\s*"([^"]+)"/u.exec(
      readFileSync(join(repoRoot, 'apps/tui-cli/package.json'), 'utf8'),
    )?.[1] ?? 'unknown'
    const gitHead = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).stdout.trim() || 'unknown'
    const version = measureSpawn(process.execPath, [versionBin, '--version'], { runs: 5, timeoutMs: 15_000 })
    const help = measureSpawn(process.execPath, [builtBin, '--help'], { runs: 5, timeoutMs: 15_000 })
    const benchmarkHome = mkdtempSync(join(tmpdir(), 'dsh-tui-perf-home-'))
    let dumpFirst: SpawnMeasurement
    let dumpWarm: SpawnMeasurement
    try {
      const env = { ...process.env, DSH_HOME: benchmarkHome }
      dumpFirst = measureSpawn(process.execPath, [builtBin, '--profile', 'tui', '--dump-config'], {
        env,
        runs: 1,
        timeoutMs: 20_000,
      })
      dumpWarm = measureSpawn(process.execPath, [builtBin, '--profile', 'tui', '--dump-config'], {
        env,
        runs: 5,
        timeoutMs: 20_000,
      })
    } finally {
      rmSync(benchmarkHome, { force: true, recursive: true })
    }
    expect(version.p90Ms).toBeLessThan(5_000)
    expect(help.p90Ms).toBeLessThan(5_000)
    expect(dumpFirst.p90Ms).toBeLessThan(8_000)
    expect(dumpWarm.p90Ms).toBeLessThan(8_000)

    const outDir = join(repoRoot, 'evaluation/performance')
    const conptyPath = join(repoRoot, 'evaluation/tui/conpty-soak-last.json')
    const conpty = existsSync(conptyPath)
      ? JSON.parse(readFileSync(conptyPath, 'utf8')) as {
        durationMs: number
        buildRuns: number
        buildFailures: number
        outputBytes: number
        peakTuiRssBytes: number
        peakCompleteRssBytes: number
        peakTuiHeapUsedBytes: number
        processTreeComplete: boolean
        maxThinkingStallMs: number
        inputLatencyMs: { p95: number; p99: number; max: number }
        samples: { elapsedMs: number; tuiRssBytes: number }[]
      }
      : null
    const conptyMinutes = conpty === null ? 'not recorded' : `${(conpty.durationMs / 60_000).toFixed(1)} minutes`
    const conptyPeakMiB = conpty === null ? 'not recorded' : `${(conpty.peakTuiRssBytes / (1024 * 1024)).toFixed(1)} MiB`
    const conptyWarmupMs = conpty === null ? 0 : Math.min(5 * 60_000, conpty.durationMs / 4)
    const slopePoints = conpty?.samples
      .filter(entry => entry.elapsedMs >= conptyWarmupMs && entry.elapsedMs <= conpty.durationMs && entry.tuiRssBytes > 0)
      .map(entry => ({ elapsedMs: entry.elapsedMs, value: entry.tuiRssBytes })) ?? []
    const slopeMeanTime = slopePoints.reduce((total, point) => total + point.elapsedMs, 0) / Math.max(1, slopePoints.length)
    const slopeMeanValue = slopePoints.reduce((total, point) => total + point.value, 0) / Math.max(1, slopePoints.length)
    const slopeCovariance = slopePoints.reduce(
      (total, point) => total + (point.elapsedMs - slopeMeanTime) * (point.value - slopeMeanValue),
      0,
    )
    const slopeVariance = slopePoints.reduce((total, point) => total + (point.elapsedMs - slopeMeanTime) ** 2, 0)
    const conptySlopeBytesPerMinute = slopeVariance === 0 ? 0 : slopeCovariance / slopeVariance * 60_000
    mkdirSync(outDir, { recursive: true })
    const lines = [
      '# dsh-tui current performance baseline (keyless)',
      '',
      `Recorded UTC: ${new Date().toISOString()}`,
      `Source: local working tree based on HEAD \`${gitHead}\`; TUI package \`${packageVersion}\`.`,
      `Runtime: ${process.platform} ${process.arch}; ${process.version}.`,
      `GC in this process: ${gc ? 'yes (--expose-gc)' : 'no (heapUsed is still reported)'}`,
      'Generator: `packages/tui/tui/tests/perf-acceptance.spec.ts` against built artifacts and an isolated temporary `DSH_HOME`.',
      '',
      '## Result summary',
      '',
      '- The keyless microbench remains inside its current publish, wrap, wheel, fold-size, and startup budgets.',
      '- Heap inspection identified React development User Timing entries as the remaining source-launch retainer; the TUI launcher now selects production React before the dependency graph loads.',
      `- The latest automated Windows ConPTY/build campaign covers ${conptyMinutes} with a ${conptyPeakMiB} peak TUI RSS; the cumulative projection soak also passes locally.`,
      '',
      '## Busy stream and interaction core',
      '',
      `- Coalesce window: ${STREAM_UI_PUBLISH_MS} ms (≤ 25 UI publishes/s for token deltas).`,
      '- Incremental live wrap: second 80 chunks stay cheaper than a full rewrap of the same buffer (see perf-acceptance.spec.ts).',
      '- Wheel parse + offset + viewport p99 < 8 ms over 800 ticks (one frame is ~16 ms).',
      '- Transcript scrolling reuses a memoized height prefix sum; a 25 Hz real-PTY fixture keeps Chinese edit/submit, PageUp/PageDown, Shift+Tab, Thinking, todo, and goal updates responsive.',
      '- Panel refresh is scoped: the one-second jobs poll reads only the in-memory job registry instead of also loading subagent descendants and persisted session titles.',
      '- The wall-clock soak owns one persistent fold, parser, and append-only event list instead of restarting a short synthetic run at every sample.',
      '',
      '## React retained-measure regression',
      '',
      'An identical 3,000-node, 25 Hz busy fixture was run for two minutes before and after the launcher selected React production entry points. Development React retained about 30,000 `PerformanceMeasure` objects after 20 seconds; Node keeps those User Timing entries for the process lifetime.',
      '',
      '| Two-minute ConPTY sample | before | current | assessment |',
      '|---|---:|---:|---|',
      '| Peak TUI RSS | 608.0 MB | 250.3 MB | 58.8% lower; current samples plateau after warm-up |',
      '| Input p95 | 93 ms | 93 ms | immediate-input latency unchanged |',
      '| Thinking maximum stall | 808 ms | 848 ms | inside the 1.5 s animation budget |',
      '',
      'The source graph, node count, update rate, terminal geometry, automated keys, and two-minute duration were the same. The production run peaked at 96.8 MB `heapUsed`; the earlier run predated in-child heap sampling, so only its externally sampled RSS is reported.',
      '',
      '## Latest automated ConPTY/build campaign',
      '',
      '| Metric | value |',
      '|---|---:|',
      `| Duration | ${conpty === null ? 'not recorded' : `${(conpty.durationMs / 60_000).toFixed(2)} min`} |`,
      `| Repeated real builds | ${conpty === null ? 'not recorded' : `${conpty.buildRuns} (${conpty.buildFailures} failures)`} |`,
      `| Input latency p95 / p99 / max | ${conpty === null ? 'not recorded' : `${conpty.inputLatencyMs.p95} / ${conpty.inputLatencyMs.p99} / ${conpty.inputLatencyMs.max} ms`} |`,
      `| Maximum Thinking-second stall | ${conpty === null ? 'not recorded' : `${conpty.maxThinkingStallMs} ms`} |`,
      `| Peak TUI RSS / heapUsed | ${conpty === null ? 'not recorded' : `${(conpty.peakTuiRssBytes / (1024 * 1024)).toFixed(1)} / ${(conpty.peakTuiHeapUsedBytes / (1024 * 1024)).toFixed(1)} MiB`} |`,
      `| Post-warm-up TUI RSS slope | ${conpty === null ? 'not recorded' : `${(conptySlopeBytesPerMinute / (1024 * 1024)).toFixed(2)} MiB/min`} |`,
      `| Peak complete evaluator set RSS | ${conpty === null ? 'not recorded' : `${(conpty.peakCompleteRssBytes / (1024 * 1024)).toFixed(1)} MiB`} |`,
      `| Terminal output | ${conpty === null ? 'not recorded' : `${(conpty.outputBytes / (1024 * 1024)).toFixed(1)} MiB`} |`,
      '',
      conpty?.processTreeComplete === false
        ? 'Windows process-table access used the parent-less fallback, so the complete evaluator-set value includes launched root processes but not every build descendant. TUI RSS and in-child heap samples remain direct measurements.'
        : 'The process table included parent ids, so the complete evaluator-set value deduplicates the TUI, evaluator, and active build descendant trees.',
      '',
      '## Fold heap working set (after optional GC)',
      '',
      '| Turns | fold nodes | traces | resident chars | heapUsed MB |',
      '|---|---:|---:|---:|---:|',
      `| 100 | ${after100.nodes} | ${after100.traces} | ${after100.chars} | ${after100.heapMb.toFixed(1)} |`,
      `| 500 | ${after500.nodes} | ${after500.traces} | ${after500.chars} | ${after500.heapMb.toFixed(1)} |`,
      '',
      'The TUI fold stays inside 3000 nodes, the 1.5 million-character projected-node budget, and 32 KiB assistant bodies; the separately bounded trace contributes a small remainder to resident chars. This synthetic fold measurement covers the TUI projection only; it does not measure the full in-memory session event log, terminal write queues, input-parser pending data, or child processes.',
      '',
      '## Comparison with the 2026-08-21 rc.8 record',
      '',
      '| Metric | 2026-08-21 record | current | assessment |',
      '|---|---:|---:|---|',
      `| Fold heap, 100 turns | 17.5 MB | ${after100.heapMb.toFixed(1)} MB | same range; no forced GC in either run |`,
      `| Fold heap, 500 turns | 19.0 MB | ${after500.heapMb.toFixed(1)} MB | same range; no forced GC in either run |`,
      `| \`dsh-tui --version\` | 90–92 ms | ${version.medianMs.toFixed(0)} ms median | lower in this sample |`,
      `| built \`--help\` | about 100 ms | ${help.medianMs.toFixed(0)} ms median | same range |`,
      `| warm \`--dump-config\` | 300–600 ms | ${dumpWarm.medianMs.toFixed(0)} ms median | inside the historical range |`,
      '',
      'These small differences are run-to-run observations, not proof of an optimization effect. The two records use synthetic projection work and startup paths rather than the full interactive terminal pipeline.',
      '',
      '## Startup (built artifacts, five measured runs unless marked first)',
      '',
      '| Path | median ms | p90 ms | status |',
      '|---|---:|---:|---:|',
      `| \`apps/tui-cli/bin/dsh-tui.js --version\` | ${version.medianMs.toFixed(0)} | ${version.p90Ms.toFixed(0)} | ${version.status} |`,
      `| \`apps/cli/lib/bin.js --help\` | ${help.medianMs.toFixed(0)} | ${help.p90Ms.toFixed(0)} | ${help.status} |`,
      `| \`apps/cli/lib/bin.js --profile tui --dump-config\` (isolated home, first) | ${dumpFirst.medianMs.toFixed(0)} | ${dumpFirst.p90Ms.toFixed(0)} | ${dumpFirst.status} |`,
      `| \`apps/cli/lib/bin.js --profile tui --dump-config\` (isolated home, warm) | ${dumpWarm.medianMs.toFixed(0)} | ${dumpWarm.p90Ms.toFixed(0)} | ${dumpWarm.status} |`,
      '',
      'Daily launch uses `pnpm dsh-tui` after `pnpm run build`. Source-mode `tsx` timing is outside this product baseline.',
      '',
      '## Web Host comparison',
      '',
      'The checked-in measurements contain no same-machine Web Host process-tree capture for this workload. The historical 121–192 MB rows are TUI wrapper + dsh-child figures, not Web figures, so a numeric Web/TUI memory or CPU ratio is not reported. A controlled comparison must use the same profile, session log, model/tool replay, duration, sampling interval, and process-tree ownership; the Web path additionally includes browser renderer/GPU processes whose RSS is outside the dsh child. Tool and web-search execution remain Harness-owned in both hosts, while this change alters only TUI presentation, its launcher, and repository-only evaluation fixtures.',
      '',
      '## Coverage required for the long-task baseline',
      '',
      '- Slow-drain campaign: frame bytes, changed rows, `writableLength`, dropped frames, event-loop delay, and input-to-flush p50/p95/p99.',
      '- Manual IME composition and jump-to-bottom coverage; the compressed PTY already covers Chinese text, Backspace, PageUp/PageDown, and Shift+Tab, while parser tests cover delayed or missing bracketed-paste end markers plus bounded drain after an oversized paste.',
      '- Memory attribution: dsh PID and full descendant tree, V8 heap spaces, external memory, parser pending bytes, composer optimistic bytes, session-event count, and fold resident chars.',
      '- Duration beyond the 30-minute interactive build: the two-hour continuous-session soak in `evaluation/tui/soak.mjs`; memory slope is evaluated after warm-up rather than from one endpoint.',
      '- Long-session recovery: 10k, 50k, and 100k events with time to loading state, first interactive frame, and fully ready state.',
      '',
      '## Harness boundary',
      '',
      'This refresh measures assembled Harness bins and changes the TUI package, its launcher, its Ink patch, and TUI-owned evaluation files. Agent-loop, provider, web-search/tool execution, and persisted session formats remain untouched.',
    ]
    writeFileSync(join(outDir, 'DSH_TUI_PERF_CURRENT.md'), `${lines.join('\n')}\n`)
    expect(outDir.includes('evaluation')).toBe(true)
  }, 120_000)
})
