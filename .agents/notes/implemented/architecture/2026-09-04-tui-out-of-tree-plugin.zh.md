# Agent Note: 把 TUI 抽成 out-of-tree 插件

Status: implemented

[English](2026-09-04-tui-out-of-tree-plugin.md) | 中文

## Problem

已发布的 `dsh-tui` 0.1.0 wrapper 会复制整份 Harness runtime，因此每次上游变更都需要完整同步源码。官方 dsh 已能把声明 `dsh.bundle` 的包装进有序 profile layer。TUI 需要独立打包 bundle，同时保持 renderer、fold、viewport、projection sidecar 和 input 架构不变。

## Decision

把 `@jame100101/dsh-tui@0.2.0-rc.1` 打成 official `@deepseek-ai/dsh@0.1.2-rc.1` 的 out-of-tree bundle。它的 patch 在 `@deepseek-ai/dsh-base` 后叠加 TUI composition，launcher 只把参数转换成 `dsh --profile tui`。launcher 从显式 JavaScript `DSH_BIN` 或 PATH 上 npm 的 POSIX symlink 与 Windows shim layout 解析兼容的官方 dsh，通过官方 home-path API 检查 `tui` profile，并且不安装或升级软件包。

Harness lifecycle 调用统一经过 `packages/tui/tui/src/harness/`。现有 preset、fork、resume、jobs 和 workflow 模块继续承担实现；rendering、fold、viewport 和 projection state 保持原有 data path。

通过 `bundledDependencies` 把 patched `ink@7.1.1` 包进 npm tarball。Ink runtime dependency 按普通依赖声明，使 Ink 和 TUI 共用 profile 中的 React。暂存的 Ink build 带有 patch hash marker，可选 runtime diagnostic 从已加载的 plugin process 记录 Harness、Ink 和 React 的解析路径。开发 workspace 保持 private，repository check 把它归类为 staged-release workspace，只有 staged plugin 会生成可发布的 manifest、双语 README、repository metadata 和 Node engine range。

Official clean-room install 证明 profile 初始化、module identity、patched Ink 解析和 PTY boot 后，删除 bundled runtime assembler 和 launcher mode。已发布的 0.1.0 artifact 保持为历史 standalone release。

## Alternatives considered

### Why not retain both launcher modes?

Bundled fallback 会掩盖 official-plugin 安装故障，并保留同步整份仓库的成本。0.2 直接报告官方 dsh 缺失或版本不兼容。

### Why not add a backend abstraction?

插件和官方 profile 在同一个 Cordis process 中运行。RPC 或 provider layer 会增加另一份 session-history 表示，却没有替换真实 backend choice。

### Why not use registry Ink?

Registry Ink 缺少 fullscreen terminal-coordinate patch。npm bundled dependency 会保留 patched package，普通 runtime dependency 则避免产生第二个 React instance。

## Consequences

Production package 只包含 TUI build、双语 package documentation、bundle patch、thin launcher 和 patched Ink。它不包含 Harness source tree、workspace dependency、repository path、`runtime/` 或 `assemble-runtime`。launcher 保留 official dsh 的 process contract：SIGINT 返回 130，SIGTERM 是成功的 supervisor stop 并返回 0。Harness 升级只需调整支持的 package version 并重跑 compatibility test，不再合并 Harness 源码。

## Testing

`apps/tui-cli/scripts/verify-official-plugin.mjs` 会在仓库外安装 official dsh、创建 fresh `DSH_HOME`、安装 packed plugin、检查两个 profile bundle 与 package portability、断言 Harness package path 和 Cordis identity、验证 Ink marker 与共享 React path，并在 PTY 中启动 direct dsh、显式 `DSH_BIN` launcher 和 npm PATH entry launcher。Cross-platform CI 会在 Windows、Linux 和 macOS 上运行该 verifier 与 focused launcher test。TUI composition suite 使用 out-of-tree patch 覆盖 preset、model route、jobs 和 workflow regression。
