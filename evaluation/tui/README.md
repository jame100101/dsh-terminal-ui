# dsh-tui performance evaluation

English | [中文](README.zh.md)

This directory contains TUI performance-evaluation tools, machine-readable results, and the current long-task report. The release-facing summary is [`../performance/DSH_TUI_PERF_CURRENT.md`](../performance/DSH_TUI_PERF_CURRENT.md), and the implementation and residual-risk audit is [`long-task-readonly-audit.md`](./long-task-readonly-audit.md).

## Current evidence

| File | Purpose |
|---|---|
| [`long-task-2h-20260830-summary.json`](./long-task-2h-20260830-summary.json) | Derived metrics and five-minute buckets from the two-hour real task on 2026-08-30 |
| [`long-task-2h-20260830-memory.svg`](./long-task-2h-20260830-memory.svg) | Two-hour chart of TUI RSS, TUI private bytes, and full process-tree RSS |
| [`long-task-2h-20260830-last60.svg`](./long-task-2h-20260830-last60.svg) | Enlarged view of the final 60-minute plateau |
| [`conpty-soak-last.json`](./conpty-soak-last.json) | Complete result from the 30-minute automated Windows ConPTY/build campaign |
| [`soak-last.json`](./soak-last.json) | Result from the fast cumulative session/fold/parser soak |

The two-hour charts use five-minute bucket medians; the blue area spans the minimum and maximum TUI RSS in each bucket. The JSON retains sample integrity, PID continuity, window slopes, CPU, handles, threads, and bucket values. The source CSV remains in `%TEMP%` on the run host and is not a pinned repository input.

## Two-hour real-task monitoring

Start the source TUI, then start the external monitor in another PowerShell window:

```powershell
pnpm dsh-tui

powershell -ExecutionPolicy Bypass -File evaluation/tui/monitor-dsh-tui-2h.ps1 `
  -DurationMinutes 130 `
  -IntervalSeconds 5
```

The monitor finds the most recently started `dsh-tui` launcher, tracks it and the complete set of descendants discovered afterward, and records RSS, private bytes, CPU, process count, handles, and threads. `Ctrl+C` stops only the monitor, not the TUI. Pass `-LauncherPid PID` to bind a specific launcher.

Regenerate the compact JSON and SVG files from a source CSV:

```powershell
node evaluation/tui/summarize-monitor.mjs `
  "$env:TEMP\dsh-tui-2h-YYYYMMDD-HHMMSS.csv" `
  "2026-08-30T09:34:00+08:00" `
  "2026-08-30T11:34:15+08:00" `
  "evaluation/tui/long-task-2h-YYYYMMDD"
```

The task start and end times must come from the task's own record, not directly from the first and last monitor timestamps. Start the monitor before the task and keep sampling for several minutes after completion to observe the transition out of the busy state.

## Automated ConPTY campaign

`conpty-soak.mjs` launches the built product in a real Windows PTY, continuously publishes a busy transcript, and automatically exercises input, Chinese editing, Backspace, PageUp/PageDown, return-to-bottom, Shift+Tab, Thinking, todo/goal, and an optional real build. Its result includes input acknowledgement latency, maximum Thinking stall, in-process `heapUsed`, RSS, output bytes, and the build outcome.

```powershell
node evaluation/tui/conpty-soak.mjs --duration-minutes 30 --run-build
```

This campaign requires an available ConPTY. A sandbox without PTY permission may end with `EPERM`; report that host restriction separately from a product failure.

## Fast cumulative soak

`soak.mjs` continuously appends synthetic session events in one process while reusing the same fold and parser, reaching node, trace, and character budgets quickly. It is not a wall-clock interaction test and does not exercise Windows Terminal, Ink stdout, real tool processes, or the network.

```powershell
node evaluation/tui/soak.mjs --duration-ms 120000
```

## Metric interpretation

- RSS is the resident physical working set; private bytes are process-private committed memory. Neither is V8 `heapUsed`.
- TUI metrics select only the actual `--profile tui` runtime; tree metrics include the launcher and every descendant discovered during monitoring.
- Slopes use ordinary least squares in MiB/min. When R² is very low, the slope shows only a weak direction rather than a stable leak rate.
- Peak values define capacity limits; second-half medians, P95, bucket ranges, and slopes indicate whether memory has plateaued.
- A stable PID and complete samples prove only process continuity. ConPTY acknowledgement and stall fields must demonstrate input latency and animation continuity.

## Release decision

Long-task stability requires checking task wall-clock duration, PID continuity, sample gaps, TUI and process-tree peaks, second-half slopes, visible reclamation, input p95/p99, Thinking stalls, build failures, and terminal reset after abnormal exit. The external two-hour monitor and automated ConPTY campaign provide complementary evidence; neither result covers every metric alone.
