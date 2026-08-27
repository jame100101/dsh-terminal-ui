# Agent Note：TUI continue 按前台会话近期度选择

状态：已实现

[English](2026-08-27-tui-continue-session-recency.md) | 中文

## 问题

`dsh-tui -c` 原来按 `SessionHeader.createdAt` 选择当前工作目录中的持久化会话。重新打开较早创建的对话后，它不会成为下一次 continue 的目标；新持久化的后台 subagent 还可能排到用户一直在前台使用的对话之前。launcher 与内层参数解析已经正确传递 `--continue`，缺少的是 TUI 使用顺序。

## 决定

TUI 在 `$DSH_HOME/tui/session-recency.json` 拥有一个有界导航 sidecar。前台导航属于表层状态，不进入模型请求，因此它与权威 session log 分开。每条记录用 session id、`createdAt` 和规范化的创建 cwd 标识一个精确会话生命周期，再保存从墙钟时间派生且单调递增的 `lastUsedAt`。插件设置 `sessionRecencyMaxEntries` 控制上限，默认保留 1,000 条。

TUI 在显式恢复成功、用户消息获准提交或 Host 命令被接受后记录使用时间。后台 session event、流式 chunk、工具进度、todo/goal 变化和 subagent 创建都不会更新索引。进程内写入排在同一条 Promise 队列上；跨进程 writer 使用 `withFileLock`，持锁重新读取、保留最新的有界集合，再通过 `writeFileAtomic` 发布。读取不加锁。格式损坏的 sidecar 会记录诊断且不提供排序证据，并在下一次成功写入时重建；sidecar 故障不会回滚已经完成的前台操作。

`--continue` 先从权威 corpus 中筛出已持久化、非 live 且规范化 cwd 等于当前目录的会话。具有精确生命周期记录的候选按 `lastUsedAt` 排序，再用创建时间与 id 作确定性决胜。某个目录尚无匹配记录时，迁移逻辑按创建时间选择最新的顶层会话。尚未打开过的 `origin: 'subagent'` 会话不参加该回退；显式恢复它以后会写入前台记录，之后即可成为 continue 目标。

## 考虑过的方案

**把可变使用时间加入 `SessionHeader`、session event 或持久化 schema。** 前台导航既不是耐久对话内容，也不是模型可见状态。把它放进 Harness persistence 会为了一个 TUI 专属事实扩大所有 backend 与 replay 表面。

**使用最新 session event 或工件修改时间。** 后台工具、goal round、subagent、持久化修复和无关文件写入都可能推进这些时间，却没有发生前台选择。它们衡量的是活动，不是用户最后使用的 TUI 会话。

**继续按创建时间排序，只排除 subagent。** 这会去掉一种错误候选，但用户回到较早对话后仍然会选错。

## 结果

已有安装初始时没有 sidecar，因此每个目录第一次 continue 会得到确定性的“最新顶层会话”迁移结果。之后的恢复会跨 TUI 进程遵循前台使用顺序。删除 sidecar 只会重置这一导航顺序。Agent、session log、provider request、tool dispatch 与 Harness persistence 格式保持原样。

## 测试

`packages/tui/tui/tests/startup.spec.ts` 覆盖前台近期度、精确生命周期与 cwd 匹配、迁移和 subagent 资格。`packages/tui/tui/tests/session-recency.spec.ts` 覆盖文件缺失与损坏、规范化写入、单调 retouch、跨 writer 合并、裁剪及无 cwd header。现有 startup 参数与 launcher 翻译测试继续保证 `-c` 传递与选择策略彼此独立。
