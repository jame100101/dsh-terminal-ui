# Agent Note: TUI DeepSeek 会话费用

Status: implemented

[English](2026-08-30-tui-deepseek-session-cost.md) | 中文

## Problem

终端 surface 已经显示会话 token 总量，但没有把 provider 报告的各个 bucket 换算成长任务监控时需要的美元金额。直接用当前所选模型乘以整段会话会错误计算切换过模型的会话，而把 reasoning tokens 再加到 completion tokens 上则会对 DeepSeek reasoning 重复计费。

## Decision

TUI 从耐久的请求路由与已完成 step 的 usage 折叠美元估算费用，不改变 Harness 事件、Agent Loop 或 provider adapter。每个 `step/start` 捕获最新路由，而该 step 内的 `request/header` 会在 usage sample 提交前替换它。fold 分别计算每个已完成 step 并把结果累加到 `SessionStats.costUsd`，因此后续模型变化不会重算先前工作。没有正文内容的 completion 仍会提交 usage 与费用，而缺失的 timing sample 保持为零。

初始费率表与 pi-ai 0.82.1 的 `deepseek-v4-flash` 和 `deepseek-v4-pro` 保持一致：未缓存输入、输出、cache-read 与 cache-write bucket 使用 pi 的每百万 token 美元算法。DeepSeek completion usage 已经包含 reasoning tokens，因此 reasoning bucket 只用于信息展示，不会再次计费。只有模型 id 已知且路由为 `deepseek` 或 `deepseek-official` 的请求会贡献费用。

权限行在右边缘以 `$N.NNN` 显示总额，与 pi 会话 footer 的精度一致。窄终端会先隐藏金额，避免把权限控件压缩到不可用宽度。因为持久化 fold 统计现在包含 `costUsd`，projection sidecar 使用 projection version 2；version 1 文件会回退到权威日志回放。

## Alternatives considered

**用当前模型乘以累计 token。** 实现更短，但会在 `/model` 变化后静默重算历史费用，也不能为不同 step 选择各自的费率表。

**把 pi-ai 运行时目录与费用 helper 导入 TUI bundle。** 为两个目录行引入 provider 目录及其依赖图，会扩大对延迟敏感的终端包。把两个 DeepSeek 条目保存在本地可维持较小的渲染闭包；代码明确记录来源版本，使 pi-ai 目录升级具有明确的同步点。

**持久化新的计费事件，或在 adapter 中恢复被丢弃的 pi-ai cost object。** 费用是根据已有耐久路由与 usage 事实派生出的 TUI 展示。修改共享事件或 adapter 会扩大 Harness surface，却不会增加回放依据。

## Consequences

长会话和恢复后的会话无需 API 调用或逐帧工作即可显示稳定的美元总额。该金额是按照固定 pi-ai 费率计算的本地估算，而不是 provider 账单；新引入的 provider 路由或模型会保持未计价，直到明确加入费率。更新费率时必须同步 calculator 测试与本说明。旧 TUI projection cache 会在 version 2 下回放一次，随后重新写入。

## Testing

`deepseek-cost.spec.ts` 固定两项 pi-ai 费率、reasoning 不重复计算规则、未知路由行为与三位小数格式。`fold.spec.ts` 验证跨模型变化的两个 step 与没有正文、仅带 usage 的 completion 分别计费。`render-frame.spec.ts` 验证格式化总额位于权限行右边缘，`projection-sidecar.spec.ts` 通过常规 round-trip 校验覆盖新的 projection version。
