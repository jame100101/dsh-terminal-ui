# `@deepseek-ai/dsh-tui-app`

[English](README.md) | 中文

dsh 的终端表层 bundle。其 patch layer 叠加在 [`dsh-base`](../base/README.zh.md) 上，只挂载一行：进程内的 [`@deepseek-ai/dsh-tui`](../../tui/tui/README.zh.md) 表层。使用 `dsh --profile tui` 启动；随附模板会组合 `dsh-base` 与本 bundle。

与 `dsh-web-app` 一样，本 bundle 禁用由 agent preset 所属的 base 模型可见行，同时把共享注册表、provider、持久化、策略、token meter、`code-runtime` 和 `cordis-host-runner` 保留在宿主面。每个新 TUI 会话都会解析 roster 默认项或延续已记录的选择，挂载该 preset，并把实际 id 写入 session header。

## Model Experience

### 共享编程 persona

#### What the model sees

与 `headless` 和 `web` bundle 写入共享 `system-prompt` 行的编程 persona 段落相同。本 bundle 不增加 prompt section、工具或动态 context。

#### Token effect

除与其他已交付表层逐字节相同的 persona 行外，没有额外影响。

#### KV Cache effect

没有额外影响。persona 是位于 system prompt 前部的进程级常量，因此不会在轮次之间使 prompt cache 失效，与 `dsh-web-app` 一致。

## Known Limitations and Deferred Work

- **终端渲染依赖 emulator 行为**：本包固定使用已测试的 Ink 与 PTY 修复；Linux、macOS 和 Windows 的原生 smoke 仍属于发布验证。
- **图片预览以元数据为主**：表层显示待发送图片的名称、尺寸和字节数，不会在 Ink repaint 生命周期之外写入终端图形协议。
