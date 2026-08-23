/**
 * `@` workspace-path completion for the composer. Lists cwd-relative files
 * and directories; never walks above the workspace root.
 * @module @deepseek-ai/dsh-tui/src/file-mention
 */

import { readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/** Cap on picker rows so the palette cannot flood the frame. */
export const MAX_FILE_MENTIONS = 32

/** One workspace path relative to cwd. */
export interface MentionEntry {
  relative: string
  directory: boolean
}

/**
 * The `@token` at the end of a composer draft, or null when the draft is a
 * slash command or has no trailing `@` mention.
 * @param value - the composer draft.
 * @returns the `@` offset and the query after it.
 */
export function atTokenRange(value: string): { start: number; query: string } | null {
  if (value.startsWith('/')) return null
  const match = /(?:^|\s)@([^\s]*)$/u.exec(value)
  if (match === null) return null
  const start = value.lastIndexOf('@')
  return { start, query: match[1] ?? '' }
}

/**
 * Replace the trailing `@token` with `@insert`.
 * @param value - the composer draft.
 * @param insert - path and trailing `/` or space, without the `@`.
 * @returns the draft with the token replaced.
 */
export function replaceAtToken(value: string, insert: string): string {
  const range = atTokenRange(value)
  if (range === null) return `${value}@${insert}`
  return `${value.slice(0, range.start)}@${insert}`
}

/**
 * True when `target` is `root` or a descendant.
 * @param root - workspace cwd.
 * @param target - resolved path.
 * @returns whether the target stays inside the workspace.
 */
export function pathIsInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * Filter and sort directory listings for an `@` query.
 * @param cwd - workspace root.
 * @param query - text after `@` (may include `/`).
 * @param readDir - listing for one absolute directory.
 * @returns at most {@link MAX_FILE_MENTIONS} cwd-relative entries.
 */
export function listWorkspaceMentions(
  cwd: string,
  query: string,
  readDir: (absDir: string) => MentionEntry[],
): MentionEntry[] {
  const root = resolve(cwd)
  const lastSep = Math.max(query.lastIndexOf('/'), query.lastIndexOf('\\'))
  const dirPart = lastSep >= 0 ? query.slice(0, lastSep) : ''
  const namePart = (lastSep >= 0 ? query.slice(lastSep + 1) : query).toLowerCase()
  const absDir = resolve(root, dirPart)
  if (!pathIsInside(root, absDir)) return []
  let entries: MentionEntry[]
  try {
    entries = readDir(absDir)
  } catch {
    return []
  }
  const prefix = dirPart.replaceAll('\\', '/')
  return entries
    .filter(entry => !entry.relative.startsWith('.') && entry.relative.toLowerCase().startsWith(namePart))
    .sort((left, right) => Number(right.directory) - Number(left.directory) || left.relative.localeCompare(right.relative))
    .slice(0, MAX_FILE_MENTIONS)
    .map(entry => ({
      relative: prefix === '' ? entry.relative : `${prefix}/${entry.relative}`,
      directory: entry.directory,
    }))
}

/**
 * Read one directory for {@link listWorkspaceMentions}.
 * @param absDir - absolute directory.
 * @returns file and directory names.
 */
export function readWorkspaceDir(absDir: string): MentionEntry[] {
  return readdirSync(absDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() && !entry.isDirectory()) return []
    return [{ relative: entry.name, directory: entry.isDirectory() }]
  })
}
