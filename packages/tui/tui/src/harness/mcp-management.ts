import { readFile, stat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { isAbsolute } from 'node:path'
import { profilePatchEntry } from '../patch-toggle'
import { createLoaderStateWaiter, mutatePatch, rollbackPatch, toggleProfilePlugin, type PluginToggleOptions } from '../plugin-toggle-runtime'
import type { McpOperation } from './adapter'
const moduleName = '@deepseek-ai/dsh-mcp-client'
/** Validate inert JSON; credentials never enter the UI projection or error text. */
export function parseMcpConfig(text: string): Record<string, unknown> & { serverName: string } {
  if (new TextEncoder().encode(text).byteLength > 65536) throw new Error('MCP configuration exceeds 64 KiB')
  let c: Record<string, unknown>
  try { c = JSON.parse(text) } catch { throw new Error('Invalid MCP JSON') }
  if (!c || Array.isArray(c) || typeof c !== 'object' || typeof c.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(c.serverName)) throw new Error('Invalid serverName')
  const common = ['serverName','transport','toolCallTimeoutMs','failOnStartupError','maxInstructionBytes','reconnect']
  const allowed = c.transport === 'stdio' ? [...common,'command','args','env','cwd'] : c.transport === 'streamable-http' ? [...common,'url','headers'] : []
  if (!allowed.length || Object.keys(c).some(key => !allowed.includes(key))) throw new Error('Unsupported MCP transport or field')
  if (c.transport === 'stdio') {
    if (typeof c.command !== 'string' || !c.command.trim() || c.command.includes('\0')) throw new Error('Expected executable command')
    if (c.args !== undefined && (!Array.isArray(c.args) || c.args.some(v => typeof v !== 'string'))) throw new Error('args must be a string array')
    if (c.cwd !== undefined && (typeof c.cwd !== 'string' || !isAbsolute(c.cwd))) throw new Error('cwd must be absolute')
  } else {
    let url: URL
    try { url = new URL(String(c.url)) } catch { throw new Error('Expected MCP HTTP URL') }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use HTTP(S) and headers for authentication')
  }
  for (const field of ['env','headers']) {
    const value = c[field]
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string'))) throw new Error(field + ' must contain string values')
  }
  for (const field of ['toolCallTimeoutMs','maxInstructionBytes']) if (c[field] !== undefined && (!Number.isSafeInteger(c[field]) || Number(c[field]) <= 0)) throw new Error('Invalid numeric MCP option')
  if (c.failOnStartupError !== undefined && typeof c.failOnStartupError !== 'boolean') throw new Error('Invalid startup policy')
  if (c.reconnect !== undefined) {
    if (!c.reconnect || typeof c.reconnect !== 'object' || Array.isArray(c.reconnect)) throw new Error('Invalid reconnect policy')
    for (const [key,value] of Object.entries(c.reconnect)) {
      if (key === 'enabled' ? typeof value !== 'boolean' : !['initialDelayMs','maxDelayMs','maxAttempts'].includes(key) || !Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Invalid reconnect option')
    }
  }
  return c as Record<string, unknown> & { serverName: string }
}
export function appendMcpEntry(text: string, config: Record<string, unknown> & { serverName: string }): string {
  const id = 'mcp-' + config.serverName
  const block = `# tui-mcp:${id}:begin\n- insert:\n    - id: ${id}\n      name: '${moduleName}'\n      disabled: true\n      config: ${JSON.stringify(config)}\n# tui-mcp:${id}:end\n`
  if (text.includes(`# tui-mcp:${id}:`)) throw new Error('MCP entry already exists')
  // Only append to block-style patch lists. Never round-trip user !!js/comments.
  const trimmed = text.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).join('\n')
  if (trimmed.startsWith('[') && trimmed.trim() !== '[]') throw new Error('Use a block-style profile patch before adding MCP')
  return text.replace(/^\s*\[\]\s*$/m, '') + '\n' + block
}
export function removeMcpEntry(text: string, id: string): string {
  if (!/^mcp-[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error('Invalid MCP id')
  const start = text.indexOf(`# tui-mcp:${id}:begin\n`), endMarker = `# tui-mcp:${id}:end\n`
  const end = text.indexOf(endMarker)
  if (start < 0 || end < start) throw new Error('Only entries added by /mcp add can be removed here; edit the source profile for other entries')
  // A separate toggle override must disappear with this owned insertion.
  const removed = text.slice(0,start) + text.slice(end + endMarker.length)
  const result = removed.replace(new RegExp('^- id: '+id+'\\n  disabled: (?:true|false)\\n?', 'm'), '')
  return result.split('\n').some(line => line.trim() && !line.trim().startsWith('#')) ? result : result + '[]\n'
}
/** Caller serializes all profile mutations. Active tools must settle first. */
export async function manageMcp(options: Omit<PluginToggleOptions, 'id'>, request: McpOperation): Promise<void> {
  if (request.action === 'add') {
    if (!isAbsolute(request.file) || (await stat(request.file)).size > 65536) throw new Error('Use an absolute JSON file path (up to 64 KiB)')
    const config = parseMcpConfig(await readFile(request.file, 'utf8'))
    const id = 'mcp-' + config.serverName
    if ([...options.ctx.loader.entries()].some(entry => entry.options.id === id)) throw new Error('MCP id already exists')
    const waiter = createLoaderStateWaiter(options.ctx, options.patchPath, id, false, options.settleTimeoutMs)
    const observed = waiter.promise.then(() => null, () => new Error('MCP configuration was not applied'))
    let mutation
    try {
      mutation = await mutatePatch(options.patchPath, text => appendMcpEntry(text, config))
      const error = await observed
      if (error) throw error
    } catch (error) { waiter.dispose(); if (mutation) await rollbackPatch(options.patchPath, mutation); throw error }
    return
  }
  const target = profilePatchEntry([...options.ctx.loader.entries()], request.id)
  if (!target || target.options.name !== moduleName) throw new Error('Select an official profile MCP client entry')
  const toggle = async (): Promise<void> => {
    const result = await toggleProfilePlugin({ ...options, id: request.id })
    if (!result.ok) throw new Error('MCP lifecycle change failed: ' + result.code)
  }
  if (request.action === 'enable') { if (target.disabled) await toggle(); return }
  if (request.action === 'disable') { if (!target.disabled) await toggle(); return }
  if (request.action === 'reconnect') {
    if (target.disabled) throw new Error('Enable the server before reconnecting')
    await toggle(); await toggle(); return
  }
  if (request.action === 'update') {
    if (!isAbsolute(request.file) || (await stat(request.file)).size > 65536) throw new Error('Use an absolute JSON file path (up to 64 KiB)')
    const config = parseMcpConfig(await readFile(request.file, 'utf8'))
    if ('mcp-' + config.serverName !== request.id) throw new Error('Keep the existing serverName when updating')
    // Validate ownership before stopping anything. Updated servers stay disabled.
    removeMcpEntry(await readFile(options.patchPath, 'utf8'), request.id)
    if (!target.disabled) await toggle()
    const waiter = createLoaderStateWaiter(options.ctx, options.patchPath, request.id, false, options.settleTimeoutMs, entry => {
      const actual = entry.options.config as Record<string, unknown> | undefined
      return !!actual && Object.entries(config).every(([key,value]) => isDeepStrictEqual(actual[key],value))
    })
    const observed = waiter.promise.then(() => null, () => new Error('MCP update was not applied'))
    let mutation
    try {
      mutation = await mutatePatch(options.patchPath, text => appendMcpEntry(removeMcpEntry(text, request.id), config))
      const error = await observed
      if (error) throw error
    } catch (error) { waiter.dispose(); if (mutation) await rollbackPatch(options.patchPath, mutation); throw error }
    return
  }
  // Validate ownership before disabling. Removing a foreign source is not allowed.
  removeMcpEntry(await readFile(options.patchPath, 'utf8'), request.id)
  if (!target.disabled) await toggle()
  const waiter = createLoaderStateWaiter(options.ctx, options.patchPath, request.id, null, options.settleTimeoutMs)
  const observed = waiter.promise.then(() => null, () => new Error('MCP removal was not applied'))
  let mutation
  try {
    mutation = await mutatePatch(options.patchPath, text => removeMcpEntry(text, request.id))
    const error = await observed
    if (error) throw error
  } catch (error) { waiter.dispose(); if (mutation) await rollbackPatch(options.patchPath, mutation); throw error }
}
