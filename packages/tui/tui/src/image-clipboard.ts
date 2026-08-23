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
            '-e', 'set pngData to the clipboard as «class PNGf»',
            '-e', 'set outputFile to open for access POSIX file "/dev/stdout" with write permission',
            '-e', 'write pngData to outputFile',
            '-e', 'close access outputFile',
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

function readBytes(command: string, args: readonly string[], spawnImpl: ClipboardImageSpawn): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (bytes: Uint8Array | null): void => {
      if (settled) return
      settled = true
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
    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.once('error', () => {
      settle(null)
    })
    child.once('close', (code) => {
      if (code !== 0) {
        settle(null)
        return
      }
      settle(Buffer.concat(chunks))
    })
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
): Promise<ClipboardImage | null> {
  for (const entry of clipboardImageCommands(platform)) {
    const bytes = await readBytes(entry.command, entry.args, spawnImpl)
    if (bytes === null || bytes.byteLength === 0) continue
    const mediaType = sniffMediaType(bytes)
    if (mediaType === undefined) continue
    return { data: bytes, mediaType, name: `clipboard.${mediaType.split('/')[1] === 'jpeg' ? 'jpg' : mediaType.split('/')[1]}` }
  }
  return null
}
