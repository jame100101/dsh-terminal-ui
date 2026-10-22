import { sanitizeTerminalText } from './sanitize'

/** Presentation fallback only: official tool presenters retain priority. */
export function fallbackToolLabel(name: string, args: unknown): string {
  const input = args !== null && typeof args === 'object' ? args as Record<string, unknown> : {}
  const command = typeof input.command === 'string' ? input.command : undefined
  if ((name === 'bash' || name === 'shell') && command) {
    const lines = sanitizeTerminalText(command).split('\n')
    const source = lines.slice(0, 2).join('\n').trim()
    let clipped = lines.length > 2
    let text = ''
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)) {
      if (text.length + segment.length > 160) { clipped = true; break }
      text += segment
    }
    return `${name === 'bash' ? 'Bash' : 'Shell'}(${text}${clipped ? '…' : ''})`
  }
  return sanitizeTerminalText(name)
}
