import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import {
  BANNER_HEIGHT, TITLE_MAIN_COLOR, TITLE_ROWS, TITLE_TEXT, TITLE_WIDTH, WHALE_ART, WHALE_ART_RAW, WHALE_COLOR, WHALE_WIDTH,
  welcomeBanner,
} from '../src/welcome-banner'

describe('whale art literal', () => {
  it('keeps the verbatim 52-by-19 whale silhouette', () => {
    expect(WHALE_ART).toHaveLength(19)
    expect(WHALE_ART[0]).toBe('                      ▄▄▄▄▄▄       ▄█')
    expect(WHALE_ART[18]).toBe('              ▀▀▀███████▀▀▀▀')
    // Distinctive features: the raised tail, open mouth, eye notch, lower
    // flipper, and rounded belly remain separate at terminal-cell scale.
    expect(WHALE_ART[2]).toContain('███████▄  ▄▄▄▄▄███')
    expect(WHALE_ART[7]).toContain('███        ▀▀█████████████▀▀▀')
    expect(WHALE_ART[8]).toContain('▀████████████▄ ▀███████████')
    expect(WHALE_ART[13]).toContain('██████        ▄▄')
    expect(WHALE_ART[16]).toContain('██████████████████▄▄▄███████████')
  })

  it('stores the art as one raw multi-line string without tabs, trailing spaces, or wrapping', () => {
    expect(WHALE_ART_RAW.split('\n')).toHaveLength(19)
    for (const line of WHALE_ART_RAW.split('\n')) {
      expect(line).not.toContain('\t')
      expect(line).toBe(line.trimEnd())
    }
  })

  it('uses only solid and half blocks so filled edges never become Braille dots', () => {
    expect(WHALE_ART_RAW).toContain('█')
    expect(WHALE_ART_RAW).toContain('▄')
    expect(WHALE_ART_RAW).toContain('▀')
    expect(WHALE_ART_RAW).not.toMatch(/[\u2800-\u28ff]/u)
    for (const line of WHALE_ART) {
      for (const character of line) {
        expect(character === ' ' || '█▄▀'.includes(character)).toBe(true)
        expect(stringWidth(character)).toBe(1)
      }
    }
  })

  it('precomputes a frozen, bounded terminal-cell layout', () => {
    expect(Object.isFrozen(WHALE_ART)).toBe(true)
    expect(WHALE_WIDTH).toBe(52)
    expect(Math.max(...WHALE_ART.map(line => stringWidth(line)))).toBe(WHALE_WIDTH)
    for (const line of WHALE_ART) {
      expect(stringWidth(line)).toBeLessThanOrEqual(WHALE_WIDTH)
    }
  })
})

describe('wordmark', () => {
  it('precomputes one compact brand-blue title row', () => {
    expect(TITLE_TEXT).toBe('D E E P S E E K  H A R N E S S')
    expect(TITLE_ROWS).toHaveLength(1)
    expect(TITLE_WIDTH).toBe(stringWidth(TITLE_TEXT))
    expect(TITLE_ROWS[0]).toEqual({
      runs: [{ text: TITLE_TEXT, color: TITLE_MAIN_COLOR }],
      width: TITLE_WIDTH,
    })
    expect(TITLE_MAIN_COLOR).toBe(WHALE_COLOR)
  })
})

describe('welcomeBanner layout', () => {
  it('renders whale + title when the viewport fits both, without a wrap', () => {
    const banner = welcomeBanner(98, BANNER_HEIGHT)
    expect(banner).toHaveLength(BANNER_HEIGHT)
    expect(banner[0]?.color).toBe(WHALE_COLOR)
    expect(banner[0]?.text.trim()).toBe(WHALE_ART[0]?.trim())
    const titleRow = banner[WHALE_ART.length]
    expect(titleRow?.runs?.[0]?.text.trimStart()).toBe(TITLE_TEXT)
    // Every row shares the canvas offset. Centering the trimmed rows one by
    // one would move the tail, mouth, and belly relative to each other.
    const pad = Math.floor((98 - WHALE_WIDTH) / 2)
    for (const [index, art] of WHALE_ART.entries()) {
      expect(banner[index]?.text).toBe(`${' '.repeat(pad)}${art}`)
    }
  })

  it('degrades to the whale only when the height is too short for the title', () => {
    const banner = welcomeBanner(98, WHALE_ART.length)
    expect(banner).toHaveLength(WHALE_ART.length)
    expect(banner.some(line => line.runs !== undefined)).toBe(false)
  })

  it('degrades to nothing when the width cannot hold the art (never wraps)', () => {
    expect(welcomeBanner(20, 30)).toEqual([])
  })
})
