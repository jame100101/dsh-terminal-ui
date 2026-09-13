import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import {
  BANNER_HEIGHT, TITLE_MAIN_COLOR, TITLE_ROWS, TITLE_TEXT, TITLE_WIDTH, WHALE_ART, WHALE_ART_RAW, WHALE_COLOR, WHALE_WIDTH,
  welcomeBanner,
} from '../src/welcome-banner'

describe('white-interior whale', () => {
  it('keeps a fixed 52-column, 20-row half-cell canvas with explicit white regions', () => {
    expect(WHALE_ART).toHaveLength(20)
    expect(Object.isFrozen(WHALE_ART)).toBe(true)
    for (const row of WHALE_ART) {
      expect(stringWidth(row)).toBe(52)
      expect(row).toMatch(/^[ █▄▀]+$/u)
    }
    const rows = welcomeBanner(56, 20)
    expect(rows.flatMap(row => row.runs ?? []).some(run => run.color === '#FFFFFF')).toBe(true)
    expect(rows.flatMap(row => row.runs ?? []).some(run => run.backgroundColor === '#FFFFFF')).toBe(true)
    // Centering pads never paint a rectangle over the terminal theme.
    expect(rows.every(row => row.runs?.[0]?.backgroundColor === undefined)).toBe(true)
    expect(WHALE_ART_RAW.split('\n')).toEqual(WHALE_ART)
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
    expect(banner[0]?.runs?.some(run => run.color === WHALE_COLOR)).toBe(true)
    expect(banner[0]?.text.trim()).toBe(WHALE_ART[0]?.trim())
    const titleRow = banner[WHALE_ART.length]
    expect(titleRow?.runs?.map(run => run.text).join('').trimStart()).toBe(TITLE_TEXT)
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
    expect(banner.every(line => line.runs !== undefined)).toBe(true)
  })

  it('degrades to nothing when the width cannot hold the art (never wraps)', () => {
    expect(welcomeBanner(20, 30)).toEqual([])
  })
})
