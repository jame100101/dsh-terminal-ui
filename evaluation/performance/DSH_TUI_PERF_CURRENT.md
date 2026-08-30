# dsh-tui 当前性能基线

本页汇总当前 TUI 的可复现性能证据。历史发布数据保留在 [`DSH_TUI_RELEASE_BASELINE.md`](./DSH_TUI_RELEASE_BASELINE.md)，评估工具和原始派生结果位于 [`../tui/`](../tui/README.md)。

## 结论

`v0.1.0-rc.12` 的两小时真实长任务没有复现约 4 GiB V8 OOM、进程退出、PID 重启或采样中断。TUI RSS 峰值为 749.59 MiB，完整受监控进程树 RSS 峰值为 978.46 MiB；后 60 分钟 TUI RSS 为 472.34 MiB 中位数、496.59 MiB P95，线性斜率为 +0.279 MiB/min（R² 0.11），完整进程树 RSS 斜率为 +0.118 MiB/min（R² 0.02）。这些结果支持关闭“长任务快速增长到 heap limit 并崩溃”的主问题。

外部监视器没有采集 V8 heap spaces、`external`、`stdout.writableLength`、丢帧数、输入延迟或动画停顿。两小时数据证明操作系统进程内存和进程连续性，不单独证明每个内部队列都已饱和，也不替代自动 ConPTY 的交互延迟数据。

## 证据矩阵

| 评估 | 工作负载 | 时间 | 主要证据 | 结论 |
|---|---|---:|---|---|
| 真实长任务 + 外置进程树监控 | 78 轮只读交叉审计、数百次工具调用、持续 todo/goal 更新 | 120.26 min | 1,383 个任务窗口样本；TUI PID 全程不变；进程树峰值 978.46 MiB | 原 4 GiB OOM 模式未复现；后半程进入弱趋势平台区 |
| 自动 Windows ConPTY/build campaign | 3,000 节点、40 ms 更新、重复真实构建和自动按键 | 30.00 min | 7,392 个输入样本；p95/p99 94/111 ms；Thinking 最大停顿 560 ms | 自动交互、动画和真实构建路径满足当前预算 |
| keyless 微基准 | publish、增量 wrap、滚轮、fold、启动 | 秒级 | 40 ms 合帧；滚轮 p99 <8 ms；fold 预算和启动路径通过 | 锁定热路径复杂度和发布预算 |
| 纯内存累计 soak | 142,747 个事件，3,000 fold 节点 | 10 s 压缩运行 | RSS 295.85 MiB，heapUsed 74.78 MiB，fold 470,660 字符 | 投影达到节点上限后保持在代码预算内 |

## 两小时真实长任务

- 监控：2026-08-30 09:30:44–11:40:40（UTC+08:00），总计 1495 个样本。
- 任务：2026-08-30 09:34:00–11:34:15，真实持续 120.26 分钟；任务窗口包含 1383 个样本。
- 采样间隔：最小 5.1 s，中位数 5.2 s，P95 5.3 s，最大 5.4 s；超过 7 s 的缺口为 0。
- 进程连续性：launcher PID `15216`、TUI PID `13856` 全程不变，缺失 TUI 样本为 0。
- 运行版本：`main` / `a1d8ee0` / `v0.1.0-rc.12`。任务启动后工作树存在并发编辑；已启动 Node 进程不热重载这些后续文件，因此数据只归属于启动时已加载的运行时。

![两小时长任务内存曲线](../tui/long-task-2h-20260830-memory.svg)

| 指标 | 任务开始 | 任务结束 | 峰值 | 任务全程斜率 |
|---|---:|---:|---:|---:|
| TUI RSS | 300.96 MiB | 487.90 MiB | 749.59 MiB | +0.738 MiB/min |
| TUI Private Bytes | 333.05 MiB | 544.50 MiB | 790.08 MiB | +0.916 MiB/min |
| 完整进程树 RSS | 491.13 MiB | 710.43 MiB | 978.46 MiB | +0.919 MiB/min |
| 完整进程树 Private Bytes | 451.36 MiB | 710.54 MiB | 944.76 MiB | — |

全程斜率包含预热、会话增长和约第 60 分钟前的高分配阶段，不能表示稳态泄漏速度。10:34:03 的 TUI RSS 达到 749.59 MiB，约五秒后降到 399.40 MiB，单次下降约 350 MiB；任务窗口内还有 9 次至少 100 MiB、26 次至少 50 MiB 的采样间下降。该锯齿说明大块工作集可以回收，与持续单调爬升到 V8 heap limit 的故障曲线不同。

### 后 60 分钟

![两小时长任务后 60 分钟内存曲线](../tui/long-task-2h-20260830-last60.svg)

| 指标 | 开始 | 结束 | 中位数 | P95 | 最大值 | 斜率 / R² |
|---|---:|---:|---:|---:|---:|---:|
| TUI RSS | 449.08 | 487.90 | 472.34 | 496.59 | 530.71 MiB | +0.279 MiB/min / 0.11 |
| TUI Private Bytes | 493.19 | 544.50 | — | — | — | +0.740 MiB/min / 0.45 |
| 完整进程树 RSS | — | — | 约 700 | — | — | +0.118 MiB/min / 0.02 |

