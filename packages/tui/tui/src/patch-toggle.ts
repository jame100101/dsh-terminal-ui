/**
 * Surgical text edits for toggling one plugin entry in the profile's user
 * patch layer (`$DSH_HOME/profiles/<name>/cordis.patch.yml`). The edits are
 * line-based so user comments and `!!js` expressions survive untouched —
 * a full YAML round-trip would strip them. The launcher's HMR watch hot-
 * applies the file after each write.
 * @module @deepseek-ai/dsh-tui/src/patch-toggle
 */

export interface LoaderEntryView {
  id: string
  disabled: boolean
  options: { id: string; name: string; group?: boolean | null; disabled?: unknown }
  fiber?: {
    state?: number
    inject: Record<string, unknown>
    store?: Record<string, unknown> | undefined
  } | undefined
  subgroup?: unknown
  subtree?: unknown
}

const GENERATED_LOADER_ID = /^[0-9a-f]{8}$/
const PATCHABLE_LOADER_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/**
 * Decide whether one Loader entry represents a leaf plugin suitable for the
 * settings inventory. Include carriers, nested groups, and internal ids stay
 * out of the switch list because disabling them cascades into unrelated rows.
 * @param entry - Loader entry facts needed by the inventory.
 * @returns whether the row is a leaf plugin switch.
 */
export function isPluginInventoryEntry(entry: LoaderEntryView): boolean {
  return entry.options.group !== true
    && entry.id !== entry.options.id
    && entry.subgroup === undefined
    && entry.subtree === undefined
    && !entry.options.id.includes(':')
    && PATCHABLE_LOADER_ID.test(entry.options.id)
    // EntryTree.ensureId() assigns this form to dynamically mounted rows that
    // omitted an id. They have no stable patch target across launches.
    && !GENERATED_LOADER_ID.test(entry.options.id)
}

/**
 * Whether one inventory leaf belongs to the boot Include that the profile
 * patch layers recompose. Preset Includes inherit another Loader entry id, so
 * their runtime ids contain an additional `:` segment and a profile patch
 * with the same bare id would never reach them.
 * @param entry - Loader leaf to classify.
 * @returns whether the profile patch can address this exact runtime entry.
 */
export function isProfilePatchEntry(entry: LoaderEntryView): boolean {
  return isPluginInventoryEntry(entry) && entry.id === `include:${entry.options.id}`
}

function preferredInventoryEntry(left: LoaderEntryView, right: LoaderEntryView): LoaderEntryView {
  const leftPatchable = isProfilePatchEntry(left)
  const rightPatchable = isProfilePatchEntry(right)
  if (leftPatchable !== rightPatchable) return rightPatchable ? right : left
  const leftActive = !left.disabled && left.fiber !== undefined
  const rightActive = !right.disabled && right.fiber !== undefined
  if (leftActive !== rightActive) return rightActive ? right : left
  return right.id.localeCompare(left.id) < 0 ? right : left
}

/**
 * Collapse Loader leaves by bare id for the settings list. Host composition
 * and Agent preset trees may both contain rows such as `tool-fs`; one stable
 * list row avoids duplicate React keys and prefers the profile-addressable
 * host row when one exists.
 * @param entries - the settled Loader tree.
 * @returns one deterministic inventory entry per bare id.
 */
export function pluginInventoryEntries(entries: readonly LoaderEntryView[]): LoaderEntryView[] {
  const selected = new Map<string, LoaderEntryView>()
  for (const entry of entries) {
    if (!isPluginInventoryEntry(entry)) continue
    const previous = selected.get(entry.options.id)
    if (previous === undefined) selected.set(entry.options.id, entry)
    else selected.set(entry.options.id, preferredInventoryEntry(previous, entry))
  }
  return [...selected.values()]
}

/**
 * Resolve the deterministic inventory row for one bare Loader id.
 * @param entries - the settled host Loader tree.
 * @param id - the bare id written by a profile patch row.
 * @returns the displayed matching entry, or undefined when it is absent.
 */
export function pluginInventoryEntry(
  entries: readonly LoaderEntryView[],
  id: string,
): LoaderEntryView | undefined {
  return pluginInventoryEntries(entries).find(entry => entry.options.id === id)
}

/**
 * Resolve the unique root-composition entry addressed by the profile patch.
 * @param entries - the settled Loader tree, including Agent preset subtrees.
 * @param id - bare Loader id selected in settings.
 * @returns the exact root Include row, or undefined for preset-only/ambiguous ids.
 */
