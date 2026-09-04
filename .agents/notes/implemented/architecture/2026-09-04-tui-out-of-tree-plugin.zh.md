# Agent Note: 双路径把 TUI 抽成 out-of-tree 插件

Status: implemented

[English](2026-09-04-tui-out-of-tree-plugin.md) | 中文

## Problem

已发布的 `dsh-tui` 0.1.0 包装器会复制整份 Harness runtime。上游 Harness 每次变更都要做一次完整源码同步。官方 dsh 已经能把声明了 `dsh.bundle` 的包装进 profile。TUI 还没有插件模式的打包或启动路径，生命周期调用也散落在 surface 模块里。

## Decision

在插件模式达到 parity 之前，保留 bundled runtime 和 `assemble-runtime`。在 `packages/tui/tui/src/harness/` 增加 Harness 集成缝，重导出已有的 preset、fork、resume、jobs、workflow 模块，这样 rendering、fold 和 projection sidecar 不会再长出新的 Agent/Session 调用。再提供第二个 assembler `assemble-plugin`，它会暂存 `@jame100101/dsh-tui@0.2.0-rc.1`：TUI 的 `lib/`、launcher bin、插件 `cordis.patch.yml`（TUI 行名为 `@jame100101/dsh-tui`），以及打过补丁的 Ink。插件模式启动（`DSH_TUI_MODE=plugin`，或 bundled 解析失败后的回退）从 `DSH_BIN` 或 PATH 拉起兼容的官方 dsh（`0.1.2-rc.1`），并且从不安装软件包。历史 `0.1.0` 仍是 bundled 的 npm 发行版。

## Alternatives considered

### Why not delete the bundled runtime in the same change?

插件模式仍需要在一份不带 `PROFILE_TEMPLATES.tui` 的 dsh 上做 clean-profile 安装。在那条路径被证明之前就删掉 `runtime/`，会弄坏 0.1 launcher。

### Why not a generic backend interface?

只有一个 backend。抽象 provider、RPC 或远程协议会把 session history 再拷一份经过额外缓冲区，并危及长会话 fold 路径。

### Why vendor Ink in the plugin pack?

全屏终端坐标补丁不在 registry 的 Ink 上。profile 里 `npm install` 原版 `ink@7.1.1` 会丢掉该补丁。插件 tarball 用 `file:./vendor/ink` 携带 `vendor/ink`。

## Consequences

官方 dsh 0.1.2-rc.1 上的 `dsh plugin --profile tui add` 是 0.2 的安装方式。bundled 的 `assemble-runtime` 仍在。在这条安装路径达到 parity、并在后续变更中删除 bundled closure 之前，插件抽离不算完成。

## Testing

`packages/tui/tui/tests/harness-seam.spec.ts`、`apps/tui-cli/tests/assemble-plugin.spec.ts` 以及现有的 preset/jobs/workflow 套件覆盖该缝、插件打包布局和 #33–#36。插件模式启动对 `DSH_BIN` 和版本拒绝做了单元测试。
