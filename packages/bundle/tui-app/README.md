# `@deepseek-ai/dsh-tui-app`

English | [中文](README.zh.md)

The dsh terminal-surface bundle. Its patch layer rides over [`dsh-base`](../base/README.md) and mounts exactly one row: the in-process [`@deepseek-ai/dsh-tui`](../../tui/tui/README.md) surface. Run with `dsh --profile tui` (the shipped template stacks `dsh-base` + this bundle).

Like `dsh-web-app`, this bundle disables the base model-facing rows owned by agent presets while retaining shared registries, providers, persistence, policy, token metering, `code-runtime`, and `cordis-host-runner` on the host plane. Every new TUI session resolves the roster default or continues its recorded selection, mounts that preset, and records the actual id in its session header.

## Model Experience

### Shared coding persona

#### What the model sees

The same coding persona paragraph the `headless` and `web` bundles set on the shared `system-prompt` row. This bundle adds no prompt section, no tool, and no dynamic context.

#### Token effect

None beyond the persona line, which is byte-identical to the other shipped surfaces.

#### KV Cache effect

None. The persona is a process-level constant near the system-prompt head, so it does not invalidate the prompt cache across turns (same posture as `dsh-web-app`).

## Known Limitations and Deferred Work

- **Terminal rendering depends on emulator behavior**: the package pins the tested Ink and PTY fixes; native smoke testing remains part of Linux, macOS, and Windows release validation.
- **Image preview is metadata-first**: the surface reports the pending image name, dimensions, and byte count without writing a terminal graphics protocol outside Ink's repaint lifecycle.
