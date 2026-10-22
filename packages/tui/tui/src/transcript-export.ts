import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderNodePlain } from './plain'
import type { TuiNode } from './types'

/** Export only the retained display projection; never substitute it for a full session archive. */
export function transcriptExportText(nodes: readonly TuiNode[], locale: 'zh' | 'en'): string {
  const title = locale === 'en'
    ? 'DSH-TUI masked display export — retained projection only, not a complete session archive.'
    : 'DSH-TUI 脱敏显示导出 — 仅包含当前保留的展示投影，不是完整会话归档。'
  return `${title}\n\n${nodes.map(node => renderNodePlain(node, locale)).filter(Boolean).join('\n\n')}\n`
}

/** Fresh private directory and file: exports never overwrite user files or touch DSH_HOME. */
export async function exportDisplayedTranscript(nodes: readonly TuiNode[], locale: 'zh' | 'en'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-export-'))
  const path = join(directory, 'transcript.txt')
  await writeFile(path, transcriptExportText(nodes, locale), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return path
}
