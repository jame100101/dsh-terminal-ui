# Agent Note：独立插件仓库

Status: implemented

[English](2026-09-05-standalone-plugin-repo.md) | 中文

## 决策

本仓库仅负责 TUI 实现、adapter、薄 launcher、bundle patch、patched Ink 与对应验证。官方 Harness 0.1.2-rc.1 是 npm 开发依赖与生产 peer。已发布 v0.2.0-rc.1 tag 保持指向 77678ba72876f2dd7d556f5980a974ec1c8623de。

## 原因

保留 upstream 源码会让测试意外验证私有实现，而非已发布 API。固定 npm 导入与公开 package exports 让兼容性问题在删除前显现。保留现有 TUI 源码路径减少无关变动；两个 private workspace 分离实现与待打包目录。

基线依赖审计在删除前分类所有 277 个 package 与 1472 个目录。upstream CLI/core、Python、web/ACP、Cloudflare/E2B/native sandbox、providers、发布工具及其专用夹具和文档不属于本仓库。Git 在基线 commit 中保留其源码与历史决策。既有 out-of-tree 决策继续约束打包与单例行为；本记录取代其中 monorepo CI/build 假设。

## 兼容性夹具

公开 npm 声明中的 const enum 需要先由 TypeScript checker 内联，再交给 Vite 单文件转译。该编译夹具从声明读取数值，不复制 runtime 代码。旧会话夹具追加完整 turn，并通过公开持久化 API 显式 flush 后进行冷恢复。性能夹具通过公开 API 初始化 profile，不依赖本地附带的 TUI 模板。所有原有行为断言保留。

## 验证

仅含保留文件的隔离目录验证 clean install、host/frontend build、生产 typecheck 与全部 TUI/launcher 断言，期间不含 upstream 源码。exact tarball 经过审计，并在独立 clean-room 中用官方 dsh 启动，检查 Cordis、Agent/session/jobs/workflow、patched Ink 与共享 React identity。CI 在 Windows/Linux/macOS 的 Node 22.19 和 24 上重复官方 clean-room。

## 取舍

upstream 文档与完整 Harness CI 由 upstream 维护，不留在插件仓库。Harness 更新采用 dependency upgrade 与 adapter 回归验证，而非源码合并。本次仓库提取不改变运行架构、UI 或已发布 artifact。
