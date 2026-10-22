import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mentionAtCaret, pathMention, completeMention } from '../src/input/completion'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atTokenRange, listWorkspaceMentions, pathIsInside, readWorkspaceDir, replaceAtToken } from '../src/file-mention'

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

it('completes real CJK, space and emoji paths, including pasted Windows separators', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mention-'))
  try {
    mkdirSync(join(root, '中文 目录', '子目录'), { recursive: true })
    writeFileSync(join(root, '中文 目录', '子目录', '👩🏽‍💻 文件.ts'), '')
    for (const query of ['中文 目录/子目录/', '中文 目录\\子目录\\']) {
      const rows = listWorkspaceMentions(root, query, readWorkspaceDir)
      expect(rows).toEqual([{ relative: '中文 目录/子目录/👩🏽‍💻 文件.ts', directory: false }])
      const mention = pathMention(rows[0]!.relative)
      const draft = '查看 @旧 保留后文'
      const range = mentionAtCaret(draft, draft.indexOf('旧') + 1)!
      const inserted = completeMention(draft, range, mention)
      expect(inserted.text).toBe(`查看 ${mention} 保留后文`)
      expect(mentionAtCaret(inserted.text, inserted.caret)?.query).toBe(rows[0]!.relative)
    }
    for (const query of ['../', '..\\', '/etc/', 'C:\\Users\\', '\\\\server\\share\\']) {
      expect(listWorkspaceMentions(root, query, readWorkspaceDir)).toEqual([])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
