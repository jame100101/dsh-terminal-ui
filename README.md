# DeepSeek Harness TUI (`dsh-tui`)

English | [中文](README.zh.md)

<p align="center">
  <a href="#quick-start"><img alt="Node 22.19+ / 24+" src="https://img.shields.io/badge/NODE-22.19%2B%20%2F%2024%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"></a>
  <a href="https://www.npmjs.com/package/@jame100101/dsh-tui/v/0.1.0-rc.11"><img alt="npm 0.1.0-rc.11" src="https://img.shields.io/badge/NPM-0.1.0--rc.11-CB3837?style=for-the-badge&logo=npm&logoColor=white"></a>
  <a href="#architecture"><img alt="React 19" src="https://img.shields.io/badge/REACT-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB"></a>
  <a href="#architecture"><img alt="TypeScript" src="https://img.shields.io/badge/TYPESCRIPT-3178C6?style=for-the-badge&logo=typescript&logoColor=white"></a>
  <a href="#architecture"><img alt="Ink 7" src="https://img.shields.io/badge/INK-7-3A3A3A?style=for-the-badge"></a>
  <a href="#key-features"><img alt="Local TUI" src="https://img.shields.io/badge/TUI-REACT%20%7C%20INK-EC4899?style=for-the-badge"></a>
</p>

<p align="center">Local-first · Session persistence · Tool runtime</p>