export function profilePatchEntry(
  entries: readonly LoaderEntryView[],
  id: string,
): LoaderEntryView | undefined {
  const matches = entries.filter(entry => isProfilePatchEntry(entry) && entry.options.id === id)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * List enabled Loader entries that require a service owned by `target`.
 * Disabling such a provider would leave those rows pending and make the next
 * strict application boot fail, so it stays outside the independent switch
 * inventory and remains visible through the read-only Inventory page.
 * @param entries - the settled Loader tree.
 * @param target - the active provider considered for disabling.
 * @returns unique dependent entry ids, alphabetically sorted.
 */
export function pluginDisableBlockers(entries: readonly LoaderEntryView[], target: LoaderEntryView): string[] {
  const provided = new Set(Object.keys(target.fiber?.store ?? {}))
  if (provided.size === 0) return []
  return [...new Set(entries
    // Include/group fibers inherit injections for their subtree. Generated-id
    // leaf fibers are real dependents but are named by module because their id
    // is intentionally unstable across launches.
    .filter(entry => entry !== target
      && entry.subgroup === undefined
      && entry.subtree === undefined
      && !entry.disabled
      && entry.fiber !== undefined)
    .filter(entry => Object.keys(entry.fiber?.inject ?? {}).some(service => provided.has(service)))
    .map((entry) => {
      if (!GENERATED_LOADER_ID.test(entry.options.id)) return entry.options.id
      return GENERATED_LOADER_ID.test(entry.options.name) ? 'dynamic-plugin' : entry.options.name
    }))]
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Detect a Loader entry whose enabled state is an evaluated expression rather
 * than a literal switch. Environment/platform-owned rows stay read-only in the
 * TUI so a user patch does not override their deployment condition.
 * @param entry - Loader entry to inspect.
 * @returns whether its disabled state is expression-owned.
 */
export function hasConditionalDisabledState(entry: LoaderEntryView): boolean {
  return entry.options.disabled !== undefined
    && entry.options.disabled !== null
    && typeof entry.options.disabled !== 'boolean'
}

/**
 * Return the file content with `- id: <id>` carrying `disabled: true`.
 * An existing entry flips or gains its disable line; a missing entry is
 * appended (replacing a trailing flow-style `[]` when present).
 * @param content - the current patch file text.
 * @param id - the loader entry id to disable.
 * @returns the edited text.
 */
export function disableEntryText(content: string, id: string): string {
  return setEntryDisabledText(content, id, true)
}

/**
 * Return the file content with `- id: <id>` carrying `disabled: false`.
 * The explicit override is required for entries disabled by an earlier bundle
 * layer; removing a user-layer `disabled: true` row would merely reveal that
 * earlier disabled state and make the switch appear to succeed without
 * activating the plugin.
 * @param content - the current patch file text.
 * @param id - the loader entry id to enable.
 * @returns the edited text.
 */
export function enableEntryText(content: string, id: string): string {
  return setEntryDisabledText(content, id, false)
}

function setEntryDisabledText(content: string, id: string, disabled: boolean): string {
  const lines = content.split('\n')
  const entryStart = lines.findIndex(line => line.trim() === `- id: ${id}`)
  if (entryStart !== -1) {
    const indent = lines[entryStart]?.match(/^[ \t]*/u)?.[0] ?? ''
    let entryEnd = lines.length
    for (let index = entryStart + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (line.startsWith(`${indent}- `)) {
        entryEnd = index
        break
      }
    }
    const disabledPrefix = `${indent}  disabled:`
    const disabledLine = lines.findIndex((line, index) =>
      index > entryStart && index < entryEnd && line.startsWith(disabledPrefix))
    if (disabledLine === -1) lines.splice(entryStart + 1, 0, `${indent}  disabled: ${disabled}`)
    else lines[disabledLine] = `${indent}  disabled: ${disabled}`
    return lines.join('\n')
  }
  const bracket = lines.findIndex(line => line.trim() === '[]')
  const entry = [`- id: ${id}`, `  disabled: ${disabled}`]
  if (bracket !== -1) lines.splice(bracket, 1, ...entry)
  else {
    // Insert before the trailing newline marker so the file keeps it.
    let insertAt = lines.length
    while (insertAt > 0 && lines[insertAt - 1]?.trim() === '') insertAt -= 1
    lines.splice(insertAt, 0, ...entry)
  }
  return lines.join('\n')
}
