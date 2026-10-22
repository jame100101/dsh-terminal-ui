/** Live-only completion latch; replay and queued followups never announce success. */
export class CompletionNotification {
  private started = false
  private completed = false
  start(): void { this.started = true; this.completed = false }
  end(reason: string): void { this.completed = this.started && reason === 'completed'; this.started = false }
  idle(blocked: boolean, enabled: boolean): boolean {
    const notify = this.completed && !blocked && enabled
    this.completed = false
    return notify
  }
}

/** Fixed text only: never put model output, secrets or control sequences into OSC. */
export function completionSequence(terminal: string | undefined, tmux: boolean): string {
  if (tmux) return '\x07'
  if (terminal === 'iTerm.app') return '\x1b]9;DSH-TUI: Task complete\x07'
  if (terminal === 'WezTerm' || terminal === 'ghostty') return '\x1b]777;notify;DSH-TUI;Task complete\x07'
  return '\x07'
}
