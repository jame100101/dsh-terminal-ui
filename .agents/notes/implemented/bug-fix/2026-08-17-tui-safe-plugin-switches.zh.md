# Agent Note: TUI 直接控件与只读插件清单

Status: implemented

[English](2026-08-17-tui-safe-plugin-switches.md) | 中文

下文的插件清单决定已由 [TUI profile 插件事务式切换](../feature/2026-08-31-tui-profile-plugin-toggles.zh.md)部分取代。拒绝无保护全条目开关的结论继续有效；Thinking、命令选项与 locale 决定仍全部有效。

## 问题

TUI 插件页把 Loader 条目暴露成即时开关，但 surface 不能证明所有组合依赖，也不能保留每个条件 patch 表达式。一次写入可能使必要消费方进入 pending 状态，导致下一次严格启动拒绝该 profile。把页面过滤为少量看似独立的叶级条目还会隐藏大部分组合，同时继续暗示进程内插件变更是可靠操作。与此同时，`/effort` 虽然出现在 slash palette 中，仍要求用户记忆并输入自由文本参数。

转录折叠控件绑定在空闲 Tab 选择模式上：方向键移动选中消息，Space 展开，`g`/`b` 评分助手消息。该模式与 composer 输入竞争，还会给 Thinking 行建立局部覆盖，但页头与设置页把 Thinking 描述为一个全局显示偏好。

## 决定

插件页是 Loader 插件条目的完整只读投影。页面显示启用、禁用、已加载和未加载状态，但不提供 Enter 动作、配置编辑快捷键、patch 写入或乐观状态。页脚把 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 标为启停配置来源，并说明用户可以直接编辑，也可以让 Agent 修改该文件。Include/group 结构行仍会排除，因为它们是组合容器而不是插件条目。这样把组合变更留在显式配置流程中，不修改 Loader 或 Harness 启动语义。

转录行只在拥有末尾 `▶` 或 `▼` 的换行行上携带展开元数据。鼠标命中测试使用与渲染相同的底部对齐、滚动偏移感知 viewport 计算。Context、tool 与 retry 箭头切换各自节点。任一 Thinking 箭头都会写入全局 `thinking: collapsed|expanded` 设置，因此所有已结束 Thinking 行与页头的 `thinking on/off` 标签会同步变化。删除空闲 Tab 转录选择以及它的方向键、Space 和 `g`/`b` 绑定；Tab 仍用于 slash palette 与设置分页，Shift+Tab 仍用于权限操作，方向键仍用于 composer 历史输入，Space 仍为草稿输入。

Slash palette 继续为每条命令提供一个可选择的根级行。参数集合有限的命令可以提供嵌套 palette；`/effort` 是首个此类命令，只提供 `off`、`high` 与 `max`。参数为路径、标题或其他自由文本的命令继续使用 composer 补全。

英语模式会翻译所有由 renderer 拥有的面板、转录状态、结构化工具卡、通知、帮助和线性 fallback 标签。用户、模型、工具输出、workflow 日志、标题与目标内容属于原始内容，不作为翻译目标。

## 已考虑的替代方案

**保留经过筛选的进程内开关。**不采用，因为依赖检查不能证明未声明的行为依赖，也不能安全覆盖每个条件 patch 层，而且筛选会隐藏大部分组合。

**把受保护提供方显示为锁定开关，并保留可变叶级项。**不采用，因为相同开关样式会产生两套不同交互约定，仍会鼓励用户从不完整的 Loader 视图修改配置。

**在直接控件之外保留 Thinking 逐行覆盖或键盘选择。**不采用，因为逐行覆盖与持久化全局设置冲突，而选择模式会为第二套展开权威占用普通 composer 按键。

**把每条 slash 命令的参数都表示成预定义选项。**不采用，因为路径、标题、筛选条件和扩展贡献的命令没有有限清单。

## 后果

插件页重新显示完整插件清单，同时不再暗示 TUI 能安全修改组合。页面不会写 profile，也不会创建 pending 依赖树。配置仍可通过 profile patch 文件完成，也可以让 Agent 编辑同一个显式来源。

Thinking 展开状态现在在所有行、页头与设置页之间只有一个持久化权威。非 Thinking 行通过直接点击箭头保留独立展开。删除转录键盘选择后，TUI 的消息评分快捷键也一并移除，已有 feedback 展示与存储集成保持不变。嵌套选项机制可复用于未来的有限命令参数，而自由文本命令行为与命令 dispatch 保持不变。Agent Loop、session protocol、model request 与非 TUI surface 行为均未改变。

Locale 变更现在同时覆盖 Ink 与非 TTY fallback，并保留原始内容文本。英语回归 fixture 只对由 renderer 生成且使用纯英语输入数据的文案检查汉字残留。
