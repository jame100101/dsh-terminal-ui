# Agent Note: TUI 对 Harness 交互的投影

Status: implemented

[English](2026-08-23-tui-harness-interaction-projections.md) | 中文

## Problem

Harness 已经提供 agent scope 的用户 skill、结构化问题批次和工具展示元数据，但终端 surface 没有完整投影这些能力。用户没有有界的终端 skill 目录；`ask_user_question` 会逐页独立提交，而且缺少多选和多行自定义回答；成功的编辑工具也没有紧凑的每轮交付文件摘要。

## Decision

TUI 通过现有所有者投影这些能力，不增加会话事件、协议字段或 Agent Loop 行为。

根斜杠目录只列命令。`/skills` 打开第二级选择器，以每项一行的形式异步列出当前 agent 和 cwd 中允许用户调用的 skill；目录在 `skills/change` 时刷新，并在会话、预设或工作区切换后忽略过期读取。同名时命令优先。选择 skill 只插入字面量 `/name `；现有 skill pre-step 插件仍是识别、加载、注入和记录的唯一所有者。

问题接管区为每个问题累积一项回答，并在最后一项完成后只结算一次 provider。单选、checkbox 多选、自定义文本、Shift+Enter 换行和每项 Escape 跳过都沿用现有 `PendingQuestion` 与回答字段。问题待处理期间，TUI 只保存瞬时导航状态。

fold 按 call id 保存紧凑工具调用展示，直到对应结果到达。成功的 `diff` 展示，或 kind 为 `edit` 的成功 `generic` 展示，会把 `locations` 路径按首次出现顺序加入当前 turn。turn 尾在统计行前绘制一条本地化产出文件行。恢复回放会在 fold 前丰富相同的调用与结果展示，因此实时和恢复后的行一致。失败工具、只读展示和没有 locations 的工具不会贡献路径。

## Alternatives considered

### Why not invoke skills directly from the renderer?

直接调用会重复 pre-step 插件的 scope 检查、调用元数据、耐久上下文注入和命令优先级。插入字面量能让终端继续作为共享行为的客户端。

### Why not answer each question as soon as its page closes?

provider 请求是一个结构化批次。分次调用会改变取消和校验语义，并可能在后续回答尚未存在时提前结算交互。

### Why not treat every tool location as a deliverable?

读取和搜索展示也带 locations。把摘要限制在官方 mutation render intent，可避免把检查过的输入误报为产出文件。

## Consequences

目录发现和会话元数据仍不进入首帧路径。skill 调用、问题结算和模型可见上下文继续由现有 Harness 能力负责。交付文件行是确定性的 transcript 投影，不是新的耐久事实；没有声明 mutation render intent 的工具不会出现在其中。

## Testing

`render-frame.spec.ts` 覆盖二级 skill 发现、命令优先级、选择器单行裁切、面板与输入框行稳定性、包含单选、多选、自定义多行文本与 Escape 跳过的问题批次，以及倒数第 n 条消息评价。`fold.spec.ts` 覆盖成功 mutation 路径去重，以及排除失败或只读工具展示。TUI 包测试会在重复 Ink 全屏 repaint 下执行相同投影。
