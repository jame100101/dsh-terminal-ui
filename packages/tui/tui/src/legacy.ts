/**
 * Non-TTY linear fallback: when stdin or stdout is not a terminal (pipes, CI,
 * scripts), the TUI degrades to a line-driven REPL with the same command
 * surface and plain rendered output.
 * @module @deepseek-ai/dsh-tui/src/legacy
 */

import { createInterface } from 'node:readline'
import { helpText, welcomeText } from './plain'

/** Handlers the linear REPL drives; prompt settlement belongs to the caller. */
export interface LegacyHandlers {
  /** Submit one prompt and resolve after its turn settles. */
  onPrompt(text: string): Promise<void>
  /** Request process exit. */
  onExit(): void
}

/**
 * Run the line-driven fallback until `/quit`, `/exit`, or EOF.
 * @param handlers - prompt/exit callbacks.
 * @param locale - UI chrome language.
 */
export async function runLegacy(handlers: LegacyHandlers, locale: 'zh' | 'en' = 'zh'): Promise<void> {
  const out = process.stdout
  out.write(welcomeText(locale) + '\n')
  out.write('(linear mode: stdin/stdout is not a TTY)\n')
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const text = line.trim()
    if (text === '') continue
    if (text === '/quit' || text === '/exit') break
    if (text === '/help') {
      out.write(helpText(locale) + '\n')
      continue
    }
    if (text === '/clear') continue
    if (text === '/copy' || text.startsWith('/copy ') || text === '/select') {
      out.write(locale === 'en'
        ? 'copy commands need the interactive TUI\n'
        : '复制命令仅在交互式 TUI 中可用\n')
      continue
    }
    await handlers.onPrompt(text)
  }
  handlers.onExit()
}
