import { describe, expect, it } from 'vitest'
import {
  attachmentsForSubmit, chipIndices, classifyPastedPath, countImageChips, formatByteSize, imageChip, insertImageChip,
  keepAttachmentsByChips, mediaTypeFromPath, nextImageChip, normalizePastedPath, rejectImageBatch, sniffMediaType,
  stripImageChips,
} from '../src/image-intake'

const LIMITS = {
  maxImagesPerMessage: 2,
  maxImageBytes: 100,
  maxMessageImageBytes: 150,
  mediaTypes: ['image/png', 'image/jpeg'],
}

describe('image chips', () => {
  it('inserts numbered chips and strips them from model prose', () => {
    expect(imageChip(0)).toBe('[Image #1]')
    expect(nextImageChip('')).toBe('[Image #1]')
    const first = insertImageChip('see', 3)
    expect(first.draft).toBe('see [Image #1]')
    expect(countImageChips(first.draft)).toBe(1)
    const second = insertImageChip(first.draft, first.caret)
    expect(second.draft).toBe('see [Image #1] [Image #2]')
    expect(stripImageChips(second.draft)).toBe('see')
    expect(stripImageChips('[Image #1]')).toBe('')
  })

  it('drops missing chip numbers and renumbers the rest', () => {
    const kept = keepAttachmentsByChips('a [Image #2] b [Image #9] [Image #2]', ['x', 'y', 'z'])
    expect(kept.attachments).toEqual(['y'])
    expect(kept.draft).toBe('a [Image #1] b  ')
    expect(attachmentsForSubmit('hello', ['a', 'b'])).toEqual(['a', 'b'])
    expect(attachmentsForSubmit('see [Image #2]', ['a', 'b'])).toEqual(['b'])
  })
})

describe('paste path classification', () => {
  it('upgrades a quoted image path and a file:// URL', () => {
    expect(classifyPastedPath('"C:\\\\shots\\\\a.PNG"\n')).toEqual({
      kind: 'image', path: 'C:\\\\shots\\\\a.PNG', mediaType: 'image/png',
    })
    expect(classifyPastedPath('file:///C:/tmp/x.webp')).toEqual({
      kind: 'image', path: 'C:/tmp/x.webp', mediaType: 'image/webp',
    })
    expect(mediaTypeFromPath('/tmp/a.jpeg')).toBe('image/jpeg')
  })

  it('inserts a non-image filesystem path as a file, not a chip', () => {
    expect(classifyPastedPath('/tmp/notes.txt')).toEqual({ kind: 'file', path: '/tmp/notes.txt' })
    expect(classifyPastedPath('just words')).toBeNull()
    expect(classifyPastedPath('a\nb')).toBeNull()
    expect(classifyPastedPath('')).toBeNull()
    expect(normalizePastedPath('a\nb')).toBeNull()
    expect(normalizePastedPath("'/tmp/x.png'")).toBe('/tmp/x.png')
    expect(insertImageChip('', 0).draft).toBe('[Image #1]')
    expect(insertImageChip('ab', 1).draft).toBe('a [Image #1] b')
    expect(insertImageChip('hello world', 6).draft).toBe('hello [Image #1] world')
    expect(insertImageChip('hello world', 5).draft).toBe('hello [Image #1] world')
    expect(rejectImageBatch(0, 0, [], LIMITS)).toBeNull()
    expect(normalizePastedPath('file://%E0%A4%A')).toBeNull()
    expect(normalizePastedPath('file://')).toBeNull()
    expect(classifyPastedPath('C:readme.txt')).toEqual({ kind: 'file', path: 'C:readme.txt' })
    expect(chipIndices('[Image #1] x [Image #foo] [Image #0]')).toEqual([0])
  })
})

describe('magic-byte sniff and Web batch order', () => {
  it('sniffs png jpeg gif webp and rejects unknown', () => {
    expect(sniffMediaType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffMediaType(Uint8Array.of(0xff, 0xd8, 0xff, 0x00))).toBe('image/jpeg')
    expect(sniffMediaType(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif')
    expect(sniffMediaType(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))).toBe('image/gif')
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffMediaType(webp)).toBe('image/webp')
    expect(sniffMediaType(Uint8Array.of(0x00))).toBeUndefined()
  })

  it('refuses format before count before per-file size before total size', () => {
    expect(rejectImageBatch(0, 0, [{ bytes: 10, mediaType: 'image/gif' }], LIMITS)?.code).toBe('unsupported-type')
    expect(rejectImageBatch(2, 0, [{ bytes: 10, mediaType: 'image/png' }], LIMITS)).toEqual({ code: 'too-many', max: 2 })
    expect(rejectImageBatch(0, 0, [{ bytes: 101, mediaType: 'image/png' }], LIMITS)).toEqual({
      code: 'file-too-large', max: 100,
    })
    expect(rejectImageBatch(1, 80, [{ bytes: 80, mediaType: 'image/png' }], LIMITS)).toEqual({
      code: 'total-too-large', max: 150,
    })
    expect(rejectImageBatch(1, 40, [{ bytes: 50, mediaType: 'image/png' }], LIMITS)).toBeNull()
  })

  it('formats byte sizes for toasts', () => {
    expect(formatByteSize(12)).toBe('12 B')
    expect(formatByteSize(2048)).toBe('2.0 KB')
    expect(formatByteSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
