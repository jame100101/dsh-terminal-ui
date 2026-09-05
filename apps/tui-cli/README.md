# @jame100101/dsh-tui

English | [中文](README.zh.md)

`@jame100101/dsh-tui` adds the React and Ink terminal interface to an official DeepSeek Harness profile. The optional `dsh-tui` command is a thin argument translator for `dsh --profile tui`; session, agent, tool, and persistence services come from the official Harness installation.

## Version lines

- `0.1.x` is the legacy standalone package. The published `0.1.0` tarball contains a bundled Harness runtime.
- `0.2.x` is the out-of-tree plugin line. `0.2.0-rc.2` requires and is tested with `@deepseek-ai/dsh@0.1.2-rc.1`.

## Install the 0.2 release candidate

Install the compatible official Harness, add the published plugin to a fresh or existing `tui` profile, and launch that profile:

```sh
npm install -g @deepseek-ai/dsh@0.1.2-rc.1
dsh plugin --profile tui add @jame100101/dsh-tui@0.2.0-rc.2
dsh --profile tui
```

The first plugin installation creates the custom profile with these ordered bundles:

```text
@deepseek-ai/dsh-base
@jame100101/dsh-tui
```

The plugin package carries the patched Ink build used by the fullscreen renderer. Harness packages resolve from the official `dsh` installation, and the TUI and Ink resolve one React runtime.

The plugin manager installs `dsh-tui` in the profile-local `node_modules/.bin` directory and does not add it to the shell `PATH`. The canonical launch command is `dsh --profile tui`.

## Thin launcher

The packaged `dsh-tui` bin forwards the existing command grammar to compatible official Harness `0.1.2-rc.1`. It resolves npm global and local `dsh` entries on `PATH`, including POSIX symlinks and Windows command shims, or accepts the official JavaScript entry through `DSH_BIN`. It does not install, upgrade, or modify Harness or the profile. This advanced launcher is available only when an environment deliberately exposes the package bin; installing the plugin globally for that purpose is not recommended because npm installs another Harness and Cordis dependency tree.

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

Exit codes are `0` for success or the official Harness supervisor-stop result from SIGTERM, `1` for an execution failure, `2` for a usage error, and `130` for SIGINT. SIGTERM remains `0` because official Harness treats it as an ordinary supervised shutdown on every application surface. `--print` writes the assistant result to stdout and diagnostics to stderr.

If no compatible official Harness is present, the launcher names the required package version. Before boot, it resolves the Harness home through the compatible official installation and reports `dsh plugin --profile tui add @jame100101/dsh-tui` when the `tui` profile does not contain the plugin. After an interactive child exits, it resets mouse tracking, bracketed paste, cursor visibility, the alternate screen, and SGR state.

## Verification

The clean-room verifier installs official Harness outside this repository, creates an isolated `DSH_HOME`, installs the packed plugin, checks package identity and patched Ink resolution, and boots direct dsh plus launcher paths using explicit `DSH_BIN` and npm's PATH entry under a PTY:

```sh
node apps/tui-cli/scripts/verify-official-plugin.mjs ./jame100101-dsh-tui-0.2.0-rc.2.tgz
```

It leaves the temporary install and `DSH_HOME` in place and prints both paths for inspection.

## Build from source

Development builds may assemble and pack the plugin from a repository checkout:

```sh
npm run dsh-tui:pack-plugin
```
