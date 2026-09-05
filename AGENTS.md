# DSH TUI plugin repository

This repository owns an out-of-tree TUI plugin for official DeepSeek Harness. Read [architecture](docs/architecture.md) before changing integration code.

- Use public npm Harness/Cordis APIs at the pinned versions. Never vendor Harness runtime, import its source, or add singleton-sensitive runtime copies.
- Preserve TUI behavior and the preset, resume/fork, jobs ownership and workflow isolation regression assertions.
- Keep the bundle patch, thin launcher and patched Ink packaging covered by exact-tarball official clean-room tests.
- Run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm verify:repo` and documentation checks before pushing. CI owns the Windows/Linux/macOS matrix. Report only executed evidence.
- Update English and Chinese documentation together; keep comments local and explain non-obvious ownership. Record architectural decisions in Agent Notes.
- Keep temporary data and credentials out of Git and packages. Do not delete user-owned untracked files.
- Harness upgrades use dependency upgrades plus adapter compatibility tests, not upstream source merges.
- Published tags identify their npm source commit. Do not move tags, publish npm packages, change dist-tags or GitHub Releases without an explicit request.
