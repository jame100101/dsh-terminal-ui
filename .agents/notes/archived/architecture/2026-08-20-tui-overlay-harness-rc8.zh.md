# Agent Note: 用覆盖而不是 git merge 把 harness 0.1.0-rc.8 接到 TUI fork

Status: implemented
Archived: 2026-08-22

[English](2026-08-20-tui-overlay-harness-rc8.md) | 中文

## Problem

TUI 产品是一棵完整 harness 树加上 TUI 独有层（`packages/tui`、`packages/bundle/tui-app`、`apps/tui-cli`、Ink 补丁）。公开历史被重写过，所以对 `deepseek-ai/deepseek-harness` 做 `git merge` 没有可用的 merge-base。停在 0.1.0-rc.5 会让 TUI 继续用三参数调用 `commands.execute`，丢掉取消流的前缀，并在 rc.8 之后拒绝 `/effort low`。

## Decision

把已经更新的原仓库树（`dsh-v0.1.0-rc.8`，`141eb6fef8`）用 `robocopy /E` 拷到本仓库。禁止 `/MIR` 或 `/PURGE`（会删掉 TUI 层）。禁止拷 `.dsh/`。拷完后还原 TUI 独有路径：`packages/tui`、`packages/bundle/tui-app`、`apps/tui-cli`、`patches/ink@7.1.1.patch`、TUI README 截图、`TUI-WEB-COMPARISON.md`。保留上游的 `node-pty@1.2.0-beta.15` 补丁；丢掉 `node-pty@1.1.0`。把 `dsh-tui` 和 `dsh-tui:assemble-runtime` 加回根 `package.json` 的 scripts。CLI 继续依赖 `@deepseek-ai/dsh-tui-app`，这样 `$DSH_HOME/profiles/node_modules` 会 heal 到工作区 TUI，而不是全局安装的 `@jame100101/dsh-tui`。`PROFILE_TEMPLATES` 包含 `tui`。host typecheck 引用 TUI 包，并排除 `packages/tui/tui/tests/**`，因为该聚合没有 `jsx`。删掉 robocopy 删不掉的 rc.8 之前的 client 包（`schema-form`、`web-react`），以及 `packages/client/web` 里 rc.8 没有的残留文件。

TUI 消费 rc.8，不改 Agent Loop：`commands.execute(agent, line, images, signal)`；`assistant/message.interrupted` 变成可见前缀；user/tool 的 image 块渲染为 `📎` 加文件名；`/effort` 接受 `low`，否则跟 `snapshot.reasoning.levels`。`tui-app` 不挂 experimental Agent Teams。JSONL 会话仍是 `SESSION_FORMAT_VERSION = 0`。schema 15 的 SQLite 会话文件会被拒绝；没有兼容层。

## Alternatives considered

### Why not `git merge` upstream?

TUI 公开基线重写（`4dc33d8`）与 `deepseek-ai/deepseek-harness` 没有 merge-base。merge 会编造历史，而不是重放 rc.8。

### Why not copy only llm / agent-loop?

`commands.execute`、attachments、plan 图片、以及 client 包拆分是一起动的。只拷几个包会让树的其余部分 typecheck 失败。

### Why not keep globally installed `dsh-tui` as the launch path?

`pnpm dsh --profile tui` 通过 `$DSH_HOME/profiles/node_modules` 解析裸插件名。CLI 若不依赖 `dsh-tui-app`，那个 fallback 会一直 junction 到已发布的 runtime，工作区 `lib/` 不会被加载。

## Consequences

产品树的 harness 版本是 0.1.0-rc.8。TUI 独有路径仍在。从这个 checkout 运行 `pnpm dsh --profile tui` 加载工作区 `@deepseek-ai/dsh-tui`。被取消的流保留前缀。斜杠命令可以带上 composer 图片。`/effort low` 是合法参数。旧 JSONL 会话可以恢复；旧 SQLite 会话文件不行。

## Testing

`pnpm exec tsc -b tsconfig.host.json`、`pnpm run typecheck:contracts-ready`、`pnpm run build` 以及 `pnpm exec vitest run packages/tui/tui` 覆盖这次 overlay 和 TUI 消费补丁（`fold.spec.ts` 的 interrupted/image 行，`render-frame.spec.ts` 的 `/effort low`）。