> 🚀 **Release Candidate `0.1.0-rc.11`** — this is a pre-release and is not stable yet. See [Quick Start](#quick-start).

<p align="center">
  <img src="assets/tui-session-panel.png" alt="dsh-tui Windows startup screenshot" width="46%">
  <img src="assets/tui-session-chat.png" alt="dsh-tui Windows transcript screenshot" width="46%">
</p>
<p align="center">
  <img src="assets/tui-session-ubuntu-startup.png" alt="dsh-tui Ubuntu startup screenshot" width="46%">
  <img src="assets/tui-session-ubuntu-chat.png" alt="dsh-tui Ubuntu chat screenshot" width="46%">
</p>

`dsh-tui` is a **local terminal assistant** for the DeepSeek Harness agent runtime — a Claude Code-style CLI with a React 19 + Ink 7 interface: thinking shimmer, streaming replies, tool cards, permissions, slash-command palette, persistent sessions, and settings panels.

<a id="run"></a>

## Quick Start

### 1. Install Node.js and npm

The package requires the repository's exact engine range: `^22.19.0 || >=24.0.0`. This means Node.js 22.19.0 or newer within Node 22, Node.js 24 or newer, and later releases that satisfy `>=24`. Node 23 and early Node 22 releases are outside the declared range.

npm is normally installed together with the official Node.js distribution; it does not need a separate download. First check your current environment:

```sh
node --version
npm --version
```

Use one of these platform-specific installation paths if either command is missing or the version is outside the supported range.

#### Windows

**Option A — official installer**

Download a current Node.js installer from [nodejs.org](https://nodejs.org/en/download) and choose a release that satisfies Node 22.19+ or Node 24+. The official installer includes npm.

**Option B — winget**

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell or Windows Terminal after installation, then verify:

```powershell
node --version
npm --version
where.exe node
where.exe npm
```

#### macOS

With [Homebrew](https://brew.sh/) installed:

```sh
brew install node
node --version
npm --version
```

If an older Node.js is already installed, upgrade it to a version in `^22.19.0 || >=24.0.0`. Developers who switch between projects can use [nvm](https://github.com/nvm-sh/nvm):

```sh
nvm install 24
nvm alias default 24
nvm use 24
node --version
npm --version
```

#### Ubuntu / Debian

The distribution's default apt repository may provide an older Node.js. Seeing a working `node` command is not enough; check the version before installing `dsh-tui`.

One copyable NodeSource setup for Node 24 is:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version
npm --version
which node
which npm
```

For development machines, nvm is a user-level alternative that avoids system-wide npm permissions:

```sh
sudo apt-get update
sudo apt-get install -y curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
nvm use 24

node --version
npm --version
which node
which npm
```

Use `source ~/.zshrc` instead when the login shell is zsh. If the host already has an older apt or system Node.js, upgrade or select a supported version before continuing.

### 2. Install dsh-tui

The current published RC is `0.1.0-rc.11`. Install the RC channel rather than the stable `latest` channel:

```sh
npm install -g @jame100101/dsh-tui@rc
dsh-tui --version
```

The version command should report `0.1.0-rc.11` while this RC is current. The package ships its bundled runtime inside the tarball, so a separate workspace install is not required for end users.

### 3. Start a project

Run `dsh-tui` from the directory you want to use as the workspace. The current directory is the default workspace:

```sh
cd your-project
dsh-tui
```

Set your DeepSeek API key before starting. Bash, zsh, and PowerShell examples:

```sh
export DEEPSEEK_API_KEY=your_api_key
dsh-tui
```

```powershell
$env:DEEPSEEK_API_KEY = "your_api_key"
dsh-tui
```

Keep API keys out of source files and shell history where practical.

You can also enter a credential inside the TUI:

1. Type `/settings`, then press `Tab` to open the **Models** page.
2. Under **API credentials**, select the DeepSeek credential and press **Enter**.
3. Type the key (the field is masked and never echoed) and press **Enter** to confirm.

Credentials are stored locally in `$DSH_HOME/.credentials.yaml` (default: `~/.dsh/.credentials.yaml`), are never displayed, and take effect for the next request without a restart. A credential shadowed by an environment variable is read-only in the settings page.

## Common Commands

| Command | Purpose |
| --- | --- |
| `dsh-tui` | Start the TUI in the current directory. |
| `dsh-tui "<task>"` | Start the TUI and submit a task immediately. |
| `dsh-tui -c` / `--continue` | Resume the newest session from the current directory. |
| `dsh-tui -r` | Open the interactive session picker. |
| `dsh-tui -r <session-id>` | Resume a session by id, id prefix, or title. |
| `dsh-tui -c --fork-session` | Fork a resumed session at its last completed turn. |
| `dsh-tui -p "<task>"` | Print one task result to stdout without opening the TUI. |
| `dsh-tui -c -p "<task>"` | Resume a session, then run one task non-interactively. |
| `dsh-tui --version` | Print the installed package version. |
| `dsh-tui --help` | Show CLI options. |
| `/help` | Show interactive commands inside the TUI. |
| `/new` | Create a new session. |
| `/resume` | Browse and resume a saved session. |
| `/settings` | Open settings. |
| `/effort` | Select the thinking effort. |
| `Ctrl+C` twice | Exit the TUI. |

Exit codes: `0` means success, `1` a runtime failure, `2` a usage error, and `130` SIGINT. `--print` writes only the assistant result to stdout; diagnostics go to stderr.

## Key Features

- **Local-first TUI:** runs in your terminal instead of a hosted web page.
- **Streaming agent interaction:** shows thinking, replies, tool activity, permissions, and status as they arrive.
- **Persistent sessions:** resume prior conversations, browse history, rename sessions, and fork without overwriting the original.
- **Print mode:** `-p` produces clean, scriptable output for shells and CI.
- **Slash-command palette:** type `/` to search available commands; `Tab` completes and `Esc` dismisses.
- **Settings:** General, Models with API credentials, Plugins, Inventory, and agent Presets pages.
- **Tools and permissions:** bash, PowerShell, file, and web tools use a sandbox-mode bar with approval and ask-user interactions.
- **Responsive terminal layout:** handles resize, alternate-screen lifecycle, mouse wheel, selection, and scrollbar interaction.
- **Unicode-aware display:** supports CJK text, emoji, and symbols such as ⚙ in composer and transcript layout.
- **Persistent shell startup:** the bundled Harness runtime uses one shared prompt sentinel between the persistent shell tool and its terminal reader, so short commands such as `pwd` and `ls` do not wait for a mismatched-prompt fallback timeout.
- **npm distribution:** a single self-contained global install includes the bundled runtime.

## Troubleshooting

### `node: command not found` or Windows says `'node' is not recognized`

Reopen the terminal after installing Node.js. If the problem remains, verify that Node.js is installed and that its installation directory is on `PATH`:

```sh
which node
which npm
```

On Windows use:

```powershell
where.exe node
where.exe npm
```

### `npm: command not found`

npm is normally supplied by the Node.js installation. Repair or reinstall Node.js and its PATH entry instead of downloading npm separately.

### `dsh-tui: command not found`

Check the global npm prefix and the executable locations:

```sh
npm prefix -g
which node
which npm
which dsh-tui
```

On Windows:

```powershell
npm prefix -g
where.exe node
where.exe npm
where.exe dsh-tui
```

If the global bin directory is not on PATH, add the directory reported by your npm installation or use a user-level Node manager such as nvm.

### Node.js version is too old

Run `node --version` and upgrade to the declared range `^22.19.0 || >=24.0.0`. Node 22.0–22.18 and Node 23 are not part of this package's supported engine range.

### Linux or macOS global install reports EACCES

Prefer nvm or another user-level Node.js installation so npm's global prefix is writable by your account. Do not make `sudo npm install -g ...` the default fix; it can create mixed ownership in the npm prefix.

## Release Candidate Status

`dsh-tui` is currently a **Release Candidate**, not a stable release. Use:

```sh
npm install -g @jame100101/dsh-tui@rc
```

The `rc` dist-tag is intentionally separate from `latest`. Check the installed version with `dsh-tui --version` before reporting a problem.

## Maintenance

Session data and local configuration are stored under the user's DSH data directory. Keep that directory backed up if sessions matter to you, and remove old sessions through the TUI or the supported session tools rather than deleting unrelated project files.

The persistent-shell prompt alignment described above is a bundled runtime integration detail. This README documents it for users; it does not change the core Harness README or the core Harness protocol.

Upgrade or uninstall the global package with:

```sh
npm install -g @jame100101/dsh-tui@rc
npm uninstall -g @jame100101/dsh-tui
```

## Development

<a id="run-from-source"></a>

Clone the repository and install workspace dependencies:

```sh
git clone https://github.com/jame100101/deepseek-harness-tui.git
cd deepseek-harness-tui
pnpm install
pnpm run build
pnpm run test
```

The main TUI source is under `packages/tui/tui`. The CLI assembly lives under `apps/tui-cli`. Use `pnpm dsh --profile tui` for a source checkout smoke run when the required local environment is configured.

Documentation changes should update both `README.md` and `README.zh.md`. Product code, runtime behavior, package versions, npm dist-tags, releases, and tags are separate from this README-only guide.

## Architecture

- **React 19 + Ink 7:** terminal rendering and input handling.
- **TypeScript:** typed application and plugin code.
- **DeepSeek Harness runtime:** plugin-based services for sessions, tools, permissions, persistence, and agent loops.
- **Persistent terminal tools:** shell and filesystem operations run through the Harness runtime.
- **Session storage:** local persistence supports resume and history browsing.

```text
dsh-tui (CLI wrapper, apps/tui-cli)
  → dsh launcher (bundled runtime)
  → Cordis plugin composition (profile: tui)
  → React + Ink TUI plugin (@deepseek-ai/dsh-tui)
  → event-sourced session log → live transcript rows
```

The wrapper translates launch flags and starts the bundled runtime. The TUI plugin folds the append-only session log into transcript rows for users, assistant messages, thinking, tool cards, retries, and status, then chooses the Ink full-screen renderer for TTYs or a line-driven fallback for pipes and CI.

For a feature-by-feature comparison with the Web frontend, see **[TUI-WEB-COMPARISON.md](TUI-WEB-COMPARISON.md)**.

See [docs/architecture.md](docs/architecture.md) for the repository architecture and [packages/README.md](packages/README.md) for package groups.
