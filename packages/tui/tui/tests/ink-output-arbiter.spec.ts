import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { Box, Text, render, useInput, useStdout } from 'ink'
import xtermHeadless from '@xterm/headless'
import { describe, expect, it } from 'vitest'

interface FakeStdout extends EventEmitter {
  columns: number
  rows: number
  isTTY: boolean
  write: (chunk: string) => boolean
}

function createStdout(rows: number, accept: { value: boolean }): { stdout: FakeStdout; chunks: string[] } {
  const chunks: string[] = []
  const emitter = new EventEmitter()
  const stdout = emitter as FakeStdout
  stdout.columns = 40
  stdout.rows = rows
  stdout.isTTY = true
  stdout.write = (chunk: string): boolean => {
    chunks.push(String(chunk))
    return accept.value
  }
  return { stdout, chunks }
}

function fakeStdin(): PassThrough & { isTTY: boolean; setRawMode(mode: boolean): boolean; ref(): void; unref(): void } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode(mode: boolean): boolean
    ref(): void
    unref(): void
  }
  stream.isTTY = true
  stream.setRawMode = (mode: boolean) => mode
  stream.ref = () => {}
  stream.unref = () => {}
  return stream
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('Ink output arbiter and Windows fullscreen diff', () => {
  it('renders keyboard state immediately even when animation frames are throttled', async () => {
    const accept = { value: true }
    const { stdout, chunks } = createStdout(8, accept)
    const stdin = fakeStdin()
    function InputScreen(): ReactElement {
      const [value, setValue] = useState('idle')
      useInput((input) => {
        setValue(`typed-${input}`)
      })
      return createElement(Text, null, value)
    }
    const instance = render(createElement(InputScreen), {
      stdout: stdout as never,
      stdin: stdin as never,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      incrementalRendering: true,
      maxFps: 1,
    })
    try {
      await delay(80)
      const before = chunks.length
      stdin.write('x')
      await delay(120)
      expect(chunks.slice(before).join('')).toContain('typed-x')
    } finally {
      instance.unmount()
    }
  })

  it('retains only one redraw request while stdout is backpressured', async () => {
    const accept = { value: true }
    const { stdout, chunks } = createStdout(8, accept)
    let bump: ((value: number) => void) | undefined
    function App(): ReactElement {
      const [count, setCount] = useState(0)
      useEffect(() => {
        bump = setCount
      }, [])
      return createElement(Text, null, `frame-${count}`)
    }
    const instance = render(createElement(App), {
      stdout: stdout as never,
      stdin: fakeStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      incrementalRendering: true,
      coalesceBackpressuredFrames: true,
      maxFps: 1000,
    })
    try {
      await delay(50)
      expect(chunks.length).toBeGreaterThan(0)
      accept.value = false
      bump?.(1)
      await delay(20)
      const afterDiscoveringBackpressure = chunks.length
      for (let count = 2; count <= 8; count += 1) {
        bump?.(count)
        await delay(5)
      }
      expect(chunks.length).toBe(afterDiscoveringBackpressure)
      accept.value = true
      stdout.emit('drain')
      await delay(50)
      expect(chunks.length).toBeGreaterThan(afterDiscoveringBackpressure)
      const drained = chunks.slice(afterDiscoveringBackpressure).join('')
      expect(chunks.join('')).toMatch(/frame-8|\u001B\[1;\d+H8/)
      expect(drained).not.toMatch(/\u001B\[\d+;\d+H/u)
    } finally {
      instance.unmount()
    }
  })

  it('keeps absolute full-frame rewrites scoped to the explicit TUI option', async () => {
    const accept = { value: true }
    const { stdout, chunks } = createStdout(8, accept)
    let bump: ((value: string) => void) | undefined
    function Screen(): ReactElement {
      const [label, setLabel] = useState('first')
      useEffect(() => {
        bump = setLabel
      }, [])
      return createElement(
        Box,
        { flexDirection: 'column' },
        ...Array.from({ length: 5 }, (_, index) => createElement(Text, { key: index }, `${label}-${index}`)),
      )
    }
    const instance = render(createElement(Screen), {
      stdout: stdout as never,
      stdin: fakeStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      incrementalRendering: true,
      maxFps: 1000,
    })
    try {
      await delay(50)
      const before = chunks.length
      bump?.('second')
      await delay(50)
      const delta = chunks.slice(before).join('')
      expect(delta).toContain('second-0')
      expect(delta).not.toContain('\u001B[1;1H')
    } finally {
      instance.unmount()
    }
  })

  it('skips the Windows fullscreen clear when the app leaves the last cell blank', async () => {
    const accept = { value: true }
    const rows = 8
    const { stdout, chunks } = createStdout(rows, accept)
    function Screen(): ReactElement {
      return createElement(
        Box,
        { flexDirection: 'column', height: rows, width: 39 },
        ...Array.from({ length: rows }, (_, index) => createElement(Text, { key: index }, `row-${index}`)),
      )
    }
    const instance = render(createElement(Screen), {
      stdout: stdout as never,
      stdin: fakeStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      incrementalRendering: true,
      windowsFullscreenDiff: true,
      maxFps: 1000,
    })
    try {
      await delay(50)
      const output = chunks.join('')
      expect(output).toContain('row-0')
      if (process.platform === 'win32') {
        expect(output.includes('\u001B[2J')).toBe(false)
      }
    } finally {
      instance.unmount()
    }
  })

  it('clears once after a size change so leftover wrap rows cannot overlap chrome', async () => {
    const chunks: string[] = []
    const terminal = new xtermHeadless.Terminal({ cols: 60, rows: 12, allowProposedApi: true, convertEol: true })
    const stdout = new EventEmitter() as FakeStdout
    stdout.columns = 60
    stdout.rows = 12
    stdout.isTTY = true
    stdout.write = (chunk: string): boolean => {
      const text = String(chunk)
      chunks.push(text)
      terminal.write(text)
      return true
    }
    function Screen(): ReactElement {
      const inkStdout = useStdout().stdout as unknown as FakeStdout
      const [size, setSize] = useState({ columns: inkStdout.columns, rows: inkStdout.rows })
      useEffect(() => {
        const onResize = (): void => {
          setSize({ columns: inkStdout.columns ?? 60, rows: inkStdout.rows ?? 12 })
        }
        inkStdout.on('resize', onResize)
        return () => {
          inkStdout.off('resize', onResize)
        }
      }, [inkStdout])
      const width = Math.max(1, (size.columns ?? 60) - 1)
      const rows = Math.max(3, size.rows ?? 12)
      return createElement(
        Box,
        { flexDirection: 'column', height: rows, width },
        createElement(Text, null, `header ${'A'.repeat(Math.max(1, width - 8))}`),
        ...Array.from({ length: Math.max(1, rows - 2) }, (_, index) => (
          createElement(Text, { key: index }, `body-${index} ${'x'.repeat(Math.max(1, width - 12))}`)
        )),
        createElement(Text, null, 'permission workspace write'),
      )
    }
    const instance = render(createElement(Screen), {
      stdout: stdout as never,
      stdin: fakeStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      incrementalRendering: true,
      windowsFullscreenDiff: true,
      maxFps: 1000,
    })
    try {
      await delay(80)
      const before = chunks.join('')
      expect(before).toContain('permission workspace write')
      stdout.columns = 24
      stdout.rows = 10
      terminal.resize(24, 10)
      stdout.emit('resize')
      await delay(320)
      const after = chunks.join('').slice(before.length)
      expect(after.includes('\u001B[2J')).toBe(true)
      await new Promise<void>((resolve) => { terminal.write('', resolve) })
      const lines = Array.from({ length: 10 }, (_, index) => (
        terminal.buffer.active.getLine(index)?.translateToString(true) ?? ''
      ))
      expect(lines.some(line => line.includes('permission'))).toBe(true)
      expect(lines.filter(line => line.includes('permission')).length).toBe(1)
      expect(lines.filter(line => line.includes('header')).length).toBeLessThanOrEqual(1)
      expect(lines.some(line => line.includes('header') || line.includes('body-'))).toBe(true)
    } finally {
      instance.unmount()
    }
  })

  it('rewrites a same-size one-line change with absolute CUP so chrome cannot duplicate', async () => {
    const chunks: string[] = []
    const terminal = new xtermHeadless.Terminal({ cols: 40, rows: 8, allowProposedApi: true, convertEol: true })
    const stdout = new EventEmitter() as FakeStdout
    stdout.columns = 40
    stdout.rows = 8
    stdout.isTTY = true
    stdout.write = (chunk: string): boolean => {
      const text = String(chunk)
      chunks.push(text)
      terminal.write(text)
      return true
    }
    let bump: ((value: string) => void) | undefined
    function Screen(): ReactElement {
      const [label, setLabel] = useState('first')
      useEffect(() => {
        bump = setLabel
      }, [])
      return createElement(
        Box,
        { flexDirection: 'column', height: 8, width: 39 },
        createElement(Text, null, `header ${label}`),
        ...Array.from({ length: 6 }, (_, index) => createElement(Text, { key: index }, `body-${index} 代码开发`)),
        createElement(Text, null, 'permission workspace write'),
      )
    }
    const instance = render(createElement(Screen), {
      stdout: stdout as never,
      stdin: fakeStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      incrementalRendering: true,
      windowsFullscreenDiff: true,
      maxFps: 1000,
    })
    try {
      await delay(80)
      const before = chunks.length
      bump?.('second')
      await delay(80)
      await new Promise<void>((resolve) => { terminal.write('', resolve) })
      const painted = Array.from({ length: 8 }, (_, index) => (
        terminal.buffer.active.getLine(index)?.translateToString(true) ?? ''
      ))
      expect(painted.filter(line => line.includes('header')).length).toBe(1)
      expect(painted.filter(line => line.includes('permission')).length).toBe(1)
      expect(painted.some(line => line.includes('second'))).toBe(true)
      const delta = chunks.slice(before).join('')
      expect(delta).toMatch(/\u001B\[1;\d+H/)
      expect(delta.includes('\u001B[J')).toBe(false)
      expect(delta.includes('body-0 代码开发')).toBe(false)
    } finally {
      instance.unmount()
    }
  })
})
