# dsh-tui 与 Web 版功能对比清单

> 生成时间：本文件随 TUI 迭代更新。对比基准：`apps/web` + `packages/client/*`（web-app profile）与 `packages/tui/tui`（tui profile，本仓库 commit `c399b75`「dispose the CURRENT agent on session switches」）。
> 标记说明：✅ 已对齐 · 🟡 部分对齐（能力存在但交互/细节弱于 Web）· ❌ 缺失 · ➕ TUI 独有。

---

## 1. 总览

| 维度 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 会话模型 | 多会话并行，侧栏切换 | 单会话进程级（同一时刻仅一个 live：/new 换新、/sessions 恢复；预设切换为空白会话原地生效——与 Web 同机制） | 🟡 |
| 布局 | 三栏可拖拽（sidebar 56–420 / center ≥640 / details） | 全屏单栏（header / transcript / permission / composer / status） | ❌ |
| 首屏/品牌 | onboarding 流程 + 品牌页 | **宽度安全鲸鱼横幅**：13 行纯 `█ ▓ ▒ ░` 单格字符鲸鱼 + 6 行 3D `DEEPSEEK HARNESS` 标题（`█` 字形 + `░` 阴影）；Cascadia Mono / JetBrains Mono / Consolas 原生字形、无 fallback；窄终端降级为欢迎卡片、绝不折行 | ➕ |
| 终端标签标题 | 浏览器标题 | `🐋 DeepSeek Harness`（OSC 设置，退出时恢复原标题；窄/legacy 终端降级 ✦ 品牌字形） | ➕ |
| 主题 | dark / light（CSS 变量） | dark / light（ANSI 重映射） | ✅ |
| 语言 | zh / en | zh / en（chrome 全部双语；会话日志结构行保持落盘语言） | 🟡 |
| 持久化 | 会话/设置/凭据/反馈/投影全量落盘 | 同 core 落盘（storage-json + settings + credentials + feedback + 会话日志） | ✅ |

## 2. 输入与命令

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 斜杠命令目录 | 命令目录 + 弹窗选择器（`/` 触发） | `/` 调出 palette（命令按 a→z 字母排序），Tab 补全参数；host 命令在 zh 界面显示中文说明 | 🟡 |
| 命令装饰/说明 | 每条命令自定义渲染（CommandNodeView/卡片） | 命令结果渲染为 status 行/command 卡片 | 🟡 |
| `@`/`#` 触发菜单 | @ 文件/会话提及、# 菜单（skill/subagent） | `@` 补全工作区相对路径；无 # 菜单 | 🟡 |
| 输入历史 | 无（浏览器无 shell 历史） | 空草稿时 ↑/↓ 回忆提交历史；有文字时方向键移动光标（含折行） | ➕ |
| busyEnter（运行中 Enter） | 队列/转向 | queue/steer 设置 + Ctrl+Enter steer | ✅ |
| 多行输入 | 文本框换行 | 自动换行（≤5 行）+ Shift+Enter 硬换行 | ✅ |
| 图片附件 | 拖拽/粘贴 + 附件栏 + 缩略图 | /attach 路径添加（png/jpg/gif/webp），📎 dock | 🟡 |
| 剪贴板粘贴 | 支持 | 支持（usePaste） | ✅ |
| 输入大小限制 | 后端限制 | 900KB 前端校验 | ✅ |

## 3. 会话管理

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 会话列表 | 侧栏：搜索/排序/未读 | /sessions：live+持久化 50 条，支持过滤（live 恒为当前 surface 一个） | 🟡 |
| 新建/切换会话 | 点击 | /new、/sessions 恢复（切换销毁旧 agent，恢复可见完整历史） | ✅ |
| 重命名 | 侧栏内联重命名 | /rename | ✅ |
| 分叉 | 侧栏操作 | /fork [seq]（分叉为持久化会话，在 /sessions 中恢复，不产生第二个 live） | 🟡 |
| 归档/删除 | 支持 | 无（core 无删除面） | ❌ |
| 工作区切换 | 工作区浏览器（树、创建/重命名/归档、拖拽） | /workspace <路径> | 🟡 |
| 会话标题自动生成 | title LLM 插件 | 同插件（持久化标题在 /sessions 显示） | ✅ |
| 恢复历史显示 | 点击即见全部历史 | 恢复后从日志重放完整历史 | ✅ |

