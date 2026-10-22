import { describe,it,expect } from 'vitest'
import { appendMcpEntry,parseMcpConfig,removeMcpEntry } from '../src/harness/mcp-management'
import { enableEntryText } from '../src/patch-toggle'
describe('MCP profile edits',()=>{
  it('roundtrips owned disabled entries without touching user expressions or comments',()=>{
    const before = "# user comment\n- id: other\n  config:\n    key: !!js process.env.USER_KEY\n"
    const config = parseMcpConfig('{"serverName":"demo","transport":"stdio","command":"node","args":["a b","$(not-shell)"]}')
    const added = appendMcpEntry(before,config)
    expect(added).toContain('disabled: true')
    expect(added).toContain('$(not-shell)')
    const enabled=enableEntryText(added,'mcp-demo')
    expect(removeMcpEntry(enabled,'mcp-demo').trim()).toBe(before.trim())
    expect(()=>removeMcpEntry(before,'mcp-foreign')).toThrow('Only entries')
    expect(()=>appendMcpEntry(added,config)).toThrow('already exists')
  })
  it('rejects unsupported auth/transport and malformed options without echoing secrets',()=>{
    for(const value of [null,{serverName:'../bad'}, {serverName:'demo',transport:'sse'}, {serverName:'demo',transport:'streamable-http',url:'https://user:secret@host/mcp'}, {serverName:'demo',transport:'stdio',command:'node',env:{SECRET:42}}]) expect(()=>parseMcpConfig(JSON.stringify(value))).toThrow()
    expect(()=>parseMcpConfig('{secret')).toThrow('Invalid MCP JSON')
  })
})
