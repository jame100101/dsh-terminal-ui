/**
 * Grok-style `[Image #N]` chips and Web-style batch admission for TUI image
 * intake. The session log and `attachments.saveImage` remain the durable
 * record; this module only classifies paste text and checks limits.
 * @module @deepseek-ai/dsh-tui/src/image-intake
 */

import { extname } from 'node:path'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Chip token matching Grok's path-free `[Image #N]` labels. */
export const IMAGE_CHIP_RE = /\[Image #(\d+)\]/gu

/** Extensions the TUI treats as image files. */
const IMAGE_EXT: Readonly<Record<string, ImageMediaType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Limits copied from the attachment-local defaults for tests and fallbacks. */
export interface ImageIntakeLimits {
  maxImagesPerMessage: number
  maxImageBytes: number
  maxMessageImageBytes: number
  mediaTypes: readonly string[]
}

/** Why a batch must not enter the rail (Web filter order). */
export type ImageIntakeRejection =
  | { code: 'unsupported-type' }
  | { code: 'too-many'; max: number }
  | { code: 'file-too-large'; max: number }
  | { code: 'total-too-large'; max: number }

/** One pasted path that should become a chip or an absolute-path insert. */
export type PastedPath =
  | { kind: 'image'; path: string; mediaType: ImageMediaType }
  | { kind: 'file'; path: string }

/**
 * Build the Grok chip for a 0-based attachment index.
 * @param index - index in the pending list.
 * @returns `[Image #N]`.
 */
export function imageChip(index: number): string {
  return `[Image #${index + 1}]`
}

/**
 * Count `[Image #N]` tokens in a draft.
 * @param draft - composer text.
 * @returns chip count.
 */
export function countImageChips(draft: string): number {
  return [...draft.matchAll(IMAGE_CHIP_RE)].length
}

/**
 * The chip label to insert for the next pending image.
 * @param draft - composer text.
 * @returns the next `[Image #N]`.
 */
export function nextImageChip(draft: string): string {
  return imageChip(countImageChips(draft))
}

/**
 * Insert the next image chip at `caret`.
 * @param draft - composer text.
 * @param caret - insertion offset in UTF-16 units.
 * @returns the new draft, caret, and chip text.
 */
export function insertImageChip(draft: string, caret: number): { draft: string; caret: number; chip: string } {
  const chip = nextImageChip(draft)
  const at = Math.max(0, Math.min(draft.length, caret))
  const prefix = draft.slice(0, at)
  const suffix = draft.slice(at)
  const padLeft = prefix === '' || prefix.endsWith(' ') ? '' : ' '
  const padRight = suffix.startsWith(' ') || suffix === '' ? '' : ' '
  const inserted = `${padLeft}${chip}${padRight}`
  return { draft: `${prefix}${inserted}${suffix}`, caret: prefix.length + inserted.length, chip }
}

/**
 * Remove chip tokens, collapsing leftover whitespace.
 * @param draft - composer text.
 * @returns prose sent to the model.
 */
export function stripImageChips(draft: string): string {
  return draft.replace(IMAGE_CHIP_RE, ' ').replace(/[ \t]+/gu, ' ').replace(/ *\n */gu, '\n').trim()
}

/**
 * 0-based attachment indices named by chips, in draft order.
 * @param draft - composer text.
 * @returns indices (invalid numbers are dropped).
 */
export function chipIndices(draft: string): number[] {
  const out: number[] = []
  for (const match of draft.matchAll(IMAGE_CHIP_RE)) {
    const index = Number(match[1]) - 1
    if (Number.isInteger(index) && index >= 0) out.push(index)
  }
  return out
}

/**
 * Keep attachments named by the draft and renumber chips 1..n.
 * @param draft - composer text.
 * @param attachments - pending refs in chip-number order.
 * @returns compacted draft and the kept refs.
 */
export function keepAttachmentsByChips<T>(
  draft: string,
  attachments: readonly T[],
): { draft: string; attachments: T[] } {
  const kept: T[] = []
  const seen = new Set<number>()
  const compacted = draft.replace(IMAGE_CHIP_RE, (_full, raw: string) => {
    const index = Number(raw) - 1
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) return ''
    const item = attachments[index]
    if (item === undefined) return ''
    seen.add(index)
    const chip = imageChip(kept.length)
    kept.push(item)
    return chip
  })
  return { draft: compacted, attachments: kept }
}