## 4. 消息与节点渲染

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| Markdown | 完整（代码高亮/链接/图片/表格） | marked 渲染 + GFM 表格网格 + 代码块样式，无语法高亮 | 🟡 |
| 上下文注入行 | 折叠行 + 展开 | 折叠行 + Space 展开 | ✅ |
| Thinking | 折叠/展开 | Thinking 行（旋转字形打头 + 灰度微光渐变）+ 展开 + 0.1s 精度耗时 | ✅ |
| 工具卡片 | 结构化卡片（presentCall/presentResult 渲染意图） | 同一投影引擎的终端卡片，超长截断 | ✅ |
| 命令卡片 | 各命令自定义卡片（compaction 等） | command/run 状态行 | 🟡 |
| 重试行 | 重试条目展示 | ⟳ 折叠行 + 倒计时微光 | ✅ |
| compaction 展示 | CompactionItem/Card 详情 | 实时 compacting 渐变行 + compacted 状态 | 🟡 |
| 回合尾统计 | 回合尾 stats | └ turn N · LLM/工具/TTFT | ✅ |
| deliverables（产出文件） | ProducedFiles 列表 + 点击打开 | 无（未投影 produced-files） | ❌ |
| 消息操作（复制/打开文件） | 复制按钮、打开文件 | 默认拖选自动复制；输入框 TUI 选区；`/copy` 最近回复。打开文件仍无。 | 🟡 |
| 消息反馈 👍/👎 | 悬停操作 + 备注 | 选择消息后 g/b（同 messageFeedback CAS 服务） | 🟡 |
| 图片渲染 | 消息内缩略图 + lightbox | 图片块不渲染（仅文本） | ❌ |
| 轨迹视图 | 时间线分组 + 时长视图 + 预览 | /trajectory 扁平轨迹（蓝=模型/红=工具/青=用户） | 🟡 |

## 5. 交互（审批 / 提问）

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 工具执行审批 | Allow once / Deny 弹层 | takeover 覆盖层：y/Enter 允许、n/Esc 拒绝 | ✅ |
| ask_user | 多选项组件 + 自定义答案 + PlanReviewPanel | takeover：↑↓ 选选项/直接打字自定义答案，逐题 | 🟡 |
| 权限预设编辑 | 每条命令 allow/ask/deny 预设行 | 无预设编辑 UI（写 cordis.yml） | ❌ |

## 6. 面板 / 设置

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 设置入口 | 弹窗，分 General/Models/Plugins/PluginInventory | /settings 五页（Tab 换页：general/models/plugins/inventory/presets） | ✅ |
| Agent 预设 | 设置内预设切换器（空白会话原地切换，开始后锁定） | **presets 页：空白会话 Enter 原地切换（recompose 换组合 + agent-preset/selected 记录，与 Web 同一机制）；会话开始后预设锁定（提示 /new 后切换）；当前项 ● 标记；损坏预设置灰不可选；/presets 直达** | ✅ |
| General | 主题/语言等 | busyEnter/thinking/theme/locale 切换 | 🟡 |
| Models | 模型目录 + 推理等级 + 自定义 provider + API key 引导弹窗 + 模型列表编辑器（增删/容量） | 模型列表 + 适配器推理等级 + 凭据读写（不回显） | 🟡 |
| Plugins 设置 | 每命名空间结构化卡片（agent-loop/bash/shell 等，字段级表单） | 插件配置编辑器：顶层字段（bool 切换 / string/number/secret 编辑） | 🟡 |
| 插件开关 | 无运行时开关 UI | **Enter 切换开关，实时写 cordis.patch.yml，HMR 热生效；热应用落地后 ●/○ 与亮/灰即时翻转（UI 轮询 loader 树直至落地，面板每次打开也刷新）** | ➕ |
| 插件清单 | PluginInventory tab | inventory 页（命名空间/密钥槽/凭据引用/loader 树） | ✅ |
| Jobs | 任务列表操作（顶部栏） | /jobs（Enter 杀任务，每秒轮询） | ✅ |
| Subagents | 目录动作 + 只读子代理会话视图 | /subagents 树（深度缩进、活动状态） | 🟡 |
| Workflows | 运行面板（阶段/成员/每阶段聊天） | /workflows 进度行（阶段/agent 数/日志/错误） | 🟡 |
| Goal | GoalBar（编辑/暂停/恢复/清除） | goal dock + /goal 详情；编辑/暂停/恢复无 UI | 🟡 |
| Plan | Plan chip + 退出按钮 | ◈ plan 状态栏指示（core /plan 命令驱动） | 🟡 |
| 凭据管理 | 设置内表单 | 凭据行 Enter 编辑（值不回显，支持删除） | ✅ |

