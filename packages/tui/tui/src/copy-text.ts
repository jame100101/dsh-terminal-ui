/**
 * Semantic copy extraction for transcript nodes. Clipboard text comes from
 * the folded node fields (`node.text`), never from rendered terminal cells,
 * ANSI, glyphs, or chrome.
 * @module @deepseek-ai/dsh-tui/src/copy-text
 */

import type { TuiNode } from './types'

/** Why `/copy` could not pick a node. */
export type CopySpecError = 'usage' | 'empty' | 'range'

/** A resolved `/copy last|n` target. */
export interface CopyTarget {
  node: TuiNode
  /** 1-based index among copyable nodes. */
  index: number
  total: number
}

/** Strip CSI / OSC sequences if a node ever carried them. Semantic text usually has none. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

/**
 * Semantic clipboard text for one transcript node, or `null` when the node
 * has no message body worth copying (retry rows, turn tails, empty tools).
 * @param node - a folded transcript row.
 * @returns the node body without UI glyphs.
 */
export function extractCopyText(node: TuiNode): string | null {
  switch (node.kind) {
    case 'user':
    case 'assistant':
    case 'think':
    case 'context':
      return node.text === '' ? null : stripAnsi(node.text)
    case 'tool':
      return node.text === '' ? null : stripAnsi(node.text)
    case 'status':
    case 'retry':
      return null
  }
}

/**
 * Resolve `/copy` with no argument or `last` to the newest copyable node, or
 * a 1-based index among copyable nodes (user, assistant, think, tool, context).
 * @param nodes - the folded transcript.
 * @param argument - the `/copy` argument after the command name.
 * @returns the target, or a usage/empty/range error.
 */
export function resolveCopyTarget(
  nodes: readonly TuiNode[],
  argument: string,
): { ok: true; target: CopyTarget } | { ok: false; error: CopySpecError } {
  const list: TuiNode[] = []
  for (const node of nodes) {
    if (extractCopyText(node) !== null) list.push(node)
  }
  if (list.length === 0) return { ok: false, error: 'empty' }
  const spec = argument.trim() === '' ? 'last' : argument.trim()
  if (spec === 'last') {
    const node = list[list.length - 1]
    if (node === undefined) return { ok: false, error: 'empty' }
    return { ok: true, target: { node, index: list.length, total: list.length } }
  }
  if (!/^[1-9]\d*$/u.test(spec)) return { ok: false, error: 'usage' }
  const index = Number(spec)
  const node = list[index - 1]
  if (node === undefined) return { ok: false, error: 'range' }
  return { ok: true, target: { node, index, total: list.length } }
}
