/** Deterministic display policy, independent of credential storage and host message history.
 * Recognizes selected token formats, explicit secret assignments, URL passwords and PEM keys.
 * It is not a general secret/PII detector. No raw reveal cache is kept here.
 */
import type { TuiNode } from './types'
import { sanitizeTerminalText } from './sanitize'
export const DISPLAY_REDACTION = '[REDACTED]'
function hidden(value: string): string {
  return value.replace(/[^\r\n]+/g, DISPLAY_REDACTION)
}
function secretKey(key: string): boolean {
  const normalized = key.replace(/[._-]/g, '').toLowerCase()
  return /(?:apikey|accesstoken|refreshtoken|authtoken|clientsecret|secretkey|password|passwd|privatekey)$/.test(normalized)
    || normalized === 'secret' || normalized === 'token' || normalized === 'authorization'
}
function maskPrivateKeys(value: string): string {
  const headers = /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----/g
  let cursor = 0
  let out = ''
  for (let match = headers.exec(value); match; match = headers.exec(value)) {
    const start = match.index + match[0].length
    const ending = `-----END ${match[1]}-----`
    const end = value.indexOf(ending, start)
    const bodyEnd = end < 0 ? value.length : end
    out += value.slice(cursor, start) + hidden(value.slice(start, bodyEnd))
    cursor = bodyEnd
    if (end >= 0) { out += ending; cursor += ending.length }
    headers.lastIndex = cursor
  }
  return out + value.slice(cursor)
}
function maskAssignments(value: string): string {
  const assignments = /(?:^|[\s,{;])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,100})\1[ \t]*[:=][ \t]*/g
  let cursor = 0
  let out = ''
  for (let match = assignments.exec(value); match; match = assignments.exec(value)) {
    if (!secretKey(match[2]!)) continue
    const start = assignments.lastIndex
    const quote = value[start] === '"' || value[start] === "'" ? value[start] : ''
    const bodyStart = start + (quote ? 1 : 0)
    let end = bodyStart
    while (end < value.length) {
      if (quote) {
        if (value[end] === '\\') { end += 2; continue }
        if (value[end] === quote) break
      } else if (/[\s,;}]/.test(value[end]!)) break
      end++
    }
    end = Math.min(end, value.length)
    const body = value.slice(bodyStart, end)
    if (body && body !== DISPLAY_REDACTION && !/^(?:null|undefined|true|false)$/i.test(body)) {
      out += value.slice(cursor, bodyStart) + hidden(body)
      cursor = end
    }
    assignments.lastIndex = end + (quote && value[end] === quote ? 1 : 0)
  }
  return out + value.slice(cursor)
}
/** Same default text for terminal drawing, semantic copy, search and safe export. */
export function redactDisplayText(text: string): string {
  let result = maskPrivateKeys(sanitizeTerminalText(text))
  result = result.replace(/\b([a-z][a-z0-9+.-]{1,15}:\/\/[^\s/:@?#]{0,256}:)([^\s/@?#]+)(@)/gi,
    (_match, prefix: string, _password: string, suffix: string) => `${prefix}${DISPLAY_REDACTION}${suffix}`)
  result = result.replace(/\b(Bearer|Basic)[ \t]+[A-Za-z0-9+/_=.-]{8,}/gi, `$1 ${DISPLAY_REDACTION}`)
  result = result.replace(/\beyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}\b/g, DISPLAY_REDACTION)
  result = result.replace(/[A-Za-z0-9_-]+/g, token => {
    const known = /^(?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|npm_|hf_|xox[baprs]-|sk_live_|sk_test_|rk_live_|rk_test_|whsec_)/.test(token)
    const cloud = /^(?:(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|LTAI[A-Za-z0-9]{12,20}|AKID[A-Za-z0-9]{28,36})$/.test(token)
    return cloud || (known && token.length >= 16) ? DISPLAY_REDACTION : token
  })
  return maskAssignments(result)
}
/** Mask a display-only object, including secret-named scalar fields. Never mutate the input. */
export function redactDisplayValue<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()
  const visit = (item: unknown, key = ''): unknown => {
    if (typeof item === 'string') return secretKey(key) && item !== '' ? hidden(item) : redactDisplayText(item)
    if (item === null || typeof item !== 'object') return item
    const prior = seen.get(item)
    if (prior !== undefined) return prior
    if (Array.isArray(item)) {
      const out: unknown[] = []; seen.set(item, out)
      // Card rows can split a quoted assignment/private-key block. Mask before re-splitting.
      if (item.length > 0 && item.every(row => row !== null && typeof row === 'object' && typeof row.text === 'string')) {
        const texts = redactDisplayText(item.map(row => row.text).join('\n')).split('\n')
        let offset = 0
        item.forEach(row => {
          const count = row.text.split('\n').length
          out.push({ ...visit(row) as object, text: texts.slice(offset, offset + count).join('\n') })
          offset += count
        })
      } else item.forEach(entry => out.push(visit(entry)))
      return out
    }
    const out: Record<string, unknown> = {}; seen.set(item, out)
    for (const [name, entry] of Object.entries(item)) out[name] = visit(entry, name)
    return out
  }
  return visit(value) as T
}
const displayNodes = new WeakMap<TuiNode, TuiNode>()
/** Preserve host identities/status/timing while replacing only display-bearing fields. */
export function redactDisplayNode(node: TuiNode): TuiNode {
  const cached = displayNodes.get(node)
  if (cached) return cached
  let result: TuiNode
  if (node.kind === 'tool') result = { ...node, detail: redactDisplayText(node.detail), text: redactDisplayText(node.text),
    ...(node.displayTitle === undefined ? {} : { displayTitle: redactDisplayText(node.displayTitle) }),
    args: undefined, callCard: redactDisplayValue(node.callCard), resultCard: redactDisplayValue(node.resultCard) }
  else if (node.kind === 'deliverables') result = { ...node, paths: node.paths.map(redactDisplayText) }
  else if (node.kind === 'context') result = { ...node, text: redactDisplayText(node.text), producer: redactDisplayText(node.producer) }
  else if ('text' in node) result = { ...node, text: redactDisplayText(node.text) }
  else result = node
  displayNodes.set(node, result)
  return result
}
/** Search only displayed text: a query must not reveal a match hidden by masking. */
export function displayTextMatches(text: string, query: string): boolean {
  return redactDisplayText(text).toLocaleLowerCase().includes(query.toLocaleLowerCase())
}
