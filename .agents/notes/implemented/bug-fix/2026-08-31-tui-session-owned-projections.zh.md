# Agent Note: TUI 恢复会话所有的路由与投影

Status: implemented

[English](2026-08-31-tui-session-owned-projections.md) | 中文

## 问题

Resume 和 fork 操作可能复用当前显示的 model selection，即使目标日志或 fork seed 使用了不同的 request route。jobs 面板也曾在没有 Agent owner 的情况下读取进程 registry；workflow 行则把 process-global 生命周期事件当作权威来源，尽管这些事件不包含父 session 身份。

## 决策

TUI 从目标日志最新的 canonical `request/header` 重建 model 与 reasoning selection；fork 则从 seed 前缀重建，legacy 日志回退到 deployment default。恢复 Agent 的 setup 会安装可变 request hook，并且 replacement Agent 发布前必须成功解析已记录的精确 route 及其 reasoning levels。fork 的临时 live handle 在 dispose 前会跨过显式 session flush barrier，因此返回的 id 已指向可读取的 cold artifact。

Jobs 通过 `jobs.list(surface.agent)` 投影，并由 `onJobsChanged` 刷新；精确 Agent identity 过滤其他 owner 的通知，同时保留未拥有 job 的可见性。Workflow 行在 live 与 replay 两条路径都从当前 Session 的 durable `tool-workflow/*` 事件折叠，遵循[对话中的 durable workflow run](../feature/2026-08-10-durable-workflow-runs-in-chat.zh.md)所确定的父 Session 记录决策。process-global workflow 事件没有父 Session identity，因此面板不消费它们。新 session 清空该投影，resume 在 surface adoption 前重放目标历史。

## 考虑过的替代方案

**Resume 或 fork 复用当前 surface selection。** 否决，因为当前显示的 session 不是另一份日志或 seed 边界的权威来源，可能让下一次请求静默使用错误的 provider、model 或 effort。

**使用 process-global workflow 生命周期事件作为行存储。** 否决，因为 `WorkflowRunInfo` 没有父 session 身份，并发 Agent 可以污染当前面板。父 Session 的 durable 事件已经提供所需的所有权隔离。

**把 workflow 状态加入 transcript sidecar。** 否决，因为 workflow 记录是规模很小的独立投影；耦合到 fold 缓存 schema 会增加迁移与失效工作，却不会改善所有权或 replay 语义。

## 后果

目标 session 历史、model 路由、reasoning 元数据、jobs 可见性与 workflow 行现在随 surface swap 一起更新，不改变 core API 或 session format。路由解析、准备或 replay 失败会 dispose replacement，同时旧 surface 保持订阅。临时 process-global workflow phase 与 log 文本无法证明父 Session 所有权，因此有意排除。没有 preset roster 的部署和 legacy 日志仍使用当前默认路由，而已有的 preset 与 request-header 数据在存在时保持权威。

## 测试

纯逻辑测试覆盖 canonical 最新 header 与 legacy fallback selection、owner-scoped jobs 投影及耗时、durable workflow 生命周期折叠、乱序 delivery、包含碰撞 subagent run id 的精确 Session 隔离，以及 session reset/replay。整装测试会创建并立即读取默认与切换后的 fork artifact，验证 mounted composition 和 durable metadata，让 resume 后的真实请求继续使用目标 provider/model/effort，在发布前拒绝已退役的记录 route，执行真实 JobRegistry owner 与通知路径，证明两个真实 Agent workflow stream 会共享 process-global lifecycle 但只有当前 Session 进入投影，恢复持久化 workflow 历史，并验证取消、preset 及 replay 失败都保留旧 Agent。完整 TUI 测试套件均针对源码 TUI 运行，没有修改 harness 包。
