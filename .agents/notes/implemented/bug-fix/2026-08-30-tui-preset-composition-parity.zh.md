# Agent Note: TUI preset 组成遵循 Web 所有权

Status: implemented

[English](2026-08-30-tui-preset-composition-parity.md) | 中文

## 问题

TUI 暴露了共享的 agent preset 选择器，却保留了 base 的全部 agent-plane 行。启动时还会创建一个既未解析也未挂载 roster 默认项的 agent。因此选择 `minimal` 只改变记录的 id 和 preset scope，base 的 `compact`、`plan`、工具、技能与 prompt 贡献仍然可见。实际组成变成 base agent 加所选 preset，而不是宿主面加一个所选 preset。

TUI 切换路径还会在异步重组之前检查 `turn/start`，却不串行化并发选择。prompt 可能在检查之后、turn 事件出现之前获准进入，使 preset 变更与第一次模型请求发生竞态。

## 决策

TUI bundle 禁用与 Web bundle 相同的 preset-owned base 行。共享注册表、provider、持久化、策略、token meter、code runtime 和 Cordis host runner 继续位于宿主面。一项一致性测试比较两个有界的禁用区段，使任一交互 bundle 的所有权变更都不会静默漂移。

Agent 创建会先解析 `agentPresets.resolve(requestedId)`，再创建 session，把解析出的 id 传给 `mount` 并写入不可变 header。启动解析 roster 默认项；`/new` 延续最新选择事件或 header，没有 metadata 时回退到当前默认项；resume 依次采用最新选择事件、header，以及 metadata 完全缺失的旧 session 所用当前默认项。该回退会记录为选择事件，避免之后默认项变化重新解释已迁移 session。

Preset 切换与 prompt 准入共享同一条按 session promise 队列。空 session 检查在排队后的切换操作内执行。已接受的 prompt 会在自己的排队操作内、下一个切换检查空状态前声明 session 已开始，不依赖 agent-loop 何时发布 `turn/start`；先入队的切换则会在 prompt 前提交。`recompose` 继续作为原子组成操作，TUI 只在它成功后追加 `agent-preset/selected`；拒绝不会改变组成、日志、目录或 current marker。

## 考虑过的替代方案

**选择 `minimal` 后由 renderer 删除过期命令与技能。** 否决，因为命令与技能只是症状；base 工具与 prompt section 仍会到达模型，而且每个新 preset 都需要另一份展示层 denylist。

**每次空 session 选择都重建 agent。** 否决，因为 `AgentPresets.recompose` 已经会先准备目标，再原子重挂既有 agent scope。重建 agent 会改变 session identity，并复制 Web 没有采用的生命周期逻辑。

**只检查持久化的 `turn/start` 事件。** 否决，因为 prompt 准入与事件发布是两个操作。共用队列并记录准入声明可以保持用户顺序，同时不改 agent-loop 或 session 事件格式。

## 后果

Current marker、session 记录、scope 目录、prompt assembly 与有效工具都来自同一个已挂载 preset。standard 切到 minimal 会移除 preset-owned 命令和本地技能发现，切回后恢复；code 与 Cordis 选择会启用其实际模型可见能力。没有 preset roster 的部署仍可创建 metadata-free agent，但会拒绝恢复一个记录了无法重建 preset 的 session。

该队列是进程内状态，因为它保护 live TUI 操作；持久化权威仍是已记录的选择。进程若恰好在 recompose 成功与紧随其后的 append 之间终止，会具有与 Web handler 相同的窄崩溃窗口；普通拒绝不会留下记录。

## 测试

聚焦 TUI 生命周期测试覆盖默认解析、无 roster 处理、队列顺序、失败后继续、prompt 先于切换时的锁定、切换先于 prompt 的顺序，以及持久化会话锁。整装 TUI 组成测试启动真实 base 与 TUI bundle patch，验证默认 header 与 mount identity，演练 standard → minimal → standard 的命令、技能、工具与 prompt assembly，检查 code 与 Cordis 能力，验证无效 preset 不产生修改，串行化真实快速重组，把当前 preset 带入新 session，并恢复带记录和无 metadata 的 session。Bundle 一致性测试比较 Web 与 TUI 的 preset-owned 禁用行，并固定 TUI 专用宿主 runtime。

## Related

Preset scope 所有权来自[按 session 的 agent preset](../architecture/2026-08-03-per-session-agent-presets.zh.md)和[preset 之后的宿主面所有权](../architecture/2026-08-10-host-plane-ownership-after-presets.zh.md)。提交切换后的目录刷新仍由[斜杠目录跟随空会话的 preset 切换](2026-08-10-slash-catalog-follows-preset-switch.zh.md)负责。
