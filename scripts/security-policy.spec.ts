import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { verifySecurityLock } from './verify-security.mjs'
const require = createRequire(import.meta.url)
// Inspect transitive dependencies from their owning public npm manifests, rather
// than importing another copy into the application or adding artificial peers.
function dependencyEntry(parent: NodeJS.Require, name: string) { return parent.resolve(name) }
function dependencyOwner(parent: NodeJS.Require, name: string) {
  return createRequire(parent.resolve(`${name}/package.json`))
}
describe('third-party security fixes through the actual dependency owners', () => {
  it('keeps the reviewed lock graph and clean-room policy in sync', () => {
    expect(verifySecurityLock('pnpm-lock.yaml').status).toBe('PASS')
  })
  it('rejects a ZIP64 sentinel without an extra field without hanging the host', () => {
    const host = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
    const office = dependencyOwner(host, '@deepseek-ai/dsh-skill-office')
    const kit = dependencyOwner(office, '@deepseek-ai/libreoffice-kit')
    const file = dependencyEntry(kit, 'fflate')
    const result = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'); const z=require(process.argv[1]);
      const data=z.zipSync({'中文.txt':z.strToU8('hello 🌏')});
      assert.equal(z.strFromU8(z.unzipSync(data)['中文.txt']),'hello 🌏');
      const b=Buffer.from(data); const central=b.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
      assert(central>=0); b.writeUInt32LE(0xffffffff,central+20);
      const end=b.length-22;
      const zip64=Buffer.alloc(56); zip64.writeUInt32LE(0x06064b50,0); zip64.writeUInt32LE(44,4);
      zip64.writeUInt32LE(1,32); zip64.writeUInt32LE(central,48);
      const locator=Buffer.alloc(20); locator.writeUInt32LE(0x07064b50,0); locator.writeUInt32LE(end,8);
      const malformed=Buffer.concat([b.subarray(0,end),zip64,locator,b.subarray(end)]);
      assert.throws(()=>z.unzipSync(malformed));
    `, file], { timeout: 3000, encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
  })
  it('rejects abusive indexed map offsets in the actual Vite toolchain', () => {
    const vitest = createRequire(require.resolve('vitest/package.json'))
    const vite = dependencyOwner(vitest, 'vite')
    const postcss = dependencyOwner(vite, 'postcss')
    const { SourceMapConsumer } = postcss('source-map-js')
    const map = { version: 3, sources: ['input.ts'], names: [], mappings: 'AAAA' }
    expect(new SourceMapConsumer(map).originalPositionFor({line:1,column:0}).source).toBe('input.ts')
    expect(() => new SourceMapConsumer({version:3, sections:[{offset:{line:Number.MAX_SAFE_INTEGER,column:0},map}]})).toThrow(/offset/i)
  })
  it('does not send existing credentials to a different OAuth issuer', async () => {
    const fetchFn=vi.fn(async () => { throw new Error('Unexpected network request') })
    const provider = {
      clientMetadata: {},
      clientInformation: () => ({ client_id:'fixture', client_secret:'synthetic-secret', issuer:'https://trusted.example/' }),
      tokens: () => ({ access_token:'synthetic-access', refresh_token:'synthetic-refresh', token_type:'Bearer', issuer:'https://trusted.example/' }),
      discoveryState: () => ({ authorizationServerUrl:'https://other.example/', resourceMetadata:{resource:'https://mcp.example/'}, authorizationServerMetadata:{issuer:'https://other.example/',authorization_endpoint:'https://other.example/auth',token_endpoint:'https://other.example/token'} }),
    }
    await expect(auth(provider as never, {serverUrl:'https://mcp.example/',fetchFn})).rejects.toThrow(/bound to authorization server/)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
