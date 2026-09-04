# @jame100101/dsh-tui

[English](README.md) | 中文

`@jame100101/dsh-tui` 为官方 DeepSeek Harness profile 添加 React 和 Ink 终端界面。可选的 `dsh-tui` 命令只把参数转换后交给 `dsh --profile tui`；会话、agent、工具和持久化服务来自官方 Harness 安装。

## 版本线

- `0.1.x` 是旧版独立包。已发布的 `0.1.0` tarball 包含 bundled Harness runtime。
- `0.2.x` 是 out-of-tree 插件版本线。`0.2.0-rc.1` 使用 `@deepseek-ai/dsh@0.1.2-rc.1`，当前尚未发布。

## 安装 0.2 release candidate

从当前 checkout 构建并打包插件，然后把 tarball 安装到新的或已有的 `tui` profile：

```sh
npm run dsh-tui:pack-plugin
npm install -g @deepseek-ai/dsh@0.1.2-rc.1
dsh plugin --profile tui add ./apps/tui-cli/jame100101-dsh-tui-0.2.0-rc.1.tgz
dsh --profile tui
```

首次安装插件时会创建 custom profile，并按以下顺序加载 bundle：

```text
@deepseek-ai/dsh-base
@jame100101/dsh-tui
```

插件包包含全屏渲染器使用的 patched Ink。Harness 包从官方 `dsh` 安装解析，TUI 和 Ink 解析到同一个 React runtime。

## Thin launcher

包内的 `dsh-tui` bin 把原有命令参数转发给兼容的官方 Harness `0.1.2-rc.1`。它能从 `PATH` 解析 npm global 和 local `dsh` entry，包括 POSIX symlink 与 Windows command shim，也可通过 `DSH_BIN` 指定官方 JavaScript entry。它不会安装、升级或修改 Harness 或 profile。

```text
dsh-tui                          interactive TUI, new session
dsh-tui "fix the failing test"   interactive TUI, submits the task on boot
dsh-tui -c                       resume the most recently used session from this directory
dsh-tui -r                       interactive session picker
dsh-tui -r <session>             resume by id, id prefix, or title
dsh-tui -c --fork-session        fork the resumed session, then switch to it
dsh-tui -p "run the tests"       one-shot: print the assistant result and exit
dsh-tui -c -p "keep going"       resume, then run one task non-interactively
```

退出码为：成功或 official Harness 收到 SIGTERM 后的 supervisor-stop 结果 `0`、执行失败 `1`、用法错误 `2`、SIGINT `130`。SIGTERM 保持为 `0`，因为 official Harness 在所有 application surface 上都把它视为普通的 supervised shutdown。`--print` 把助手结果写到 stdout，把诊断写到 stderr。

缺少兼容的官方 Harness 时，launcher 会指出所需包版本。启动前，它通过兼容的官方安装解析 Harness home；如果 `tui` profile 不含插件，就会提示运行 `dsh plugin --profile tui add @jame100101/dsh-tui`。交互 child 退出后，它会复位 mouse tracking、bracketed paste、光标可见性、alternate screen 和 SGR 状态。

## 验证

Clean-room verifier 会在仓库外安装官方 Harness、创建隔离的 `DSH_HOME`、安装 packed plugin、检查包 identity 和 patched Ink 解析，并在 PTY 中分别通过 direct dsh、显式 `DSH_BIN` launcher 和 npm PATH entry launcher 启动：

```sh
node apps/tui-cli/scripts/verify-official-plugin.mjs ./jame100101-dsh-tui-0.2.0-rc.1.tgz
```

验证器会保留临时安装和 `DSH_HOME`，并输出两个路径供检查。
