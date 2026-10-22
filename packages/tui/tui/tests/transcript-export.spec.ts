import { readFile, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportDisplayedTranscript, transcriptExportText } from '../src/transcript-export'
import type { TuiNode } from '../src/types'

const secret = 'sk-' + 'a'.repeat(40)
const nodes: TuiNode[] = [{ kind: 'user', id: 1, text: `api_key=${secret}` }]

describe('default display export', () => {
  it('labels its retained scope and uses the display mask without editing source nodes', () => {
    const text = transcriptExportText(nodes, 'en')
    expect(text).toContain('retained projection only')
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain(secret)
    expect(nodes[0]).toMatchObject({ text: `api_key=${secret}` })
  })

  it('writes a fresh private artifact rather than overwriting a session or user file', async () => {
    const paths: string[] = []
    try {
      paths.push(await exportDisplayedTranscript(nodes, 'en'))
      paths.push(await exportDisplayedTranscript(nodes, 'en'))
      expect(paths[0]).not.toBe(paths[1])
      for (const path of paths) {
        expect(await readFile(path, 'utf8')).toBe(transcriptExportText(nodes, 'en'))
        if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
      }
    } finally {
      await Promise.all(paths.map(path => rm(dirname(path), { recursive: true, force: true })))
    }
  })
})

it('history searches the same masked text while keeping accepted source drafts intact', async () => {
  const { searchInputHistory } = await import('../src/input/history-search')
  const history = [`api_key=${secret}`]
  expect(searchInputHistory(history, secret)).toEqual([])
  expect(searchInputHistory(history, 'api_key')).toEqual(history)
})

it('panel and session filters cannot search through the display mask', async () => {
  const { filterSettingsRows } = await import('../src/settings-chrome')
  const { buildSessionRows } = await import('../src/settings-data')
  expect(filterSettingsRows([{ key: 'x', text: `api_key=${secret}` }], secret)).toEqual([])
  const rows = buildSessionRows([{ id: 'session-a', model: 'model', status: 'persisted', title: `api_key=${secret}` }], secret, 'en')
  expect(rows.some(row => row.action === 'resume-session')).toBe(false)
})
