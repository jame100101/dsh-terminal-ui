import { execFileSync } from 'node:child_process'
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
    expect(clipboardImageCommands('darwin').map(entry => entry.command)).toEqual(['pngpaste', 'osascript'])
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


it.skipIf(process.platform !== 'darwin')('reads a TIFF screenshot through native AppKit without touching the general clipboard', () => {
  const entry = clipboardImageCommands('darwin').find(item => item.command === 'osascript')!
  const script = entry.args.at(-1)!.replace('$.NSPasteboard.generalPasteboard', 'board')
  const seed = [
    "ObjC.import('AppKit')",
    'const board = $.NSPasteboard.pasteboardWithUniqueName',
    "const data = $.NSData.alloc.initWithBase64EncodedStringOptions('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=', 0)",
    'const seed = $.NSImage.alloc.initWithData(data)',
    'board.clearContents',
    'board.setDataForType(seed.TIFFRepresentation, $.NSPasteboardTypeTIFF)',
  ].join('; ')
  const output = execFileSync('osascript', ['-l', 'JavaScript', '-e', `${seed}; try { ${script} } finally { board.releaseGlobally }`], { timeout: 5000 })
  expect([...output.subarray(0, 8)]).toEqual([...PNG.subarray(0, 8)])
  expect(output.readUInt32BE(16)).toBe(2)
  expect(output.readUInt32BE(20)).toBe(2)
})

it('bounds clipboard output and cancels a stalled reader', async () => {
  expect(await readClipboardImage(fakeSpawn(PNG), 'linux', { maxBytes: 4 })).toBeNull()
  let killed = 0
  const stalled = (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void }
    child.stdout = new EventEmitter()
    child.kill = () => { killed++ }
    return child
  }) as unknown as ClipboardImageSpawn
  expect(await readClipboardImage(stalled, 'linux', { timeoutMs: 5 })).toBeNull()
  expect(killed).toBe(2)
  const controller = new AbortController()
  const pending = readClipboardImage(stalled, 'darwin', { signal: controller.signal })
  controller.abort()
  expect(await pending).toBeNull()
  expect(killed).toBe(3)
})
