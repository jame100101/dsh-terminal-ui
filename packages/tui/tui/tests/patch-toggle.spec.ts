import { describe, expect, it } from 'vitest'
import {
  disableEntryText,
  enableEntryText,
  hasConditionalDisabledState,
  isPluginInventoryEntry,
  isProfilePatchEntry,
  pluginDisableBlockers,
  pluginInventoryEntries,
  pluginInventoryEntry,
  profilePatchEntry,
} from '../src/patch-toggle'

const TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries.
[]
`

describe('disableEntryText', () => {
  it('replaces a trailing flow-style [] with the new entry and keeps comments', () => {
    const next = disableEntryText(TEMPLATE, 'storage')
    expect(next).toContain('- id: storage\n  disabled: true\n')
    expect(next).toContain('# Your patch layer')
    expect(next).not.toContain('[]')
  })

  it('inserts the disable line into an existing entry', () => {
    const next = disableEntryText('- id: storage\n  config: {a: 1}\n', 'storage')
    expect(next).toBe('- id: storage\n  disabled: true\n  config: {a: 1}\n')
  })

  it('flips an existing disabled: false to true', () => {
    const next = disableEntryText('- id: storage\n  disabled: false\n', 'storage')
    expect(next).toBe('- id: storage\n  disabled: true\n')
  })

  it('updates the entry-level disabled field after config without adding a duplicate', () => {
    const next = disableEntryText('- id: storage\n  config:\n    disabled: nested\n  disabled: false\n- id: next\n', 'storage')
    expect(next).toBe('- id: storage\n  config:\n    disabled: nested\n  disabled: true\n- id: next\n')
  })

  it('appends a fresh entry when no [] bracket exists', () => {
    const next = disableEntryText('# comment\n- id: other\n  disabled: true\n', 'storage')
    expect(next).toBe('# comment\n- id: other\n  disabled: true\n- id: storage\n  disabled: true\n')
  })
})

describe('enableEntryText', () => {
  it('writes an explicit false override for an existing disabled entry', () => {
    const next = enableEntryText('# c\n- id: storage\n  disabled: true\n- id: other\n', 'storage')
    expect(next).toBe('# c\n- id: storage\n  disabled: false\n- id: other\n')
  })

  it('keeps an explicit false override when enabling the last entry', () => {
    const next = enableEntryText('# comments\n- id: timer\n  disabled: true\n', 'timer')
    expect(next).toBe('# comments\n- id: timer\n  disabled: false\n')
  })

  it('flips only the disable line when the entry keeps other fields', () => {
    const next = enableEntryText('- id: storage\n  disabled: true\n  config: {a: 1}\n', 'storage')
    expect(next).toBe('- id: storage\n  disabled: false\n  config: {a: 1}\n')
  })

  it('appends an explicit false override without changing unrelated entries', () => {
    const source = '- id: other\n  disabled: true\n'
    expect(enableEntryText(source, 'storage')).toBe('- id: other\n  disabled: true\n- id: storage\n  disabled: false\n')
  })
})

describe('plugin toggle topology', () => {
  const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
    id: `include:${id}`,
    disabled: false,
    options: { id, name: `plugin-${id}` },
    fiber: { inject: {}, store: {} },
    ...overrides,
  })

  it('keeps only leaf plugin rows in the inventory', () => {
    expect(isPluginInventoryEntry(entry('session'))).toBe(true)
    expect(isPluginInventoryEntry(entry('include:session', { subtree: {} }))).toBe(false)
    expect(isPluginInventoryEntry(entry('group', { subgroup: {}, options: { id: 'group', name: 'group', group: true } }))).toBe(false)
    expect(isPluginInventoryEntry(entry('0c4a12fe'))).toBe(false)
    expect(isPluginInventoryEntry(entry('../outside'))).toBe(false)
  })

  it('deduplicates host and preset rows while preferring the profile patch target', () => {
    const storage = entry('storage', { disabled: true, fiber: undefined })
    const presetStorage = entry('storage', { id: 'include:agent-presets:storage' })
    expect(isProfilePatchEntry(storage)).toBe(true)
    expect(isProfilePatchEntry(presetStorage)).toBe(false)
    expect(pluginInventoryEntries([presetStorage, storage])).toEqual([storage])
    expect(pluginInventoryEntry([presetStorage, storage], 'storage')).toBe(storage)
    expect(profilePatchEntry([presetStorage, storage], 'storage')).toBe(storage)
    expect(profilePatchEntry([presetStorage], 'storage')).toBeUndefined()
    expect(pluginInventoryEntry([entry('include:storage', { subtree: {} })], 'storage')).toBeUndefined()
  })

  it('blocks a service provider while another enabled entry requires it', () => {
    const sessions = entry('session', { fiber: { inject: {}, store: { sessions: {} } } })
    const title = entry('session-title', { fiber: { inject: { sessions: null }, store: {} } })
    const disabled = entry('old-query', { disabled: true, fiber: { inject: { sessions: null }, store: {} } })
    const includeCarrier = entry('0c4a12fe', {
      options: { id: 'include:session', name: 'include:session' },
      subtree: {},
      fiber: { inject: { sessions: null }, store: {} },
    })
    const dynamicLeaf = entry('0c4a12fe', {
      options: { id: '0c4a12fe', name: '3d11c217' },
      fiber: { inject: { sessions: null }, store: {} },
    })
    expect(pluginDisableBlockers([sessions, title, disabled, includeCarrier, dynamicLeaf], sessions))
      .toEqual(['dynamic-plugin', 'session-title'])
  })

  it('recognizes expression-owned disabled states', () => {
    expect(hasConditionalDisabledState(entry('bash', { options: { id: 'bash', name: 'bash', disabled: { __jsExpr: 'process.platform' } } }))).toBe(true)
    expect(hasConditionalDisabledState(entry('plain', { options: { id: 'plain', name: 'plain', disabled: true } }))).toBe(false)
  })
})
