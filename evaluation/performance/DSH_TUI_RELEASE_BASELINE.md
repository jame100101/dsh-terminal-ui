# dsh-tui historical release performance baseline

This file preserves the 2026-08-16 and 2026-08-21 rc.8 measurements. It has been superseded by [`DSH_TUI_PERF_CURRENT.md`](./DSH_TUI_PERF_CURRENT.md) for the current local source and must not be used as evidence that the reported long-task OOM and input stalls are resolved.

## Recorded baseline (2026-08-21, post fold working-set)

The 2026-08-16 numbers below (`687acd7`) predate overlay rc.8, publish coalesce, incremental wrap, the 3000-row fold working set, and `pnpm dsh:tui`. They remain historical process-tree RSS. Current measurements and current coverage gaps are recorded in `DSH_TUI_PERF_CURRENT.md`.

Recorded by `packages/tui/tui/tests/perf-acceptance.spec.ts` on Windows, Node v24.14.0. No `--expose-gc` in the vitest worker (`heapUsed` is still reported). Overlay: GitHub `deepseek-ai/deepseek-harness` master `141eb6fef8` / `dsh-v0.1.0-rc.8`.

### Busy stream (keyless)

| Check | Budget | Result |
|---|---|---|
| UI publish coalesce | 40 ms window (≤ 25 publish/s for token deltas) | pass (`STREAM_UI_PUBLISH_MS = 40`) |
| Incremental live wrap | second 80 chunks cheaper than a full rewrap | pass |
| Wheel parse + offset + viewport | p99 < 8 ms over 800 ticks | pass (one frame ≈ 16 ms) |
| `TUI_PERF=1` fields | publish/s, render/s, heap=, wheel_avg/max, lag= | pass |

### Fold working set (100 / 500 synthetic turns, 20 KiB assistant bodies)

| Turns | fold nodes | traces | resident chars | heapUsed |
|---|---:|---:|---:|---:|
| 100 | 300 | 400 | 2.0M | **17.5 MB** |
| 500 | 1500 | 512 | 10.0M | **19.0 MB** |

TUI heap does not scale 5× with turns. Remaining live-Agent growth is the in-memory session event log (outside the TUI package). Caps: 3000 nodes, assistant 32 KiB, user 8 KiB, think/tool/context 4 KiB, 512 traces.

### Built-artifact startup (no tsx)

| Path | Wall | vs 2026-08-16 |
|---|---:|---|
| `apps/tui-cli/bin/dsh-tui.js --version` | **90–92 ms** | 76 ms median (same class) |
| `apps/cli/lib/bin.js --help` | **~100 ms** | — |
| `apps/cli/lib/bin.js --profile tui --dump-config` | **0.3–0.6 s** | composition only; full Ink surface remains Cordis-bound (~2.1 s class) |
| `pnpm dsh --profile tui` (tsx source) | not the product path | ~19.6 s |

Daily launch: `pnpm run build` then `pnpm dsh:tui` (one Node process).

The next section is the original 2026-08-16 interactive process-tree campaign.

## Environment

- OS: Microsoft Windows 11 专业版, build 10.0.26200, x64
- CPU: 13th Gen Intel(R) Core(TM) i7-13620H — 10 cores / 16 logical processors, base 2.4 GHz
- RAM: 15.7 GB
- Node: v24.14.0
- pnpm: 11.7.0
- Isolated benchmark home: `DSH_HOME=D:\dsh-perf-bench\home` (profile, credentials, and settings copied from the real home; every benchmark session lands on the D drive and is removed with the benchmark directory)
- Benchmark cwd: `D:\dsh-perf-bench\work`
- Workload: short CJK prompts (`只回复 OK`); large-tool-output prompt reads a 4.6 MB / 60 000-line fixture (`bench-large.txt`, verified: the model answered the exact count `60000`)
- All runs use the built artifacts; no tsx/dev mode anywhere.

## Build Tested

- commit: `687acd7`
- built artifacts:
  - `apps/cli/lib/bin.js` (built 2026-08-16 13:26)
  - `packages/tui/tui/lib/index.js` (built 2026-08-16 13:26)
  - `apps/tui-cli/bin/dsh-tui.js` (shipped bin, no build step)

## Process Architecture

`dsh-tui` runs exactly TWO Node processes, confirmed by PPID chain and
command-line sampling during a real print turn:

```
shell / driver
  └─ node apps/tui-cli/bin/dsh-tui.js                     wrapper (PPID = caller)
       └─ node apps/cli/lib/bin.js --profile tui ...      dsh child (PPID = wrapper)
```

