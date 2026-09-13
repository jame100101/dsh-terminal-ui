# Local Harness latest + TUI display polish

- Target official npm latest resolved on 2026-09-12: dsh 0.1.5-rc.1, not the next tag. Retain public npm exports, external host runtimes and the existing Ink patch. Official transitive semver ranges also resolve some packages to 0.1.5-rc.2; do not confuse the host pin with a globally uniform transitive version.
- Consume active-Agent assistant stream frames as ephemeral fold inputs. Durable settlement replaces the live body and expands the official compact stream for replay. Never append transient frames to Session storage. Rename nested tool event consumers to ptc-dispatch and tag command image attachments. Invalidate old projection caches.
- Static blue/white whale raster uses terminal-background exterior cells; no image processing runtime dependency. Composer prefix remains one cell. Clipboard/input handlers and offsets unchanged. Neutral command palette preserves its selection arrow; duplicate counters removed from the upper status row only.
- Local validation only: build/typecheck, focused fold/UI/clipboard/layout tests, one PTY input/drag/resize scenario, repo/docs checks and one official-host packed-plugin clean room. No API-key E2E or cross-platform matrix. The clean-room artifact predates the projection cache version bump; it is an unpublished local diagnostic artifact, not a release candidate.
- No commits, remote pushes, version bump, user profile changes, tags or releases.

## 2026-09-13 rollback
User rejected the visual changes. Renderer, viewport, whale and visual tests restored to HEAD; static whale data removed. Only Harness compatibility changes and stream regression retained. Prior visual preview/artifact is obsolete.


## 2026-09-13 strict review correction
Final accepted UI: antialiased blue whale with white mouth/eye, one-cell chevron and deduplicated counters; command palette colors unchanged. Rebuilt lock resolution (including pnpm workspace-state cache) removes old persistence peers. CLI remains 0.1.5-rc.1; exact subpackage dependencies and peers align to 0.1.5-rc.2. Cold fork reads now use public observeSession with clone-before-dispose ownership rather than the failing readSession seed constructor path. Official minimal preset is single-shell; exact preset assertions updated to its published contract, with switch/fork/resume/jobs/workflow coverage retained. Tests need access to the real temp directory: sandbox EPERM can end a turn before the mock adapter runs. Earlier candidate tarballs are obsolete. No npm publish/tag/release is part of this review.


Final local evidence: 49 test files passed, 527 tests passed / 1 skipped; host/client build, typecheck, repo/docs and exact 0.2.1 tarball clean-room PASS. Candidate: 277721 bytes, 202 files, SHA256 6d7432b71be1e31636f40db74cd55381f1164c781f170a9d3fbf0e0131dc7c63. Windows real PTY passed; Linux/macOS CI matrix was not rerun locally.
