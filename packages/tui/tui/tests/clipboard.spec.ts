import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard, copyViaOsc52 } from '../src/clipboard'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const originalPlatform = process.platform

afterEach(() => {
  vi.mocked(spawn).mockReset()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

/** A tiny writable that records bytes, standing in for the TTY stdout. */
class Capture extends Writable {
  output = ''
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += String(chunk)
    callback()
  }
}

describe('clipboard backend', () => {
  it('writes a base64 OSC 52 escape on the fallback path', () => {
    const capture = new Capture()
    const outcome = copyViaOsc52('你好 hello', capture as never)
    expect(outcome).toEqual({ ok: true, via: 'osc52' })
    const expected = `\x1b]52;c;${Buffer.from('你好 hello', 'utf8').toString('base64')}\x07`
    expect(capture.output).toBe(expected)
  })

  it('falls back to OSC 52 when no system clipboard tool exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' })
    const capture = new Capture()
    const outcome = await copyToClipboard('fallback text', capture as never)
    expect(outcome.ok).toBe(true)
    expect(outcome.via).toBe('osc52')
    expect(capture.output).toContain('\x1b]52;c;')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a combined failure instead of throwing when both backends fail', async () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' })
    const broken = new Capture()
    vi.spyOn(broken, 'write').mockImplementation(() => {
      throw new Error('write EPIPE')
    })
    const outcome = await copyToClipboard('text', broken as never)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('write EPIPE')
  })

  it('pipes user text to clipboard-tool stdin and does not exec-concat it', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const payload = 'hello "quotes" & | $ ` \' <>\n中文 🎉'
    let received = ''
    vi.mocked(spawn).mockImplementation((command, args) => {
      const child = new EventEmitter() as EventEmitter & { stdin: Writable }
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          received += String(chunk)
          callback()
        },
      })
      queueMicrotask(() => child.emit('close', 0))
      expect(command).toBe('clip')
      expect(args).toEqual([])
      return child as never
    })
    const capture = new Capture()
    const outcome = await copyToClipboard(payload, capture as never)
    expect(outcome).toEqual({ ok: true, via: 'system' })
    expect(received).toBe(payload)
    expect(capture.output).toBe('')
  })
})
