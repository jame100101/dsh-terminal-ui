import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brandGlyph, scrollbarCellStyle } from '../src/render'

const require = createRequire(import.meta.url)
const inkRoot = dirname(dirname(require.resolve('ink')))
const { default: Output } = await import(pathToFileURL(join(inkRoot, 'build/output.js')).href)

/** Exercise the packaged serializer, not a duplicate implementation. */
function serialize(platform: string, marker: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
    const output = new Output({ width: 6, height: 1 })
    output.write(0, 0, 'ab', { transformers: [] })
    output.write(4, 0, marker, { transformers: [] })
    return output.get().output
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

describe('anchored scrollbar cell fill', () => {
  it.each(['win32', 'linux'])('keeps the original track and thumb styles on %s in both themes', platform => {
    expect(scrollbarCellStyle(false, 'dark', platform)).toEqual({ dimColor: true })
    expect(scrollbarCellStyle(false, 'light', platform)).toEqual({ dimColor: true })
    expect(scrollbarCellStyle(true, 'dark', platform)).toEqual({ dimColor: false, color: 'cyan' })
    expect(scrollbarCellStyle(true, 'light', platform)).toEqual({ dimColor: false, color: 'blue' })
  })

  it('limits background fill to macOS and preserves the existing small header brand', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const thumb of [false, true]) {
        const style = scrollbarCellStyle(thumb, theme, 'darwin')
        expect(style.backgroundColor).toBe(style.color)
        expect(style.backgroundColor).toBeDefined()
      }
    }
    expect(brandGlyph({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('✦')
    expect(brandGlyph({ TERM: 'xterm-256color' })).toBe('🐋')
    expect(brandGlyph({ WT_SESSION: 'windows-terminal' })).toBe('🐋')
  })

  it.each(['win32', 'linux'])('preserves the exact existing colored output on %s', platform => {
    expect(serialize(platform, '\x1b[46m\uE000\x1b[49m'))
      .toBe('ab\x1b[5G\x1b[46m█\x1b[49m')
  })

  it.each(['46', '48;5;244', '48;2;128;128;128'])('paints a glyph-free macOS cell for SGR %s', background => {
    expect(serialize('darwin', `\x1b[${background}m\uE000\x1b[49m`))
      .toBe(`ab\x1b[5G\x1b[${background}m \x1b[49m`)
  })

  it.each(['darwin', 'win32', 'linux'])('keeps a visible monochrome fallback on %s', platform => {
    expect(serialize(platform, '\uE000')).toBe('ab\x1b[5G█')
    expect(serialize(platform, '\x1b[36m\uE000\x1b[39m'))
      .toBe('ab\x1b[5G\x1b[36m█\x1b[39m')
    // Real block glyphs in the whale or transcript are never rewritten.
    expect(serialize(platform, '\x1b[46m█\x1b[49m'))
      .toBe('ab  \x1b[46m█\x1b[49m')
  })
})
