# Agent Note: TUI profile 插件事务式切换

Status: implemented

[English](2026-08-31-tui-profile-plugin-toggles.md) | 中文

本决定部分取代 [TUI 直接控件与只读插件清单](../bug-fix/2026-08-17-tui-safe-plugin-switches.zh.md)中的插件清单部分；该 note 的其他决定继续有效。

## 问题

TUI 插件清单会显示 Loader 状态，但修改 profile patch 时必须离开界面。若直接恢复旧版开关，会再次暴露组合容器、不稳定的生成 id、平台条件表达式、承载当前界面的 TUI，以及移除后会使活跃消费方进入 pending 状态的 provider。开关还必须区分持久化文件写入与 Loader 成功激活：如果仅在写入后报告成功，HMR 拒绝候选配置时，界面就会与实际运行组合不一致。

## 决定

标准 `tui` profile 向 TUI 插件提供其受监视 `cordis.patch.yml` 的绝对路径，以及为了保持 Agent preset 所有权而由 profile 管理禁用状态的 host 行 id。plugins 分页按 bare id 合并稳定 Loader 叶级条目，同 id 时优先根 boot Include 行，而非 Agent preset 叶级条目。所有显示行都可选中。`Enter` 仅修改保护集合之外唯一的根 Include 行；preset-only 行、条件 `disabled` 表达式以及当前 TUI 会立即报告固定状态原因，而不是写入无匹配目标的 profile patch。Include 载体、group tree、生成或不安全的 id 仍不进入清单。关闭已启用 provider 前，如果另一个活跃叶级条目注入了该 provider 提供的 service，本次操作会拒绝变更。bundle 测试会确保保护集合与移入 preset 的行完全一致，因此新增的 preset-owned tool 不会悄然成为 host 级开关。

TUI host 会串行执行每次操作。操作取得 profile 文件锁，执行保留注释的逐行编辑，并原子替换文件。一个仅在本次操作期间存在的 Loader listener 会等待所选条目：开启时必须形成 active fiber，关闭时必须消失。由于 watcher 可能在写入方释放文件锁之前就拒绝刚完成 rename 的文件，操作会在原子修改开始前接管 listener rejection。listener 消费 lifecycle dispatch，不轮询，也不安装渲染 timer。HMR 拒绝与超过有界等待时间均视为失败。失败时，只有 compare-and-swap 检查证明没有并发编辑者替换本次写入文本，才恢复完全一致的旧文件。

renderer 把进行中的 id 保存在 ref 中，因此按键重复不会在 React 提交下一帧前排入第二次切换。既有 notice 更新提供进行中与最终反馈；该功能不会新增动画、interval、全 transcript 投影、Agent Loop、session event、model request 或 tool composition 路径。关闭项沿用既有 dim 样式，settings 投影观察到 Loader 已完成切换后才会重新变亮。

## 已考虑的替代方案

**把每个可见 Loader 行都做成开关。**不采用，因为结构行与生成 id 无法标识唯一持久的 patch 目标，条件行属于部署逻辑，而且关闭仍有活跃消费方的 provider 会破坏严格组合。

**写入 patch 后立即报告成功。**不采用，因为文件持久化不能证明 Loader 已接受并激活候选 tree。

**由 renderer 轮询 Loader 状态。**不采用，因为周期 timer 会在空闲时继续重绘 settings surface，而且仍需单独的 HMR 失败通道。

**通过 YAML serializer 往返转换 patch。**不采用，因为 profile patch 可能包含注释和 `!!js` 表达式，修改单行状态时必须保留其原始写法。

## 后果

标准 TUI 可以在不重启的情况下开启或关闭符合条件的 profile 插件。Loader 完成切换后，关闭行会变暗，开启行会变亮。重复 bare id 只产生一个稳定 settings 行。因 profile 所有权、表达式所有权或依赖拓扑不适合进程内变更的行仍然可选中，并在 `Enter` 后于 notice 栏显示固定状态原因。Agent preset 模式继续拥有各自的 tool 组合，不会被 host 级 settings 动作覆盖；preset-only id 会立即返回，而不是等待无关的根 patch 超时。省略 `profilePatchPath` 的自定义嵌入继续提供可选中的只读清单。

该操作只编辑显式 user profile 层，并复用 launcher 既有的 watch/recompose 机制。文件锁与回滚比较会保留并发文件编辑。页面不承诺任意插件组合都可激活：Loader 拒绝时会显示失败，并恢复用户先前的 patch 文本。
