import { describe, expect, it } from 'vitest'
import {
  LIVE_ASSISTANT_CURSOR, LIVE_ASSISTANT_PREFIX, padEndDisplay, wrapDisplayLines, wrapLiveAssistantText,
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
