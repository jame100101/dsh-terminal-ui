/**
 * Read a bitmap from the desktop clipboard. Windows Terminal's Ctrl+V drops
 * images, so the TUI uses Alt+V on win32 (Grok's mapping). macOS/Linux use
 * the same tools as a file-manager "copy image".
 * @module @deepseek-ai/dsh-tui/src/image-clipboard
 */

import { spawn } from 'node:child_process'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { sniffMediaType } from './image-intake'

/** Bytes plus a sniffed media type from the clipboard. */
export interface ClipboardImage {
  data: Uint8Array
  mediaType: ImageMediaType
  name: string
}

/** One clipboard command tried in order. */
export interface ClipboardImageCommand {
  command: string
  args: readonly string[]
}

/** Injectable spawn used by tests. */
export type ClipboardImageSpawn = typeof spawn

/**
 * Platform clipboard commands that print image bytes to stdout.
 * @param platform - `process.platform`.
 * @returns commands to try, in order.
 */
export function clipboardImageCommands(platform: NodeJS.Platform = process.platform): readonly ClipboardImageCommand[] {
  switch (platform) {
    case 'win32':
      return [{
        command: 'powershell',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-Command',
          [
            'Add-Type -AssemblyName System.Windows.Forms',
            'Add-Type -AssemblyName System.Drawing',
            '$img = [System.Windows.Forms.Clipboard]::GetImage()',
            'if ($null -eq $img) { exit 1 }',
            '$ms = New-Object System.IO.MemoryStream',
            '$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
            '[Console]::OpenStandardOutput().Write($ms.ToArray(), 0, $ms.Length)',
          ].join('; '),
        ],
      }]
    case 'darwin':
      return [
        { command: 'pngpaste', args: ['-'] },
        {
          command: 'osascript',
          args: [
            '-l', 'JavaScript', '-e', [
              "ObjC.import('AppKit')",
              'const image = $.NSImage.alloc.initWithPasteboard($.NSPasteboard.generalPasteboard)',
              "if (image.isNil()) throw new Error('No clipboard image')",
              'const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation)',
              'const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}))',
              '$.NSFileHandle.fileHandleWithStandardOutput.writeData(png)',
            ].join('; '),
          ],
        },
      ]
    case 'linux': {
      const wayland = process.env.WAYLAND_DISPLAY !== undefined && process.env.WAYLAND_DISPLAY !== ''
      const wl: ClipboardImageCommand = { command: 'wl-paste', args: ['--type', 'image/png', '-n'] }
      const xclip: ClipboardImageCommand = {
        command: 'xclip',
        args: ['-selection', 'clipboard', '-t', 'image/png', '-o'],
      }
      return wayland ? [wl, xclip] : [xclip, wl]
    }
    default:
      return []
  }
}

/** Limits apply before the official attachment service admits the image. */
export interface ClipboardReadOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
}

function readBytes(command: string, args: readonly string[], spawnImpl: ClipboardImageSpawn, options: ClipboardReadOptions): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = (): void => { settle(null); child?.kill?.() }
    const settle = (bytes: Uint8Array | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', cancel)
      resolve(bytes)
    }
    let child: ReturnType<ClipboardImageSpawn>
    try {
      child = spawnImpl(command, [...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      settle(null)
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      total += chunk.byteLength
      if (total > (options.maxBytes ?? 32 * 1024 * 1024)) { cancel(); return }
      chunks.push(chunk)
    })
    child.once('error', () => {
      settle(null)
    })
    child.once('close', (code) => {
      if (settled) return
      if (code !== 0) {
        settle(null)
        return
      }
      settle(Buffer.concat(chunks))
    })
    if (options.signal?.aborted) { cancel(); return }
    options.signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(cancel, options.timeoutMs ?? 4000)
  })
}

/**
 * Read one clipboard bitmap. Never throws.
 * @param spawnImpl - spawn function (real `spawn` in production).
 * @param platform - override for tests.
 * @returns PNG/JPEG/GIF/WebP bytes, or null.
 */
export async function readClipboardImage(
  spawnImpl: ClipboardImageSpawn = spawn,
  platform: NodeJS.Platform = process.platform,
  options: ClipboardReadOptions = {},
): Promise<ClipboardImage | null> {
  for (const entry of clipboardImageCommands(platform)) {
    if (options.signal?.aborted) return null
    const bytes = await readBytes(entry.command, entry.args, spawnImpl, options)
    if (bytes === null || bytes.byteLength === 0) continue
    const mediaType = sniffMediaType(bytes)
    if (mediaType === undefined) continue
    return { data: bytes, mediaType, name: `clipboard.${mediaType.split('/')[1] === 'jpeg' ? 'jpg' : mediaType.split('/')[1]}` }
  }
  return null
}