Per-process facts during one `-p "只回复 OK"` turn (1.5 s sampling):

| Process | Working Set | Private | CPU time |
|---|---|---|---|
| wrapper | 56.9 MB | 26.9 MB | 0.08 s |
| dsh child | 66 → 185.8 MB (turn active) | 68.4 MB (median) | 2.91 s |

- No third Node process appears for short turns (worker threads live inside the child).
- The wrapper does not proxy stdio (`stdio: 'inherit'`), so there is no stream-copy cost.
- The wrapper's CPU stays ~0.1 s per turn: it only parses argv, resolves the dsh bin, forwards signals, and waits.

## Startup Results

All timings are wall-clock. Cold = first 5 runs with 8 s gaps; warm = 10
back-to-back runs.

| Scenario | Runs | Min | Median | P90 | Mean | Max |
|---|---|---|---|---|---|---|
| A. `dsh-tui --version` (cold) | 5 | 77 | 103 | 126 | 101 | 126 |
| A. `dsh-tui --version` (warm) | 10 | 73 | **76** | 89 | 80 | 95 |
| B. `dsh-tui --help` (cold) | 5 | 75 | 81 | 114 | 91 | 114 |
| B. `dsh-tui --help` (warm) | 10 | 76 | **84** | 93 | 85 | 99 |
| C. `dsh-tui -p "只回复 OK"` (cold) | 5 | 3371 | 3460 | 3628 | 3500 | 3628 |
| C. `dsh-tui -p "只回复 OK"` (warm) | 10 | 3362 | **3600** | 3799 | 3624 | 3816 |
| D. bare `dsh-tui` → surface ready | 5 | 2109 | **2131** | 2226 | 2150 | 2226 |
| E. `dsh-tui "只回复 OK"` → dispatch + turn | 3 | 3272 | **3366** | 3469 | 3369 | 3469 |

Notes:

- C wall time is dominated by the model, not the harness: with a clean prompt
  the spread is tight (3.4–3.8 s), while a garbled-prompt pilot run produced a
  386 s outlier — that outlier was prompt corruption, not the product, and is
  excluded from this baseline.
- D is the time to the linear-mode banner (boot → Cordis ready → agent ready
  → surface banner). The Ink first-frame time is NOT MEASURED RELIABLY: this
  environment has no PTY, and no product instrumentation exists. The banner is
  the closest external proxy; the real TTY path additionally mounts Ink after
  the same boot.
- E includes one real startup-prompt turn; the answer marker and banner
  landed in the same stdout flush in these three runs (fast "OK" replies), so
  E ≈ boot (2.1 s) + model turn (~1.2 s). It is model-latency dependent.

## Memory Results

Median working set / private per process, sampled every 20 s during one
19.9-minute interactive session (boot → 10 short turns → large tool output →
5 min idle). Wrapper and child are summed for the tree total.

| Scenario | Wrapper WS / Priv (MB) | Child WS / Priv (MB) | Tree WS (MB) |
|---|---|---|---|
| boot, idle (first 40 s) | 55.4 / 23.8 | 66.0 → 114 / 68.5 | ~121 |
| after 1 turn | 55.4 / 23.7 | 125.9 / 139.2 | ~181 |
| after 5 turns | 55.6 / 23.7 | 127.5 / 132.9 | ~183 |
| after 10 turns | 55.1 / 23.7 | 128.8 / 136.8 | ~184 |
| large tool output turn (busy) | 55.1 / 23.7 | 136.9 / 154.2 | ~192 |
| idle after tool turn | 55.1 / 23.7 | 136.9 / 154.2 | ~192 |
| idle ~5 min | 55.1 / 23.7 | 136.9 / 154.2 | ~192 |

- V8 heap/external numbers are N/A: not obtainable from outside without
  product instrumentation (forbidden by this task).
- The `--help`/`--version` wrapper process is too short-lived to sample; its
  footprint equals the wrapper row above (same process shape, 55 MB WS /
  24 MB private).

## CPU Results

Per-process CPU deltas across phase windows (16 logical cores available).

| Window | wrapper | dsh child |
|---|---|---|
| boot (first 40 s) | ~31 ms | ~2.4 s (≈6% of one core; boot work) |
| one short turn (~75 s window) | 0 | ~2.0–2.3 s (≈3% of one core; network wait dominates) |
| large tool output turn (~90 s window) | 0 | ~2.3 s (≈2.5% of one core) |
| idle 30 s (post-turn) | 0 | ~0.06 s (≈0.2% of one core) |
| idle → 5 min | 0 | ~1.06 s over ~400 s (≈0.27% of one core) |

