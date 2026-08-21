import { describe, expect, it } from 'vitest'
import { applyEvent, createScratch, initialState } from '../src/fold'
import {
  MAX_NODE_LINE_CACHE, cachedNodeLines, createNodeLineCache, pruneNodeLineCache,
} from '../src/render'
import type { TuiNode } from '../src/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function userNode(id: number): TuiNode {
  return { kind: 'user', id, text: `prompt ${id}` }
}

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent
}

describe('node line cache', () => {
  it('prunes painted rows down to the cap while keeping the window set', () => {
    const cache = createNodeLineCache()
    const nodes = Array.from({ length: MAX_NODE_LINE_CACHE + 80 }, (_, index) => userNode(index + 1))
    for (const node of nodes) {
      cachedNodeLines(cache, node, 40, false, undefined, 'zh')
    }
    expect(cache.lines.size).toBe(MAX_NODE_LINE_CACHE + 80)
    const keep = new Set(nodes.slice(-12))
    pruneNodeLineCache(cache, keep)
    expect(cache.lines.size).toBe(MAX_NODE_LINE_CACHE)
    for (const node of keep) expect(cache.lines.has(node)).toBe(true)
  })
})

describe('fold heap working set', () => {
  it('keeps one row family per turn across 100 then 500 turns', () => {
    const scratch = createScratch()
    let fold = initialState()
    const runTurns = (start: number, count: number): void => {
      for (let turn = start; turn < start + count; turn += 1) {
        fold = applyEvent(fold, event('turn/start', turn * 10, { turn }), scratch)
        fold = applyEvent(fold, event('user/message', turn * 10 + 1, {
          content: [{ type: 'text', text: `ask ${turn}` }],
          source: { kind: 'user' },
        }), scratch)
        fold = applyEvent(fold, event('assistant/chunk', turn * 10 + 2, {
          chunk: { type: 'text-delta', index: 0, text: `answer ${turn}` },
        }), scratch)
        fold = applyEvent(fold, event('assistant/message', turn * 10 + 3, {
          message: { id: `m${turn}`, content: [{ type: 'text', text: `answer ${turn}` }] },
        }), scratch)
      }
    }
    runTurns(1, 100)
    const after100 = fold.nodes.length
    expect(after100).toBe(200)
    const heap100 = process.memoryUsage().heapUsed
    runTurns(101, 400)
    expect(fold.nodes.length).toBe(1000)
    const heap500 = process.memoryUsage().heapUsed
    expect(fold.nodes.length / after100).toBe(5)
    expect(heap500).toBeLessThan(heap100 * 12)
  })
})
