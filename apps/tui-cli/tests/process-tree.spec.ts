import { describe, expect, it } from 'vitest'
import {
  linearSlopePerMinute, mergeProcessTrees, parsePosixProcessTable, parseWindowsProcessJson, parseWindowsProcessListJson,
  walkProcessTree,
} from '../../../evaluation/tui/process-tree.mjs'

describe('repository-only TUI process-tree sampler', () => {
  it('parses one or many Windows process rows', () => {
    expect(parseWindowsProcessJson('{"ProcessId":10,"ParentProcessId":8,"WorkingSetSize":100,"Name":"node.exe"}'))
      .toEqual([{ pid: 10, ppid: 8, rssBytes: 100, name: 'node' }])
    expect(parseWindowsProcessJson('[{"ProcessId":10,"ParentProcessId":8,"WorkingSetSize":100,"Name":"node.exe"},{"ProcessId":11,"ParentProcessId":10,"WorkingSetSize":40,"Name":"pwsh.exe"}]'))
      .toHaveLength(2)
    expect(parseWindowsProcessListJson('{"Id":10,"WorkingSet64":100,"ProcessName":"node"}'))
      .toEqual([{ pid: 10, ppid: 0, rssBytes: 100, name: 'node' }])
  })

  it('walks only descendants of the launched root', () => {
    const rows = parsePosixProcessTable('  10  8  4 node\n  11  10  2 bash\n  12  11  1 csc\n  99  3  8 other\n')
    const sample = walkProcessTree(10, rows)
    expect(sample.processes.map(entry => entry.name)).toEqual(['node', 'bash', 'csc'])
    expect(sample.rssBytes).toBe(7 * 1024)
  })

  it('merges overlapping roots without double-counting a process', () => {
    const rows = parsePosixProcessTable('  10  8  4 node\n  11  10  2 bash\n  12  11  1 csc\n')
    const combined = mergeProcessTrees([walkProcessTree(10, rows), walkProcessTree(11, rows)])
    expect(combined.processes.map(entry => entry.pid)).toEqual([10, 11, 12])
    expect(combined.rssBytes).toBe(7 * 1024)
  })

  it('measures post-warm-up growth in bytes per minute', () => {
    expect(linearSlopePerMinute([
      { elapsedMs: 0, value: 100 },
      { elapsedMs: 30_000, value: 150 },
      { elapsedMs: 60_000, value: 200 },
    ])).toBeCloseTo(100)
    expect(linearSlopePerMinute([{ elapsedMs: 0, value: 10 }])).toBe(0)
  })
})
