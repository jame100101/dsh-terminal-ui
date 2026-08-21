import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atTokenRange, listWorkspaceMentions, pathIsInside, replaceAtToken } from '../src/file-mention'

describe('atTokenRange', () => {
  it('ignores slash commands and captures a trailing @query', () => {
    expect(atTokenRange('/help')).toBeNull()
    expect(atTokenRange('hello')).toBeNull()
    expect(atTokenRange('@src')).toEqual({ start: 0, query: 'src' })
    expect(atTokenRange('see @pkg/tui')).toEqual({ start: 4, query: 'pkg/tui' })
  })
})

describe('replaceAtToken', () => {
  it('replaces only the trailing @token', () => {
    expect(replaceAtToken('see @pk', 'pkg/tui/src ')).toBe('see @pkg/tui/src ')
    expect(replaceAtToken('see @dir', 'dir/')).toBe('see @dir/')
  })
})

describe('pathIsInside', () => {
  it('rejects parent-directory escapes', () => {
    const cwd = process.cwd()
    expect(pathIsInside(cwd, cwd)).toBe(true)
    expect(pathIsInside(cwd, resolve(cwd, 'src'))).toBe(true)
    expect(pathIsInside(cwd, resolve(cwd, '..'))).toBe(false)
  })
})

describe('listWorkspaceMentions', () => {
  it('filters, prefers directories, and stays under cwd', () => {
    const listing = [
      { relative: 'src', directory: true },
      { relative: 'setup.md', directory: false },
      { relative: '.git', directory: true },
      { relative: 'readme.txt', directory: false },
    ]
    const matches = listWorkspaceMentions('/ws', 's', () => listing)
    expect(matches.map(entry => entry.relative)).toEqual(['src', 'setup.md'])
    expect(matches[0]?.directory).toBe(true)
  })

  it('lists a nested directory from the query prefix', () => {
    const matches = listWorkspaceMentions('/ws', 'src/a', (absDir) => {
      expect(absDir.replaceAll('\\', '/')).toMatch(/\/src$/)
      return [
        { relative: 'app.ts', directory: false },
        { relative: 'api.ts', directory: false },
      ]
    })
    expect(matches.map(entry => entry.relative)).toEqual(['src/api.ts', 'src/app.ts'])
  })
})