/**
 * Resolve which pending images a submit should send. A draft with no chips
 * keeps the `/attach` dock list; a draft with chips keeps only named refs.
 * @param draft - composer text.
 * @param attachments - pending refs.
 * @returns refs to send.
 */
export function attachmentsForSubmit<T>(draft: string, attachments: readonly T[]): T[] {
  if (countImageChips(draft) === 0) return [...attachments]
  return keepAttachmentsByChips(draft, attachments).attachments
}

/**
 * Sniff PNG/JPEG/GIF/WebP from magic bytes.
 * @param bytes - file contents.
 * @returns a media type, or undefined.
 */
export function sniffMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
    && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif'
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}

/**
 * Map a filesystem path's extension to an image media type.
 * @param filePath - a path or filename.
 * @returns a media type, or undefined.
 */
export function mediaTypeFromPath(filePath: string): ImageMediaType | undefined {
  const ext = extname(filePath).slice(1).toLowerCase()
  return IMAGE_EXT[ext]
}

/**
 * Strip quotes, `file://`, and a single wrapping newline from pasted text.
 * @param text - clipboard or terminal-drag text.
 * @returns a path candidate, or null.
 */
export function normalizePastedPath(text: string): string | null {
  const lines = text.split(/\r?\n/u).map(line => line.trim()).filter(line => line !== '')
  if (lines.length !== 1) return null
  const [firstLine] = lines
  if (firstLine === undefined) return null
  let value = firstLine
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1)
  }
  if (value.startsWith('file://')) {
    try {
      value = decodeURIComponent(value.slice('file://'.length))
    } catch {
      return null
    }
    if (/^\/[A-Za-z]:/u.test(value)) value = value.slice(1)
  }
  return value === '' ? null : value
}

/**
 * Classify a paste as an image path, a non-image file path, or neither.
 * @param text - clipboard or terminal-drag text.
 * @returns the classification, or null when the paste is ordinary prose.
 */
export function classifyPastedPath(text: string): PastedPath | null {
  const filePath = normalizePastedPath(text)
  if (filePath === null) return null
  const mediaType = mediaTypeFromPath(filePath)
  if (mediaType !== undefined) return { kind: 'image', path: filePath, mediaType }
  const looksLikePath = /[\\/]/u.test(filePath) || /^[A-Za-z]:/u.test(filePath)
  return looksLikePath ? { kind: 'file', path: filePath } : null
}

/**
 * Web DeepSeek Chat admission order: format, count, per-file size, total size.
 * @param existingCount - chips already in the rail.
 * @param existingBytes - sum of their encoded sizes.
 * @param incoming - the candidate batch.
 * @param limits - attachment-store limits.
 * @returns a rejection, or null when the batch may enter.
 */
export function rejectImageBatch(
  existingCount: number,
  existingBytes: number,
  incoming: readonly { bytes: number; mediaType: string }[],
  limits: ImageIntakeLimits,
): ImageIntakeRejection | null {
  if (incoming.some(item => !limits.mediaTypes.includes(item.mediaType))) {
    return { code: 'unsupported-type' }
  }
  if (existingCount + incoming.length > limits.maxImagesPerMessage) {
    return { code: 'too-many', max: limits.maxImagesPerMessage }
  }
  if (incoming.some(item => item.bytes > limits.maxImageBytes)) {
    return { code: 'file-too-large', max: limits.maxImageBytes }
  }
  const total = existingBytes + incoming.reduce((sum, item) => sum + item.bytes, 0)
  if (total > limits.maxMessageImageBytes) {
    return { code: 'total-too-large', max: limits.maxMessageImageBytes }
  }
  return null
}

/**
 * Format a byte count the way Web image toasts do (KB/MB).
 * @param bytes - size in bytes.
 * @returns a short label.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
