# dsh-tui 性能评估

[English](README.md) | 中文

本目录保存 TUI 性能评估工具、机器可读结果和当前长任务报告。面向发布的汇总位于 [`../performance/DSH_TUI_PERF_CURRENT.md`](../performance/DSH_TUI_PERF_CURRENT.md)，实现与残留风险审计位于 [`long-task-readonly-audit.md`](./long-task-readonly-audit.md)。

## 当前证据

| 文件 | 用途 |
|---|---|
| [`long-task-2h-20260830-summary.json`](./long-task-2h-20260830-summary.json) | 2026-08-30 两小时真实任务的派生指标和五分钟分块数据 |
| [`long-task-2h-20260830-memory.svg`](./long-task-2h-20260830-memory.svg) | 两小时 TUI RSS、TUI Private Bytes 和完整进程树 RSS 图 |
| [`long-task-2h-20260830-last60.svg`](./long-task-2h-20260830-last60.svg) | 后 60 分钟平台区放大图 |
| [`conpty-soak-last.json`](./conpty-soak-last.json) | 30 分钟自动 Windows ConPTY/build campaign 的完整结果 |
| [`soak-last.json`](./soak-last.json) | 快速累计 session/fold/parser soak 的结果 |

两小时图表使用五分钟块中位数；蓝色阴影表示每块 TUI RSS 最小值到最大值。JSON 保留监控样本完整性、PID 连续性、窗口斜率、CPU、句柄、线程和分块数值。原始 CSV 位于运行主机 `%TEMP%`，不作为仓库固定输入。

## 两小时真实任务监控

先启动源码 TUI，再在另一个 PowerShell 窗口启动外置监视器：

```powershell
pnpm dsh-tui

powershell -ExecutionPolicy Bypass -File evaluation/tui/monitor-dsh-tui-2h.ps1 `
  -DurationMinutes 130 `
  -IntervalSeconds 5
```

监视器查找最近启动的 `dsh-tui` launcher，跟踪它及后续发现的完整后代集合，记录 RSS、Private Bytes、CPU、进程数、句柄和线程。`Ctrl+C` 只停止监控，不终止 TUI。需要绑定特定 launcher 时传入 `-LauncherPid PID`。

用原始 CSV 重新生成紧凑 JSON 和 SVG：

```powershell
node evaluation/tui/summarize-monitor.mjs `
  "$env:TEMP\dsh-tui-2h-YYYYMMDD-HHMMSS.csv" `
  "2026-08-30T09:34:00+08:00" `
  "2026-08-30T11:34:15+08:00" `
  "evaluation/tui/long-task-2h-YYYYMMDD"
```

任务开始和结束时间必须来自任务自身记录，不能直接用监视器首尾时间代替。监视器应先于任务启动，并在任务完成后继续采样数分钟，以观察退出忙态后的回落。

## 自动 ConPTY campaign

`conpty-soak.mjs` 在真实 Windows PTY 中启动构建产物，持续发布 busy transcript，并自动执行输入、中文编辑、Backspace、PageUp/PageDown、回到底部、Shift+Tab、Thinking、todo/goal 和可选真实构建。结果包括 input acknowledgement latency、Thinking 最大停顿、进程内 `heapUsed`、RSS、输出字节和构建结果。

```powershell
node evaluation/tui/conpty-soak.mjs --duration-minutes 30 --run-build
```

该 campaign 需要可用 ConPTY；没有 PTY 权限的沙箱可能以 `EPERM` 结束。产品失败与宿主阻止创建 PTY 必须分别报告。

## 快速累计 soak

`soak.mjs` 在一个进程内持续追加合成 session 事件并复用同一个 fold/parser，用于快速达到节点、trace 和字符预算。它不是墙钟交互测试，也不经过 Windows Terminal、Ink stdout、真实工具进程或网络。

```powershell
node evaluation/tui/soak.mjs --duration-ms 120000
```

## 指标解释

- RSS 是驻留物理工作集；Private Bytes 是进程私有提交内存。两者都不等于 V8 `heapUsed`。
- TUI 指标只选择实际 `--profile tui` runtime；tree 指标包含 launcher 和监控期间发现的所有后代。
- 斜率使用普通最小二乘，单位为 MiB/min；R² 很低时，斜率只表示弱方向，不表示稳定泄漏率。
- 峰值用于容量门槛，后半程中位数、P95、分块范围和斜率用于判断平台化。
- 同一 PID、无缺失样本只证明进程连续；输入延迟和动画流畅度必须由 ConPTY acknowledgement 和 stall 字段证明。

## 发布判定

长任务稳定性至少同时检查：任务墙钟时间、PID 连续性、采样缺口、TUI/进程树峰值、后半程斜率、明显回收、输入 p95/p99、Thinking stall、构建失败和异常退出后的终端复位。外置两小时监控与自动 ConPTY campaign 是互补证据，任一单独结果都不覆盖全部指标。
