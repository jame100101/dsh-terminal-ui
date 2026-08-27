# @jame100101/dsh-tui

English | [中文](README.zh.md)

`dsh-tui` — a thin, Claude Code-style command line over the DeepSeek Harness
terminal surface. It boots the TUI profile with a small user-facing flag
grammar; all sessions, agents, and rendering stay in the bundled runtime.

> **Release Candidate** — `0.1.0-rc.11`, published on npm under the `rc`
> dist-tag. Clean-room installation verified on Windows, macOS, and Linux.

## Install

```text
npm install -g @jame100101/dsh-tui@rc
```

(or `npm install -g @jame100101/dsh-tui@0.1.0-rc.11` to pin the version)

The package ships the built dsh runtime inside `runtime/`, so the global
install needs no other DeepSeek Harness package — external dependencies
install from the npm registry automatically. First boot initializes the
`tui` profile under `$DSH_HOME` on its own.

## Usage

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

Exit codes: `0` success, `1` execution failure, `2` usage error, `130`
SIGINT. `--print` output goes to stdout (assistant result only); diagnostics
go to stderr.

`-c` uses TUI foreground activity rather than session creation order. The bounded index lives at `$DSH_HOME/tui/session-recency.json`; initial use in a directory falls back to the newest top-level session, while untouched subagent sessions stay out of that migration fallback.

The wrapper resolves the bundled launcher bin, spawns it with inherited
stdio, and passes the child's exit code through — it never captures output,
queries sessions, or renders anything itself.
