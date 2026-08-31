/**
 * Transactional profile-patch plugin toggles for the TUI settings page.
 * The file mutation is atomic and cross-process serialized; the operation
 * completes only after the Loader reaches the requested state. A rejected or
 * timed-out hot apply restores the previous text when no other writer has
 * replaced the attempted edit.
 * @module @deepseek-ai/dsh-tui/src/plugin-toggle-runtime
 */

import { readFile } from 'node:fs/promises'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  disableEntryText,
  enableEntryText,
  hasConditionalDisabledState,
  pluginDisableBlockers,
  pluginInventoryEntry,
  profilePatchEntry,
} from './patch-toggle'

/** Failure categories rendered into localized TUI notices by the caller. */
export type PluginToggleFailureCode =
  | 'entry-unavailable'
  | 'surface-owned'
  | 'profile-managed'
  | 'conditional'
  | 'dependency-blocked'
  | 'apply-failed'

/** Outcome of one serialized profile plugin toggle. */
export type PluginToggleResult =
  | { ok: true; enabled: boolean }
  | {
    ok: false
    code: PluginToggleFailureCode
    detail?: string
    blockers?: readonly string[]
    rollback?: 'failed' | 'not-needed' | 'preserved-concurrent-edit' | 'restored'
  }

/** Inputs that vary by profile deployment. */
export interface PluginToggleOptions {
  /** Active Cordis root whose Loader hot-applies the profile patch. */
  ctx: Context
  /** Absolute user profile patch path watched by the launcher. */
  patchPath: string
  /** Bare Loader entry id selected in the settings page. */
  id: string
  /** Entry id of the TUI itself, which stays mounted while it renders. */
  surfacePluginId: string
  /** Deployment-owned rows whose state is controlled outside this page. */
  protectedIds: readonly string[]
  /** Maximum wait for the watch/recompose lifecycle to settle. */
  settleTimeoutMs: number
}

interface PatchMutation {
  before: string
  after: string
}

async function mutatePatch(
  filename: string,
  render: (content: string) => string,
): Promise<PatchMutation> {
  return await withFileLock(filename, async () => {
    const before = await readFile(filename, 'utf8')
    const after = render(before)
    if (after !== before) await writeFileAtomic(filename, after, { mode: 0o600, dirMode: 0o700 })
    return { before, after }
  })
}

async function rollbackPatch(
  filename: string,
  mutation: PatchMutation,
): Promise<'not-needed' | 'preserved-concurrent-edit' | 'restored'> {
  if (mutation.after === mutation.before) return 'not-needed'
  return await withFileLock(filename, async () => {
    const current = await readFile(filename, 'utf8')
    // A concurrent editor owns any text written after our mutation. Restoring
    // an older whole-file snapshot in that case would discard their change.
    if (current !== mutation.after) return 'preserved-concurrent-edit'
    await writeFileAtomic(filename, mutation.before, { mode: 0o600, dirMode: 0o700 })
    return 'restored'
  })
}

interface LoaderStateWaiter {
  promise: Promise<void>
  dispose(): void
}

function createLoaderStateWaiter(
  ctx: Context,
  patchPath: string,
  id: string,
  enabled: boolean,
  timeoutMs: number,
): LoaderStateWaiter {
  let disposeWaiter = (): void => {}
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false
    const disposers: (() => void)[] = []
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // One already-disposed Loader listener does not affect the result.
        }
      }
      if (error === undefined) resolve()
      else reject(error)
    }
    const check = (): void => {
      try {
        const entry = profilePatchEntry([...ctx.loader.entries()], id)
        if (entry === undefined || entry.disabled === enabled) return
        if (enabled && entry.fiber?.state !== FiberState.ACTIVE) return
        if (!enabled && entry.fiber !== undefined) return
        finish()
      } catch {
        // A Loader tree replacement can make one observation race disposal;
        // its next lifecycle event retries against the settled tree.
      }
    }
    const timer = setTimeout(() => {
      finish(new Error(`timed out after ${timeoutMs}ms waiting for Loader entry ${id}`))
    }, timeoutMs)
    timer.unref()
    disposers.push(ctx.on('internal/status', check, { global: true }))
    disposers.push(ctx.on('loader/partial-dispose', check, { global: true }))
    disposers.push(ctx.on('internal/dispatch', (_mode, eventName, args) => {
      const failedPath: unknown = args[0]
      if (eventName !== 'hmr/config-update-failed' || failedPath !== patchPath) return
      const cause: unknown = args[1]
      finish(cause instanceof Error ? cause : new Error(String(cause)))
    }, { global: true }))
    disposeWaiter = () => { finish() }
    check()
  })
  return { promise, dispose: () => { disposeWaiter() } }
}

/**
 * Toggle one patchable host-plane plugin and wait for the launcher's live
 * profile watcher to settle. Dependency providers, expression-owned rows, and
 * the rendering TUI entry stay fixed. Failed application restores the exact
 * previous patch text unless another writer has already replaced the edit.
 * @param options - active Loader, patch path, selected id, and wait policy.
 * @returns the settled enabled state or a classified failure.
 */
export async function toggleProfilePlugin(options: PluginToggleOptions): Promise<PluginToggleResult> {
  const entries = [...options.ctx.loader.entries()]
  const inventory = pluginInventoryEntry(entries, options.id)
  if (inventory === undefined) return { ok: false, code: 'entry-unavailable' }
  const target = profilePatchEntry(entries, options.id)
  if (target === undefined) return { ok: false, code: 'profile-managed' }
  if (target.options.id === options.surfacePluginId) return { ok: false, code: 'surface-owned' }
  if (options.protectedIds.includes(target.options.id)) return { ok: false, code: 'profile-managed' }
  if (hasConditionalDisabledState(target)) return { ok: false, code: 'conditional' }
  const enabling = target.disabled
  if (!enabling) {
    const blockers = pluginDisableBlockers(entries, target)
    if (blockers.length > 0) return { ok: false, code: 'dependency-blocked', blockers }
  }

  let mutation: PatchMutation | undefined
  const waiter = createLoaderStateWaiter(
    options.ctx,
    options.patchPath,
    options.id,
    enabling,
    options.settleTimeoutMs,
  )
  try {
    mutation = await mutatePatch(
      options.patchPath,
      enabling
        ? content => enableEntryText(content, options.id)
        : content => disableEntryText(content, options.id),
    )
    await waiter.promise
    return { ok: true, enabled: enabling }
  } catch (error) {
    waiter.dispose()
    let rollback: 'failed' | 'not-needed' | 'preserved-concurrent-edit' | 'restored' | undefined
    if (mutation !== undefined) {
      try {
        rollback = await rollbackPatch(options.patchPath, mutation)
      } catch {
        // The original apply failure is the actionable result; rollback uses
        // compare-and-swap and has no further safe mutation after it rejects.
        rollback = 'failed'
      }
    }
    return {
      ok: false,
      code: 'apply-failed',
      detail: error instanceof Error ? error.message : String(error),
      ...(rollback === undefined ? {} : { rollback }),
    }
  }
}
