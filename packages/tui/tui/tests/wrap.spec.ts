import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import {
  LIVE_ASSISTANT_CURSOR, LIVE_ASSISTANT_PREFIX, padEndDisplay, projectLiveThinkingTail, wrapDisplayLines,
  wrapLiveAssistantText,
} from '../src/wrap'

describe('wrapDisplayLines', () => {
  it('wraps on cell width and keeps empty source lines', () => {
    expect(wrapDisplayLines('abcd', 2)).toEqual(['ab', 'cd'])
    expect(wrapDisplayLines('a\n\nb', 8)).toEqual(['a', '', 'b'])
  })
})

describe('padEndDisplay', () => {
  it('pads to the cell budget and leaves over-wide rows alone', () => {
    expect(padEndDisplay('ab', 5)).toBe('ab   ')
    expect(padEndDisplay('abcdef', 4)).toBe('abcdef')
    expect(padEndDisplay('', 3)).toBe('   ')
    expect(padEndDisplay('x', 0)).toBe('x')
  })
})

describe('wrapLiveAssistantText', () => {
  it('appends onto an empty previous line list', () => {
    const next = wrapLiveAssistantText({ lines: [], offset: 0, width: 10 }, 'ab', 10)
    expect(next.lines).toEqual(
      wrapDisplayLines(`${LIVE_ASSISTANT_PREFIX}ab${LIVE_ASSISTANT_CURSOR}`, 10),
    )
  })

  it('returns the previous state when the live text is unchanged', () => {
    const first = wrapLiveAssistantText(null, 'same', 20)
    expect(wrapLiveAssistantText(first, 'same', 20)).toBe(first)
  })

  it('appends when the last wrapped row has no cursor yet', () => {
    const next = wrapLiveAssistantText({ lines: ['● hi'], offset: 2, width: 20 }, 'hi!', 20)
    expect(next.lines.at(-1)).toContain(LIVE_ASSISTANT_CURSOR)
  })

  it('matches a full wrap when chunks are appended', () => {
    const width = 12
    const chunks = ['Hello', ' 世界', ' and more']
    let live = ''
    let state = wrapLiveAssistantText(null, live, width)
    for (const chunk of chunks) {
      live += chunk
      state = wrapLiveAssistantText(state, live, width)
    }
    expect(state.lines).toEqual(
      wrapDisplayLines(`${LIVE_ASSISTANT_PREFIX}${live}${LIVE_ASSISTANT_CURSOR}`, width),
    )
    expect(state.offset).toBe(live.length)
  })

  it('rewraps from scratch when the width changes', () => {
    const first = wrapLiveAssistantText(null, 'abcdefghij', 6)
    const second = wrapLiveAssistantText(first, 'abcdefghij', 20)
    expect(second.lines).toEqual(
      wrapDisplayLines(`${LIVE_ASSISTANT_PREFIX}abcdefghij${LIVE_ASSISTANT_CURSOR}`, 20),
    )
    expect(second.width).toBe(20)
  })

  it('rewraps from scratch when the live buffer shrinks', () => {
    const first = wrapLiveAssistantText(null, 'long live text', 10)
    const second = wrapLiveAssistantText(first, 'short', 10)
    expect(second.lines).toEqual(
      wrapDisplayLines(`${LIVE_ASSISTANT_PREFIX}short${LIVE_ASSISTANT_CURSOR}`, 10),
    )
    expect(second.offset).toBe(5)
  })
})

describe('projectLiveThinkingTail', () => {
  it('keeps an appended CJK stream inside the cell budget', () => {
    let text = ''
    let state = projectLiveThinkingTail(null, text, 9)
    for (const chunk of ['第一段', '第二段', '第三段']) {
      text += chunk
      state = projectLiveThinkingTail(state, text, 9)
    }
    expect(stringWidth(state.tail)).toBeLessThanOrEqual(9)
    expect(state.tail.startsWith('…')).toBe(true)
    expect(state.tail.endsWith('三段')).toBe(true)
    expect(state.offset).toBe(text.length)
  })

  it('resets to text after the latest streamed line break', () => {
    const first = projectLiveThinkingTail(null, 'old tail', 20)
    const second = projectLiveThinkingTail(first, 'old tail\nnew tail', 20)
    expect(second.tail).toBe('new tail')
  })

  it('returns the previous state for an unchanged stream', () => {
    const first = projectLiveThinkingTail(null, 'same', 20)
    expect(projectLiveThinkingTail(first, 'same', 20)).toBe(first)
  })

  it('reprojects a replacement that keeps the same source length', () => {
    const first = projectLiveThinkingTail(null, 'old value', 20)
    const second = projectLiveThinkingTail(first, 'new value', 20)
    expect(second.tail).toBe('new value')
    const emptyTail = projectLiveThinkingTail(null, 'abc\n', 20)
    expect(projectLiveThinkingTail(emptyTail, 'abcd', 20).tail).toBe('abcd')
  })

  it('retains only a bounded suffix after a large no-newline stream', () => {
    const first = projectLiveThinkingTail(null, '字'.repeat(100_000), 80)
    const second = projectLiveThinkingTail(first, `${'字'.repeat(100_000)}追加`, 80)
    expect(stringWidth(first.tail)).toBeLessThanOrEqual(80)
    expect(stringWidth(second.tail)).toBeLessThanOrEqual(80)
    expect(second.tail.length).toBeLessThan(100)
    expect(second.tail.endsWith('追加')).toBe(true)
  })
})
