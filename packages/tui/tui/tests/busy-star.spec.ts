import { describe, expect, it } from 'vitest'
import { BUSY_STAR_FRAMES, busyStarFrame } from '../src/busy-star'
import { themed, thinkingShimmerColor, thinkingShimmerLevel } from '../src/render'
import stringWidth from 'string-width'

describe('busyStarFrame', () => {
  it('cycles Claude Code stars at one cell each without changing hue', () => {
    expect(BUSY_STAR_FRAMES).toEqual(['✶', '✸', '✹', '✺', '✹', '✸'])
    for (const glyph of BUSY_STAR_FRAMES) expect(stringWidth(glyph)).toBe(1)
    expect(busyStarFrame(-1).glyph).toBe('✶')
    expect(busyStarFrame(0).glyph).toBe('✶')
    expect(busyStarFrame(2).glyph).toBe('✹')
    expect(busyStarFrame(6).glyph).toBe(busyStarFrame(0).glyph)
    expect(busyStarFrame(0).color).toBe('yellow')
    expect(busyStarFrame(2).color).toBe('yellow')
  })
})

describe('thinkingShimmerLevel', () => {
  it('sweeps a gray-to-bright band across the label', () => {
    const length = 10
    const at0 = Array.from({ length }, (_, index) => thinkingShimmerLevel(index, 0, length))
    expect(at0[0]).toBeGreaterThan(at0[5] ?? 0)
    expect(thinkingShimmerLevel(9, 0, length)).toBe(145)
    const centerPhase = 4
    const band = Array.from({ length: 11 }, (_, index) => thinkingShimmerLevel(index - 5, centerPhase, length))
    expect(band[0]).toBe(145)
    expect(band[2] ?? 0).toBeGreaterThan(band[0] ?? 0)
    expect(band[5]).toBe(255)
    expect(band[8] ?? 0).toBeGreaterThan(band[10] ?? 0)
    expect(band[10]).toBe(145)
    expect(thinkingShimmerColor(145)).toBe('gray')
    expect(thinkingShimmerColor(255)).toBe('whiteBright')
    const peakAt = (phase: number): number => {
      let best = 0
      for (let index = 0; index < length; index += 1) {
        if (thinkingShimmerLevel(index, phase, length) >= thinkingShimmerLevel(best, phase, length)) best = index
      }
      return best
    }
    expect(peakAt(4)).toBeLessThan(peakAt(10))
  })
})

describe('themed', () => {
  it('keeps chrome muted, body bright, and never emits black or hex', () => {
    expect(themed('white', 'dark', 'white')).toBe('whiteBright')
    expect(themed('cyan', 'dark', 'cyan')).toBe('cyan')
    expect(themed('gray', 'dark', 'gray')).toBe('gray')
    expect(themed('blue', 'dark', 'blue')).toBe('blue')
    expect(themed('black', 'dark', 'white')).toBe('whiteBright')
    expect(themed('#c8c8c8', 'dark', 'white')).toBe('whiteBright')
    expect(themed('#c8c8c8', 'light', 'white')).toBe('blue')
    expect(themed('#2B3A66', 'dark', 'white')).toBe('blue')
    expect(themed('#2B3A66', 'light', 'white')).toBe('blue')
    expect(themed('#4D6BFE', 'dark', 'white')).toBe('blueBright')
    expect(themed('#1a1a1a', 'dark', 'white')).toBe('whiteBright')
    expect(themed('#ffffff', 'dark', 'white')).toBe('whiteBright')
    expect(themed('#4D6BFE', 'light', 'white')).toBe('blue')
    expect(themed('#gg', 'dark', 'white')).toBe('whiteBright')
    expect(themed('', 'dark', 'cyan')).toBe('cyan')
    expect(themed('orange', 'dark', 'white')).toBe('whiteBright')
    expect(themed('orange', 'light', 'white')).toBe('blue')
    expect(themed('grey', 'dark', 'white')).toBe('gray')
    expect(themed(undefined, 'dark', 'white')).toBe('whiteBright')
    expect(themed('white', 'light', 'white')).toBe('blue')
    expect(themed('cyan', 'light', 'cyan')).toBe('blue')
    expect(themed('black', 'light', 'white')).toBe('blue')
    expect(themed('#000000', 'light', 'white')).toBe('blue')
    for (const value of [
      themed('white', 'dark', 'white'),
      themed('black', 'dark', 'white'),
      themed('#c8c8c8', 'dark', 'white'),
      themed('#2B3A66', 'light', 'white'),
    ]) {
      expect(value.startsWith('#')).toBe(false)
      expect(value).not.toBe('black')
    }
  })
})
