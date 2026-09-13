/**
 * The first-load welcome banner: immutable half-block DeepSeek whale art
 * over a compact `DEEPSEEK HARNESS` wordmark. The fixed-cell canvas centers
 * as one object and degrades instead of wrapping in a narrow or short
 * terminal.
 * @module @deepseek-ai/dsh-tui/src/welcome-banner
 */

import stringWidth from 'string-width'
import { WHALE_PIXELS } from './whale-pixels'

/** DeepSeek brand blue shared by the whale and wordmark. */
export const WHALE_COLOR = '#4D6BFE'

/** The wordmark uses spaced terminal letters from the reference banner. */
export const TITLE_TEXT = 'D E E P S E E K  H A R N E S S'

/** The wordmark color. */
export const TITLE_MAIN_COLOR = WHALE_COLOR

/** One colored segment of a banner row. */
export interface BannerRun {
  text: string
  color: string
  backgroundColor?: string
  exactColor?: boolean
}

/** One precomputed banner row. */
export interface BannerRow {
  runs: BannerRun[]
  /** The row's cell width for centering. */
  width: number
}

/** Precompute glyph runs once; outside pixels retain the terminal background. */
export const WHALE_ROWS: readonly BannerRow[] = Object.freeze(Array.from({ length: WHALE_PIXELS.length / 2 }, (_, y) => {
  const runs: BannerRun[] = []
  const color = (pixel: string) => pixel
  for (let x = 0; x < 52; x++) {
    const top = WHALE_PIXELS[y * 2]![x]!
    const bottom = WHALE_PIXELS[y * 2 + 1]![x]!
    const run: BannerRun = top === '.' && bottom === '.'
      ? { text: ' ', color: WHALE_COLOR, exactColor: true }
      : top === bottom ? { text: '█', color: color(top), exactColor: true }
        : top === '.' ? { text: '▄', color: color(bottom), exactColor: true }
          : bottom === '.' ? { text: '▀', color: color(top), exactColor: true }
            : { text: '▀', color: color(top), backgroundColor: color(bottom), exactColor: true }
    const previous = runs.at(-1)
    if (previous?.color === run.color && previous.backgroundColor === run.backgroundColor) previous.text += run.text
    else runs.push(run)
  }
  return { runs, width: 52 }
}))
export const WHALE_ART: readonly string[] = Object.freeze(WHALE_ROWS.map(row => row.runs.map(run => run.text).join('')))
export const WHALE_ART_RAW = WHALE_ART.join('\n')

/** The precomputed single-row `DEEPSEEK HARNESS` wordmark. */
export const TITLE_ROWS: readonly BannerRow[] = Object.freeze([{
  runs: [{ text: TITLE_TEXT, color: TITLE_MAIN_COLOR }],
  width: stringWidth(TITLE_TEXT),
}])

/** The fixed whale canvas width in terminal cells. */
export const WHALE_WIDTH: number = 52

/** The title width in terminal cells. */
export const TITLE_WIDTH: number = TITLE_ROWS[0]?.width ?? 0

/** The full banner height: whale and wordmark. */
export const BANNER_HEIGHT: number = WHALE_ART.length + TITLE_ROWS.length

/**
 * Center one banner row in the content width, folding the left pad into the
 * first run so color segments stay intact.
 * @param runs - the row's colored segments.
 * @param rowWidth - the row's cell width.
 * @param contentWidth - the available cells.
 * @returns the centered runs.
 */
function centerRow(runs: readonly BannerRun[], rowWidth: number, contentWidth: number): BannerRun[] {
  const pad = Math.max(0, Math.floor((contentWidth - rowWidth) / 2))
  const first = runs[0]
  if (first === undefined) return [{ text: ' '.repeat(pad), color: '' }]
  return [{ text: ' '.repeat(pad), color: '' }, ...runs]
}

/** One rendered banner line entering the transcript. */
export interface WelcomeBannerLine {
  text: string
  color?: string
  runs?: BannerRun[]
}

/**
 * Append the whale with one shared canvas offset. Per-row centering would
 * move trimmed right edges independently and deform the silhouette.
 * @param lines - destination banner lines.
 * @param contentWidth - the available cells.
 */
function appendWhale(lines: WelcomeBannerLine[], contentWidth: number): void {
  const pad = Math.max(0, Math.floor((contentWidth - WHALE_WIDTH) / 2))
  for (const row of WHALE_ROWS) {
    const runs = [{ text: ' '.repeat(pad), color: '' }, ...row.runs]
    lines.push({ text: runs.map(run => run.text).join(''), runs })
  }
}

/**
 * Compose the welcome banner for one viewport. A constrained viewport drops
 * the wordmark first, then the whale, before the renderer selects the plain
 * welcome card.
 * @param contentWidth - available cells.
 * @param height - available rows.
 * @returns the banner lines, or an empty list when the art does not fit.
 */
export function welcomeBanner(contentWidth: number, height: number): WelcomeBannerLine[] {
  const lines: WelcomeBannerLine[] = []
  const requiredWidth = Math.max(WHALE_WIDTH, TITLE_WIDTH) + 4
  if (contentWidth >= requiredWidth && height >= BANNER_HEIGHT) {
    appendWhale(lines, contentWidth)
    for (const row of TITLE_ROWS) lines.push({ text: '', runs: centerRow(row.runs, row.width, contentWidth) })
    return lines
  }
  if (contentWidth >= WHALE_WIDTH + 4 && height >= WHALE_ART.length) {
    appendWhale(lines, contentWidth)
    return lines
  }
  return []
}
