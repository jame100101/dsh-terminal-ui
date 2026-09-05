# 插件架构

[English](architecture.md) | 中文

## 概述

本仓库是独立的 out-of-tree plugin 仓库，负责终端界面。官方 `@deepseek-ai/dsh@0.1.2-rc.1` 负责 Agent、工具、presets、会话持久化、jobs 和 workflows。

## 组合方式

官方 dsh 通过公开 Harness/Cordis API 加载插件。Harness adapter 驱动 TUI 状态与投影，交给 React/Ink 前端渲染。bundle patch 选择 TUI profile 组合；可选的薄 launcher 将参数转交官方 dsh。

本地只有 TUI 实现与 launcher/打包两个 workspace。Harness 包使用固定 npm 开发依赖和生产 peerDependencies。tarball 仅内嵌 patched Ink，其 React 依赖按常规方式安装，让前端与 Ink 共享同一个 React runtime。

## 开发

`pnpm build:lib:host` 检查类型并打包 TUI，Harness 导入保持外置。`pnpm build:lib:client` 检查完整 TUI 声明上下文，并将 React/Ink 前端构建到不发布的验证目录。这里没有 Harness Web client 构建。`pnpm typecheck` 检查生产 TypeScript；Vitest 执行所有 TUI 与 launcher 夹具。

Vitest 在单文件转译前，通过 TypeScript checker 解析公开声明中的 const enum。这遵循正常 TypeScript 内联语义，不添加 runtime shim，也不复制枚举实现。测试通过 package exports 加载官方 CLI 与 base patch，使用公开 profile 初始化 API，并显式刷写持久化夹具。

## 维护

本仓库不 vendoring 或同步完整 Harness 源码。后续 Harness 更新采用 dependency upgrade 与 adapter compatibility 验证，而非 upstream merge。[依赖审计](dependency-audit.json) 记录基线所有 package 与目录分类。[提取决策](../.agents/notes/implemented/architecture/2026-09-05-standalone-plugin-repo.zh.md) 说明取舍。
