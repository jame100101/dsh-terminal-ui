import { describe, expect, it } from 'vitest'
import { DISPLAY_REDACTION as MASK, displayTextMatches, redactDisplayNode, redactDisplayText, redactDisplayValue } from '../src/display-redaction'
import { extractCopyText } from '../src/copy-text'
import { renderNodePlain } from '../src/plain'
import type { TuiNode } from '../src/types'

describe('shared display redaction policy', () => {
  it.each([
    'sk-abcdefghijklmnopqrstuvwxyz123456', 'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'AKIA1234567890ABCDEF', 'Bearer abcdefghijklmnop',
    'password=hunter-two', 'DEEPSEEK_API_KEY="not-a-prefixed-secret"',
    '"client_secret": "a secret with spaces"', 'https://user:password123@example.com',
    'eyJhbGciOiJIUzI1NiJ9.abcdefghijk.abcdefghijkl',
  ])('masks recognized value without retaining a prefix: %s', value => {
    const result = redactDisplayText(value)
    expect(result).toContain(MASK)
    expect(result).not.toBe(value)
    expect(redactDisplayText(result)).toBe(result)
  })
  it('keeps useful syntax, Unicode and newlines; strips terminal controls before matching', () => {
    expect(redactDisplayText('你好 🎉\nAPI_KEY="secret value"\ncount=42')).toBe(`你好 🎉\nAPI_KEY="${MASK}"\ncount=42`)
    expect(redactDisplayText('ghp_abc\x1b[32mdefghijklmnopqrstuvwxyz')).toBe(MASK)
    expect(redactDisplayText('token=null password=false')).toBe('token=null password=false')
  })
  it('covers complete and incomplete private keys and escaped/unterminated assignments', () => {
    const header = '-----BEGIN OPENSSH PRIVATE KEY-----'
    const footer = '-----END OPENSSH PRIVATE KEY-----'
    expect(redactDisplayText(`${header}\naaa\nbbb\n${footer}`)).toBe(`${header}\n${MASK}\n${MASK}\n${footer}`)
    expect(redactDisplayText(`${header}\naaa\nbbb`)).toBe(`${header}\n${MASK}\n${MASK}`)
    expect(redactDisplayText('password="ab\\"cd" rest')).toBe(`password="${MASK}" rest`)
    expect(redactDisplayText('password="unfinished\nsecret')).toBe(`password="${MASK}\n${MASK}`)
  })
  it('does not pretend arbitrary unlabelled text or PII are recognizable secrets', () => {
    expect(redactDisplayText('ordinary prose abcd1234 user@example.com')).toBe('ordinary prose abcd1234 user@example.com')
  })
  it('masks display objects across card rows without changing row layout or source', () => {
    const source = { api_key: 'unprefixed', rows: [{ text: '-----BEGIN PRIVATE KEY-----\nabc' }, { text: 'def\n-----END PRIVATE KEY-----' }] }
    const result = redactDisplayValue(source)
    expect(result.api_key).toBe(MASK)
    expect(result.rows.map(row => row.text)).toEqual([`-----BEGIN PRIVATE KEY-----\n${MASK}`, `${MASK}\n-----END PRIVATE KEY-----`])
    expect(source.api_key).toBe('unprefixed')
    expect(source.rows[0]!.text).toContain('abc')
  })
  it('handles cyclic display values without mutating them', () => {
    const value: { password: string; self?: unknown } = { password: 'secret' }; value.self = value
    const result = redactDisplayValue(value)
    expect(result.self).toBe(result)
    expect(result.password).toBe(MASK)
    expect(value.password).toBe('secret')
  })
  it('preserves host identities and source facts, shares masked copy/plain/search policy', () => {
    const node: TuiNode = { kind: 'assistant', id: 7, messageId: 'message-raw', text: 'API_KEY=unprefixed-secret' }
    const display = redactDisplayNode(node)
    expect(display).toMatchObject({ id: 7, messageId: 'message-raw', text: `API_KEY=${MASK}` })
    expect(redactDisplayNode(node)).toBe(display)
    expect(node.text).toBe('API_KEY=unprefixed-secret')
    expect(extractCopyText(node)).toBe(`API_KEY=${MASK}`)
    expect(renderNodePlain(node)).toContain(MASK)
    expect(displayTextMatches(node.text, 'unprefixed-secret')).toBe(false)
    expect(displayTextMatches(node.text, 'api_key')).toBe(true)
  })
})
