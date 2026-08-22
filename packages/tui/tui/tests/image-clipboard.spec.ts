import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { clipboardImageCommands, readClipboardImage } from '../src/image-clipboard'
import type { ClipboardImageSpawn } from '../src/image-clipboard'

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)

function fakeSpawn(payload: Uint8Array | null, exit = 0): ClipboardImageSpawn {
  return ((command: string, args: readonly string[]) => {
    void command
    void args
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
    }
    child.stdout = new EventEmitter()
    queueMicrotask(() => {
      if (payload !== null) child.stdout.emit('data', Buffer.from(payload))
      child.emit('close', exit)
    })
    return child
  }) as unknown as ClipboardImageSpawn
}

describe('clipboardImageCommands', () => {
  it('uses STA powershell on Windows and png tools elsewhere', () => {
    expect(clipboardImageCommands('win32')[0]?.command).toBe('powershell')
    expect(clipboardImageCommands('win32')[0]?.args).toContain('-STA')
    expect(clipboardImageCommands('darwin')[0]?.command).toBe('osascript')
    expect(clipboardImageCommands('linux').some(entry => entry.command === 'xclip')).toBe(true)
    expect(clipboardImageCommands('freebsd' as NodeJS.Platform)).toEqual([])
    const previous = process.env.WAYLAND_DISPLAY
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    try {
      expect(clipboardImageCommands('linux')[0]?.command).toBe('wl-paste')
    } finally {
      if (previous === undefined) delete process.env.WAYLAND_DISPLAY
      else process.env.WAYLAND_DISPLAY = previous
    }
  })
})

describe('readClipboardImage', () => {
  it('returns sniffed png bytes and skips empty or unknown payloads', async () => {
    const hit = await readClipboardImage(fakeSpawn(PNG), 'linux')
    expect(hit?.mediaType).toBe('image/png')
    expect(hit?.name).toBe('clipboard.png')
    const jpeg = await readClipboardImage(fakeSpawn(Uint8Array.of(0xff, 0xd8, 0xff, 0x00)), 'darwin')
    expect(jpeg?.name).toBe('clipboard.jpg')
    expect(await readClipboardImage(fakeSpawn(new Uint8Array()), 'linux')).toBeNull()
    expect(await readClipboardImage(fakeSpawn(null, 1), 'linux')).toBeNull()
    expect(await readClipboardImage(fakeSpawn(Uint8Array.of(0x00, 0x01)), 'linux')).toBeNull()
    const exploding: ClipboardImageSpawn = (() => {
      throw new Error('enoent')
    }) as unknown as ClipboardImageSpawn
    expect(await readClipboardImage(exploding, 'linux')).toBeNull()
    const errored: ClipboardImageSpawn = (() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter }
      child.stdout = new EventEmitter()
      queueMicrotask(() => {
        child.emit('error', new Error('gone'))
        child.emit('close', 0)
      })
      return child
    }) as unknown as ClipboardImageSpawn
    expect(await readClipboardImage(errored, 'linux')).toBeNull()
    const noStdout: ClipboardImageSpawn = (() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter | null }
      child.stdout = null
      queueMicrotask(() => {
        child.emit('close', 0)
      })
      return child
    }) as unknown as ClipboardImageSpawn
    expect(await readClipboardImage(noStdout, 'linux')).toBeNull()
  })
})
