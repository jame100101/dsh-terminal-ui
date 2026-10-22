# 插件架构

[English](architecture.md) | 中文

## 概述

本仓库是独立的 out-of-tree plugin 仓库，负责终端界面。官方 `@deepseek-ai/dsh@0.2.1-rc.2` 负责 Agent、工具、presets、会话持久化、jobs 和 workflows。

## 组合方式

官方 dsh 通过公开 Harness/Cordis API 加载插件。Harness adapter 驱动 TUI 状态与投影，交给 React/Ink 前端渲染。bundle patch 选择 TUI profile 组合；可选的薄 launcher 将参数转交官方 dsh。

本地只有 TUI 实现与 launcher/打包两个 workspace。Harness 包使用固定 npm 开发依赖和生产 peerDependencies。tarball 仅内嵌 patched Ink，其 React 依赖按常规方式安装，让前端与 Ink 共享同一个 React runtime。

## 开发

`pnpm build:lib:host` 检查类型并打包 TUI，Harness 导入保持外置。`pnpm build:lib:client` 检查完整 TUI 声明上下文，并将 React/Ink 前端构建到不发布的验证目录。这里没有 Harness Web client 构建。`pnpm typecheck` 检查生产 TypeScript；Vitest 执行所有 TUI 与 launcher 夹具。

Vitest 在单文件转译前，通过 TypeScript checker 解析公开声明中的 const enum。这遵循正常 TypeScript 内联语义，不添加 runtime shim，也不复制枚举实现。测试通过 package exports 加载官方 CLI 与 base patch，使用公开 profile 初始化 API，并显式刷写持久化夹具。

## 维护

本仓库不 vendoring 或同步完整 Harness 源码。后续 Harness 更新采用 dependency upgrade 与 adapter compatibility 验证，而非 upstream merge。[依赖审计](dependency-audit.json) 记录基线所有 package 与目录分类。运行时归属与包边界见上文。

## 精确开发版本兼容说明

Adapter 仅接收当前 Agent 的 public `agent/assistant-stream` 帧。持久 assistant 结算替换临时文本，并展开内嵌 stream 保证回放一致；临时帧不会写入 Session 存储。嵌套工具卡使用当前 `tool/ptc-dispatch*` 事件，projection cache 版本随语义变更更新。

升级 Harness 时重新解析开发锁文件，包括自动安装的 peer。仓库闭包检查拒绝精确 rc.2 依赖图以外的 Harness 版本，避免 JSONL 后端绑定旧 persistence API。欢迎鲸鱼使用静态抗锯齿蓝白像素；单格 `❯` 提示符及统计去重不改变输入处理。

官方 CLI 兼容版本为 `@deepseek-ai/dsh@0.2.1-rc.2`。其 npm 范围当前选择 Harness 子包 `0.2.1-rc.2`，开发依赖与插件 peer 对齐此依赖图。冷 fork 读取使用 public `observeSession`，复制不可变快照后释放 lease，避开 `readSession` 的 seed 构造路径。官方 `minimal` preset 提供持久 shell 与图片读取，宿主提供会话目录控制，standard 保留完整文件工具。

欢迎鲸鱼保留 52 × 20 半格画布和透明轮廓；实心单元格同时绘制相同前景色和背景色，覆盖 macOS 字体行间隙。macOS 滚动条在原有绝对定位列采用同样处理，两种主题均使用较暗轨道；Windows/Linux 保留原有低亮度轨道及主题滑块颜色。图案仍为预计算，不增加计时器、图像依赖或整屏重绘。

macOS 的 Ink 输出器将带背景色的滚动条标记输出为背景色空格，消除块状字形的边缘溢出。原有绝对列、颜色样式和几何位置保持不变。Windows/Linux 保留逐字节一致的块状字形输出，macOS 无颜色模式保留可见的块状回退。平台参数化测试覆盖安装后的输出器，PTY 测试验证填色单元格和空白安全列。

## Harness rc.2 integration / 宿主适配

精确开发目标为 `0.2.1-rc.2`，Cordis 为 `4.0.5`。npm 默认渠道是单独的、尚未验证目标。预设声明来自公开的 MIT 授权 `@deepseek-ai/dsh-web-app/presets/*.patch.yml` exports。打包仅复制声明式 YAML，并禁用需要浏览器 Connection 服务的 `tool-schedule`；终端组合不支持调度。运行时实现始终保留外部依赖。registry 原子选择预设，Jobs 以 Session ID 隔离。设置使用插件 Config 的 volatile 引用及官方 profile 编辑器。会话目录通过 `workingDirectory.set` 修改，不改变进程目录或沙箱根。删除上游已移除的空运行时 invariant companion，保留生命周期与隔离回归断言。

安装使用未发布的本地 tarball 与临时宿主；[验收和回退步骤](../README.zh.md#isolated-development)不会升级全局安装或生产 home。npm 已发布的 `0.2.2` 是不同产物，不支持据此推断 alpha 兼容。

第二阶段 UI 只导入纯 `harness/adapter.ts` 契约；递归测试拒绝 UI 值依赖图中的官方运行时导入。终端外观与键位、执行模式独立；新主题保留原生光标定位及共享命中几何，旧外观配置在新版中映射到 `claude-terminal-dark`，不改写旧安装；新版不提供 classic 选项。

会话列表最多缓存50个独立标题结果，以官方持久化服务 identity、Session ID 和元数据列表中的不透明 revision 为键。只有修订未变的冷会话可以复用结果；存活会话、缺失元数据、读取失败和更换后的后端均需重新读取官方标题。缓存不持有事件日志或 observation lease，也不写持久化数据；取消与界面归属检查继续阻止被替代的请求发布结果。
