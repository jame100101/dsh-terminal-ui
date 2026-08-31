# Issue 32 preset-switch evaluation

This evaluation covers the TUI regression reported in [Issue 32](https://github.com/jame100101/dsh-terminal-ui/issues/32): selecting a non-`minimal` preset in a blank session changed the visible selection without changing the effective agent composition.

## Decision

The implementation satisfies the issue's functional acceptance criteria. A blank session can switch between shipped presets, the current marker follows the committed selection, the selected preset owns the agent's commands, skills, tools, and prompt sections, and a started conversation remains locked. The issue is ready to close when the evaluated implementation lands on `main`.

## Reference comparison

The TUI uses the same ownership and switch rules as the Web implementation:

- the TUI and Web bundle patches disable the same bounded set of preset-owned model-facing rows while retaining shared providers and TUI-specific host runtimes;
- agent creation resolves the requested preset, or the roster default, before creating the session header and mounts that exact id during setup;
- preset selection is serialized per session, rechecks blank state inside the queue, calls `agentPresets.recompose`, and appends `agent-preset/selected` only after recomposition succeeds;
- prompt admission uses the same TUI session queue, so a prompt accepted before a switch fixes the preset even before `turn/start` becomes observable;
- `/new` carries the latest selection, and resume resolves the latest selection event, then the header, then the current default for metadata-free sessions.

The relevant Web handler in the original DeepSeek Harness checkout uses the same queued blank-state check, atomic `recompose`, and post-commit selection event. The TUI adds prompt admission to that queue because its in-process input path can accept a prompt before the durable turn event is published.

## Evidence

The focused Vitest run passed 16 tests across the preset lifecycle, assembled TUI composition, bundle ownership parity, and settings interaction suites. It covers default resolution, `standard → minimal → standard`, `code`, `cordis`, invalid selection rollback, rapid selections, prompt/switch ordering, conversation locking, `/new`, and recorded and metadata-free resume.

The assembled composition test boots the real base and TUI bundle patches and checks the resulting command, skill, tool, and system-prompt catalogs. A manual source launch exercised the user entry path `pnpm dsh-tui → /new → /presets`; selecting `standard` and then `code` moved the current marker after each committed recomposition.

`git diff --check` and `pnpm --config.verify-deps-before-run=false run build` completed successfully on the evaluated tree.

## Residual scope

The automated interaction test mocks the host callback while the assembled composition test invokes the real preset service. Together with the manual source-launch check they cover the original regression, but a future PTY test could join the real settings keystrokes and scoped catalog assertions in one automated process. This is additional regression depth rather than an Issue 32 acceptance blocker.
