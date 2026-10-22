/** Capture-only scalar width provider. Does not alter production terminal behavior. */
import stringWidth from 'string-width'
export function useRendererUnicodeWidths(terminal) {
  terminal.unicode.register({
    version: 'dsh-display-width',
    wcwidth: code => Math.min(2, stringWidth(String.fromCodePoint(code))),
    // xterm 6: low bit joins a combining scalar; bits 1-2 contain cell width.
    charProperties(code, preceding) {
      const width = this.wcwidth(code), previousWidth = (preceding >>> 1) & 3
      return width === 0 && previousWidth > 0 ? (previousWidth << 1) | 1 : width << 1
    },
  })
  terminal.unicode.activeVersion = 'dsh-display-width'
}