## 7. 权限（文件策略）

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 会话级 sandbox 模式 | 权限控件切换 | **Shift+Tab 轮换 read-only → workspace-write → danger-full-access**，输入栏上方彩色常驻（白/黄/红）+ 提示 | ➕ |
| 模式持久化 | 随会话日志 | 同（sandbox/mode 事件，恢复会话还原） | ✅ |

## 8. 模型选择与推理等级

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 模型选择 | 下拉目录 + 持久化 | /model → models 页 Enter 选择，持久化 saveSelection | ✅ |
| 推理等级 | 每模型选择器内 effort 控制 | /effort off|high|max + models 页适配器等级列表；状态栏常驻高亮显示当前 effort | 🟡 |
| 自定义 provider/onboarding | 支持 | 无（配置写 yaml） | ❌ |

## 9. 状态栏 / 统计

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| Web stats strip | 轮/步/LLM/工具/TTFT/tok/s/缓存命中/token/上下文占用 | 同组数据底部整行显示；超宽时**整组丢弃（无省略号）** | ✅ |
| 上下文占用实时性 | token-meter contextPressure 投影（compaction 后立即下降） | 同一投影 + 变更流订阅，实时更新 | ✅ |
| effort 显示 | 选择器内 | 状态栏常驻高亮 | ➕ |
| 队列 dock | 输入框上方排队预览 | ⧗ 排队 dock | ✅ |
| todo dock | 计划列表 | todo dock（进行中/待办/已完成计数） | 🟡 |
| goal dock | GoalBar | ◈ goal dock（阶段/round/目标摘要） | ✅ |

## 10. 键盘 / 鼠标

| 功能 | Web | TUI | 状态 |
| --- | --- | --- | --- |
| 滚轮滚动 | 原生滚动 | 转录/面板滚轮（3 行/格） | ✅ |
| 右侧滚动条 | 原生滚动条 | **转录右缘浏览器式滚动条列（█ 滑块 + │ 轨道独立成列，与内容互不干扰）：点击跳转到对应历史位置（2 格点击区），按住拖拽连续滚动** | ➕ |
| 翻页 | 原生 | PgUp/PgDn，End/Ctrl+Home | ✅ |
| 回到底部 | 原生跟随 | 上翻时底部**居中反色悬浮按钮，点击回到底部**（顶栏横幅保留） | ✅ |
| 消息选择 | 点击 | 无 Tab 选中模式；拖选复制；折叠箭头点击展开 | 🟡 |
| 输入历史 | — | ↑/↓（shell 风格） | ➕ |
| 光标/IME | 浏览器 | NativeCursor 锚定 + IME 组合 | ✅ |
| 快捷键 | Ctrl+L 清屏、Ctrl+D 退出等 | 同 | ✅ |

## 11. 性能 / 启动 / 缓存安全

