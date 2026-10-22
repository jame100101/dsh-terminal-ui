# @jame100101/dsh-tui

English | [中文](README.zh.md)

`@jame100101/dsh-tui` adds the React and Ink terminal interface to an official DeepSeek Harness profile. The optional `dsh-tui` command is a thin argument translator for `dsh --profile tui`; session, agent, tool, and persistence services come from the official Harness installation.

## Unpublished development build

This branch targets exact official Harness `0.2.1-rc.2`; the default npm `0.2.0-rc.2` channel is untested. Its unpublished package version is `0.3.0-rc.1`; the published `0.2.2` package targets previous Harness `0.1.5-rc.3` and does not include these changes. Do not use the published npm artifact to evaluate this branch.

Build the local tarball and follow the checkout guide `docs/development-validation.md` to install it in a temporary official host and fresh `DSH_HOME`. No global upgrade or production configuration change is needed. Bundle order is `@deepseek-ai/dsh-base`, then `@jame100101/dsh-tui`. Only patched Ink is bundled; Harness stays external and Ink/TUI share React.

## Thin launcher

The packaged `dsh-tui` bin forwards the existing command grammar to compatible official Harness `0.2.1-rc.2`. It resolves npm global and local `dsh` entries on `PATH`, including POSIX symlinks and Windows command shims, or accepts the official JavaScript entry through `DSH_BIN`. It does not install, upgrade, or modify Harness or the profile. This advanced launcher is available only when an environment deliberately exposes the package bin; installing the plugin globally for that purpose is not recommended because npm installs another Harness and Cordis dependency tree.

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

If no compatible official Harness is present, the launcher names the required package version. Before boot, it resolves the Harness home through the compatible official installation and reports a missing plugin when the profile does not contain it. For this unpublished branch, use the local tarball installation command in the guide even if an older diagnostic suggests an npm package name. After an interactive child exits, it resets mouse tracking, bracketed paste, cursor visibility, the alternate screen, and SGR state.

## Verification

The clean-room verifier installs official Harness outside this repository, creates an isolated `DSH_HOME`, installs the packed plugin, checks package identity and patched Ink resolution, and boots direct dsh plus launcher paths using explicit `DSH_BIN` and npm's PATH entry under a PTY:

```sh
node apps/tui-cli/scripts/verify-official-plugin.mjs apps/tui-cli/jame100101-dsh-tui-0.3.0-rc.1.tgz
```

It leaves the temporary install and `DSH_HOME` in place and prints both paths for inspection.

## Build from source

Development builds may assemble and pack the plugin from a repository checkout:

```sh
npm run dsh-tui:pack-plugin
```
