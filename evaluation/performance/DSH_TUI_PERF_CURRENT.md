# dsh-tui current performance baseline (keyless)

Recorded UTC: 2026-09-04T01:18:52.409Z
Source: local working tree based on HEAD `703d2003c85b`; TUI package `0.1.0`.
Runtime: win32 x64; v24.14.0.
GC in this process: no (heapUsed is still reported)
Generator: `packages/tui/tui/tests/perf-acceptance.spec.ts` against built artifacts and an isolated temporary `DSH_HOME`.

## Result summary

- The keyless microbench remains inside its current publish, wrap, wheel, fold-size, and startup budgets.
- Heap inspection identified React development User Timing entries as the remaining source-launch retainer; the TUI launcher now selects production React before the dependency graph loads.
- The latest automated Windows ConPTY/build campaign covers 30.0 minutes with a 413.8 MiB peak TUI RSS; the cumulative projection soak also passes locally.

## Busy stream and interaction core

- Coalesce window: 40 ms (≤ 25 UI publishes/s for token deltas).
- Incremental live wrap: second 80 chunks stay cheaper than a full rewrap of the same buffer (see perf-acceptance.spec.ts).
- Wheel parse + offset + viewport p99 < 8 ms over 800 ticks (one frame is ~16 ms).
- Transcript scrolling reuses a memoized height prefix sum; a 25 Hz real-PTY fixture keeps Chinese edit/submit, PageUp/PageDown, Shift+Tab, Thinking, todo, and goal updates responsive.
- Panel refresh is scoped: the one-second jobs poll reads only the in-memory job registry instead of also loading subagent descendants and persisted session titles.
- The wall-clock soak owns one persistent fold, parser, and append-only event list instead of restarting a short synthetic run at every sample.

## React retained-measure regression

An identical 3,000-node, 25 Hz busy fixture was run for two minutes before and after the launcher selected React production entry points. Development React retained about 30,000 `PerformanceMeasure` objects after 20 seconds; Node keeps those User Timing entries for the process lifetime.

| Two-minute ConPTY sample | before | current | assessment |
|---|---:|---:|---|
| Peak TUI RSS | 608.0 MB | 250.3 MB | 58.8% lower; current samples plateau after warm-up |
| Input p95 | 93 ms | 93 ms | immediate-input latency unchanged |
| Thinking maximum stall | 808 ms | 848 ms | inside the 1.5 s animation budget |

The source graph, node count, update rate, terminal geometry, automated keys, and two-minute duration were the same. The production run peaked at 96.8 MB `heapUsed`; the earlier run predated in-child heap sampling, so only its externally sampled RSS is reported.

## Latest automated ConPTY/build campaign

| Metric | value |
|---|---:|
| Duration | 30.00 min |
| Repeated real builds | 40 (0 failures) |
| Input latency p95 / p99 / max | 94 / 111 / 296 ms |
| Maximum Thinking-second stall | 560 ms |
| Peak TUI RSS / heapUsed | 413.8 / 249.3 MiB |
| Post-warm-up TUI RSS slope | 7.19 MiB/min |
| Peak complete evaluator set RSS | 522.3 MiB |
| Terminal output | 20.8 MiB |

Windows process-table access used the parent-less fallback, so the complete evaluator-set value includes launched root processes but not every build descendant. TUI RSS and in-child heap samples remain direct measurements.

## Fold heap working set (after optional GC)

| Turns | fold nodes | traces | resident chars | heapUsed MB |
|---|---:|---:|---:|---:|
| 100 | 223 | 400 | 1490322 | 21.8 |
| 500 | 223 | 512 | 1493061 | 16.7 |

The TUI fold stays inside 3000 nodes, the 1.5 million-character projected-node budget, and 32 KiB assistant bodies; the separately bounded trace contributes a small remainder to resident chars. This synthetic fold measurement covers the TUI projection only; it does not measure the full in-memory session event log, terminal write queues, input-parser pending data, or child processes.

## Comparison with the 2026-08-21 rc.8 record

| Metric | 2026-08-21 record | current | assessment |
|---|---:|---:|---|
| Fold heap, 100 turns | 17.5 MB | 21.8 MB | same range; no forced GC in either run |
| Fold heap, 500 turns | 19.0 MB | 16.7 MB | same range; no forced GC in either run |
| `dsh-tui --version` | 90–92 ms | 180 ms median | lower in this sample |
| built `--help` | about 100 ms | 227 ms median | same range |
| warm `--dump-config` | 300–600 ms | 186 ms median | inside the historical range |

These small differences are run-to-run observations, not proof of an optimization effect. The two records use synthetic projection work and startup paths rather than the full interactive terminal pipeline.

## Startup (built artifacts, five measured runs unless marked first)

| Path | median ms | p90 ms | status |
|---|---:|---:|---:|
| `apps/tui-cli/bin/dsh-tui.js --version` | 180 | 211 | 0 |
| `apps/cli/lib/bin.js --help` | 227 | 234 | 0 |
| `apps/cli/lib/bin.js --profile tui --dump-config` (isolated home, first) | 210 | 210 | 0 |
| `apps/cli/lib/bin.js --profile tui --dump-config` (isolated home, warm) | 186 | 271 | 0 |

Daily launch uses `pnpm dsh-tui` after `pnpm run build`. Source-mode `tsx` timing is outside this product baseline.

## Web Host comparison

The checked-in measurements contain no same-machine Web Host process-tree capture for this workload. The historical 121–192 MB rows are TUI wrapper + dsh-child figures, not Web figures, so a numeric Web/TUI memory or CPU ratio is not reported. A controlled comparison must use the same profile, session log, model/tool replay, duration, sampling interval, and process-tree ownership; the Web path additionally includes browser renderer/GPU processes whose RSS is outside the dsh child. Tool and web-search execution remain Harness-owned in both hosts, while this change alters only TUI presentation, its launcher, and repository-only evaluation fixtures.

## Coverage required for the long-task baseline

- Slow-drain campaign: frame bytes, changed rows, `writableLength`, dropped frames, event-loop delay, and input-to-flush p50/p95/p99.
- Manual IME composition and jump-to-bottom coverage; the compressed PTY already covers Chinese text, Backspace, PageUp/PageDown, and Shift+Tab, while parser tests cover delayed or missing bracketed-paste end markers plus bounded drain after an oversized paste.
- Memory attribution: dsh PID and full descendant tree, V8 heap spaces, external memory, parser pending bytes, composer optimistic bytes, session-event count, and fold resident chars.
- Duration beyond the 30-minute interactive build: the two-hour continuous-session soak in `evaluation/tui/soak.mjs`; memory slope is evaluated after warm-up rather than from one endpoint.
- Long-session recovery: 10k, 50k, and 100k events with time to loading state, first interactive frame, and fully ready state.

## Harness boundary

This refresh measures assembled Harness bins and changes the TUI package, its launcher, its Ink patch, and TUI-owned evaluation files. Agent-loop, provider, web-search/tool execution, and persisted session formats remain untouched.