| 项 | 现状 | 说明 |
| --- | --- | --- |
| 启动方式 | `pnpm dsh --profile tui` = tsx 源码启动 ≈ **19.6s** | 慢在 tsx 逐包转译（dump-config 仅 1.1s） |
| 快路径 | `pnpm exec dsh --profile tui` = 构建产物启动 ≈ **2.7s（约 7×）** | 全量 `pnpm run build` 后可用（host face 构建不含部分运行时产物，需全量 build） |
| 首帧优化 | TUI 首帧不再等待模型目录/设置页加载（异步填充，设置页显示加载占位） | 已做 |
| 缓存命中 | TUI 不注册工具/prompt 段/provider，请求信封字节一致 | 缓存安全契约保持；Shift+Tab 与插件开关仅用户主动操作时改变行为（分别写 sandbox/mode 日志事件与 patch 热重载，与 Web 权限控件/手改 yaml 等价） |
| 原仓库 | `D:\deepseek harness\deepseek-harness` 零改动 | git status 0 修改 |

## 12. 缺失清单（按影响排序）

1. **产出文件打开/复制**：composer `@` 已补全工作区相对路径；终端无浏览器打开面，Web chips/会话提及仍缺。
2. **deliverables（回合产出文件）**：Web 的 turn-deliverables 投影未在 TUI 显示。
3. **权限预设编辑器**：per-command allow/ask/deny 行（可映射到 cordis.yml 文本编辑）。
4. **消息内图片渲染**：图片块/lightbox（终端仅可显示占位或六宫格提示）。
5. **工作区浏览器**：树形目录选择/创建/归档（现有 /workspace 路径输入覆盖主要场景）。
6. **侧栏会话管理**：拖拽、未读、归档、删除（rename/fork 已有命令）。
7. **自定义 provider / onboarding / 模型列表编辑**：DeepSeek 引导弹窗、增删模型、容量设置。
8. **插件设置结构化卡片**：每命名空间专表单（现有顶层字段编辑器覆盖大部分）。
9. **轨迹视图分组/时长/预览**：Web 时间线比扁平轨迹丰富。
10. **输入触发菜单（@/#）** 与命令装饰自定义渲染。
11. **多会话并行**：TUI 单会话（进程级架构决定）。
12. **三栏布局/详情面板**：终端单栏。

## 13. TUI 独有（Web 没有）

- **宽度安全鲸鱼横幅**：单格 `█▓▒░` 字符 + 3D 立体标题，原始多行字符串保存、终端 cell 宽度居中、窄屏降级不折行。
- 终端原生：shell 风格输入历史、光标锚定/IME、Ctrl+C 双击退出。
- 终端标签标题设置与退出恢复（🐋 / ✦ 降级）。
- 插件运行时开关（HMR 热生效，Web 需改 yaml 重启）。
- Shift+Tab 文件权限即时轮换 + 彩色常驻指示。
- 状态栏 effort 常驻高亮。
- 上翻历史悬浮回底按钮。
- 转录右缘浏览器式滚动条列（█ 滑块 + │ 轨道独立成列），鼠标点击/拖拽快速跳转历史。
- 线性 fallback（非 TTY 管道模式）。

## 14. 已知限制 / 注意

- 插件开关对**部分重资源适配器**（如 llm-deepseek）的卸载热应用可能较慢（dispose 资源等待）；切换后 UI 会轮询 loader 树，状态翻转落地后行内 ●/○ 与亮/灰立即刷新（上限 60s），机制本身已验证（session-title-llm 全流程 ●→○→● 通过 ConPTY smoke）。
- 曾用旧版 TUI 切换插件可能在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 留下 `- id: include:<x>` 前缀死条目（启动时仅告警、不生效），手动删除即可。
- 会话日志中的结构行（回合尾/plan/goal 状态）保持落盘时语言，不随界面语言切换（重放确定性）。
- 源码启动慢为 tsx 转译成本；推荐 `pnpm exec dsh --profile tui`（构建产物）。