- No busy idle polling: the wrapper is at zero CPU once spawned, and the child
  settles to ~0.2–0.3% of one core when idle.
- The Ink renderer's 100 ms tick is busy-only by code (`render.tsx`: the
  interval arms only while `snapshot.busy || hasPendingRetry ||
  snapshot.compaction`), and the /jobs poll runs only while that panel is
  open. Ink's own idle rendering cost could not be measured without a PTY.

## Wrapper Overhead

Same workload through both paths, warm, 10 runs each:

| Path | Median wall | Processes | Tree WS (idle-ish) |
|---|---|---|---|
| `dsh-tui -p "只回复 OK"` | 3600 ms | 2 | ~192 MB |
| `node apps/cli/lib/bin.js --profile tui -p "只回复 OK"` | 3485 ms | 1 | ~137 MB |

- **Wrapper startup overhead: ~+115 ms median (range +60–140 ms), ≈3.3%** of the direct-path wall time (means: +130 ms, ≈3.7%).
- **Wrapper memory overhead: +55.4 MB working set / +23.7 MB private** (the wrapper process itself) — ≈+40% of the child's working set, ≈+15% of its private bytes.
- The wrapper adds one process and one Node startup (~80 ms of the +115 ms is the wrapper's own boot).

## Long-session Observation

- 1 → 10 short turns: child WS +2.9 MB (125.9 → 128.8), private flat
  (139.2 → 136.8 MB). **No sustained growth across turns.**
- Large tool output (4.6 MB file read into the transcript): +8 MB WS /
  +17 MB private, retained at idle — the fold keeps the settled tool card and
  result for the visible transcript, by design.
- 5 min idle: byte-stable (136.9 / 154.2 MB throughout). **No release, but no
  leak evidence either** — retained transcript memory is the expected
  behavior, not a leak.
- Every run persists its session into the benchmark home (75+ small session
  files in the work bucket across the whole campaign) — normal per-session
  persistence, cleaned with the benchmark directory.

## Findings

- **Observation — startup is normal Node CLI level.** 76–84 ms for the
  wrapper fast paths, ~2.1 s to a ready surface, ~3.5 s for a full print turn
  (model-bound). No startup regression to fix.
- **Observation — idle memory is reasonable.** ~192 MB tree total for a full
  Cordis profile + session; stable over 10 turns and 5 idle minutes.
- **P2 — the wrapper's second Node process costs ~55 MB WS / ~24 MB private
  and ~3% startup.** Acceptable for the launch UX; the only way to remove it
  is folding the translation into the launcher (out of scope for this task).
- **Observation — print-mode wall time is model-latency dominated** (3.4–3.8 s
  in this baseline; the pilot's 386 s outlier was traced to prompt corruption
  from a PowerShell 5.1 encoding artifact in the benchmark harness, not to the
  product).
- **Observation — large tool outputs are retained in memory** (~+17 MB private
  after one 4.6 MB read). Expected transcript retention; worth revisiting only
  if very large tool outputs become a common workflow.
- **Observation — no idle CPU cost** beyond ~0.2–0.3% of one core; the Ink
  tick is busy-only by code.

## Historical recommendation

The following recommendation is retained as the conclusion recorded in August 2026. The current approximately 4 GB V8 heap failure invalidates it as a present release decision.

1. **Ship this release without performance changes.** Boot, idle memory, idle
   CPU, and long-session behavior are all healthy.
2. Keep the wrapper's two-process design for now. Revisit only if a future
   release sets an explicit single-process or sub-150 MB idle budget; the
   removal path is folding the UX translation into `apps/cli`'s bin, which
   touches the launcher and deserves its own round.
3. For the next baseline, consider a PTY-based (ConPTY) harness so the real
   Ink first-frame time can be measured; optionally add product-side boot
   lifecycle markers (Cordis-ready → agent-ready → Ink entry) — that is
   product instrumentation and was therefore out of scope here.

## Cleanup

- `D:\dsh-perf-bench` removed in full (scripts, data CSVs, logs, fixtures,
  isolated `DSH_HOME` including every benchmark-created session, the packed
  artifacts, and all experiment outputs).
- No processes left running; no benchmark data written to the real `~/.dsh`
  (the user's sessions were never touched).
- No files inside the repository beyond the report itself.

## Git Safety

- HEAD before: `687acd7`
- HEAD after: `687acd7`
- working tree before: clean
- working tree after: one new untracked file, `evaluation/performance/DSH_TUI_RELEASE_BASELINE.md`
- source files modified: **NO**
- commit: **NO**
- push: **NO**