后 30 分钟的 TUI RSS 只从 483.57 MiB 变为 487.90 MiB，净增加 4.33 MiB；中位数 475.41 MiB、P95 501.15 MiB、峰值 522.12 MiB。RSS 后半程已形成平台，但 Private Bytes 仍有轻微上升，后续应结合 V8 heap spaces 和 TUI 自有容器计数区分“有界会话驻留”与“未达到上限的持续增长”。

### CPU、句柄和线程

| 指标 | 结果 |
|---|---:|
| TUI CPU 累计 / 单核平均占用 | 1096.69 s / 15.22% |
| 完整进程树 CPU 累计 / 单核平均占用 | 1152.55 s / 15.99% |
| 进程树句柄，开始 / 结束 / 峰值 | 1523 / 1954 / 2090 |
| 句柄后 60 分钟斜率 / R² | −0.699/min / 0.01 |
| 进程树线程，开始 / 结束 / 峰值 | 72 / 56 / 75 |

句柄数在任务中波动，但后 60 分钟没有单调上升证据；线程数在结束时低于开始值。CPU 数据是累计处理器时间除以墙钟时间所得的单核占比，不能直接推导输入延迟或终端帧率。

## 自动 Windows ConPTY/build campaign

`evaluation/tui/conpty-soak-last.json` 保存自动化 30 分钟战役结果。

| 指标 | 值 |
|---|---:|
| 时长 | 30.00 min |
| 重复真实构建 | 40，失败 0 |
| 输入样本 | 7392 |
| 输入延迟 p50 / p95 / p99 / max | 62 / 94 / 111 / 296 ms |
| Thinking 最大停顿 | 560 ms |
| TUI RSS / heapUsed 峰值 | 413.75 / 249.34 MiB |
| 完整 evaluator 集 RSS 峰值 | 522.29 MiB |
| 文件内记录的 post-warm-up RSS 斜率 | 7.191 MiB/min |
| 终端输出 / 构建输出 | 20.80 / 6.15 MiB |

Windows 进程表访问在这次 campaign 中使用 parent-less fallback，因此完整 evaluator 集不保证包含每个构建后代；TUI RSS 和进程内 heapUsed 是直接采样。两小时外置监控补充了完整后代树和更长墙钟时间，但没有 ConPTY 的输入确认和进程内 heapUsed 字段。

## 热路径预算

- token delta 的 UI 发布窗口为 40 ms，即最高约 25 次发布/秒；结构事件立即发布。
- live assistant wrap 只重算未完成末行；live Thinking 只保留有界尾部。
- 滚轮解析、偏移和 viewport 微基准 p99 小于 8 ms。
- transcript 使用有界节点投影、可见窗口和 overscan；fold 上限为 3000 节点和 1.5M 计入预算的字符。
- stdout 背压只保留一个待重绘标志，`drain` 后重绘最新 React 树。
- launcher 在加载 React 前选择 production 环境，避免开发模式 User Timing measure 长期保留。

## 启动基线

以下数据来自构建产物的五次测量；源码 `tsx` 启动不属于发布基线。

| 路径 | 中位数 | P90 | 状态 |
|---|---:|---:|---:|
| `apps/tui-cli/bin/dsh-tui.js --version` | 87 ms | 96 ms | 0 |
| `apps/cli/lib/bin.js --help` | 107 ms | 110 ms | 0 |
| `apps/cli/lib/bin.js --profile tui --dump-config`，隔离 home 首次 | 709 ms | 709 ms | 0 |
| `apps/cli/lib/bin.js --profile tui --dump-config`，隔离 home warm | 507 ms | 528 ms | 0 |

## Web Host 对比范围

仓库中没有与两小时任务同机、同 session log、同模型和工具重放、同采样器的 Web Host 进程树数据，因此不报告 Web/TUI 内存或 CPU 比例。历史 121–192 MiB 数据是 TUI wrapper 与 dsh child，不是 Web Host。工具调用和联网搜索由 Harness 拥有，TUI 只消费会话事件并负责终端呈现。

## 剩余测量缺口

1. 在外置进程监控之外同步采集 V8 `heapUsed`、`heapTotal`、heap spaces、`external` 和 `arrayBuffers`。
2. 记录 `stdout.writableLength`、背压开始/结束、丢弃帧、changed rows 和 input-to-flush p50/p95/p99。
3. 记录 composer 字符数、粘贴块总字节、history 条目/字节、workflow/subagent 容器大小和 fold 中未计预算 card 字符数。
4. 用自动按键/确认协议覆盖两小时真实任务，使输入、滚动、Shift+Tab、Thinking 秒数、todo/goal 更新获得机器可判定结果。
5. 增加 10k、50k 和 100k 事件 session 的 loading、首个可交互帧和 fully-ready 时间。

## 发布判断

长任务崩溃主问题达到关闭门槛：两小时真实任务保持同一 PID、无采样缺口、完整进程树峰值低于 1 GiB，并在后半程形成低斜率平台。Private Bytes 的轻微增长和 TUI 自有残留容器应进入独立有界性 issue；它们不应继续与原 4 GiB OOM 根因共用一个关闭条件。

本评估只覆盖 TUI、launcher、Ink patch 和仓库内评估工具。`agent-loop`、模型 provider、联网搜索执行、工具执行和持久化 session 格式不属于本次性能修改面。
