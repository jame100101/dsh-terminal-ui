import {createServer} from 'node:http'
import {ToolCallId} from '@deepseek-ai/dsh-llm'
import {createRequire} from 'node:module'
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {boot,createRuntimeResolution,PluginPackages,loadOverlayPatches,reconcileProfilePatches} from '@deepseek-ai/dsh-app-boot'
import {provideCmdline} from '@deepseek-ai/dsh-cmdline'
import Hmr from '@deepseek-ai/dsh-hmr'
import {it,expect,vi} from 'vitest'
import {manageMcp} from '../src/harness/mcp-management'
it.each(['stdio','streamable-http'] as const)('official rc.2 MCP lifecycle and tool calls: %s', {timeout:60000},async transport=>{
 const home=await mkdtemp(join(tmpdir(),'dsh-mcp-lifecycle-'))
 vi.stubEnv('DSH_HOME',home)
 const config=join(home,'cordis.yml'),patch=join(home,'cordis.patch.yml'),file=join(home,'server.json'),script=join(home,'server.mjs')
 await writeFile(config,'[]\n'); await writeFile(patch,'# user-owned comment\n[]\n')
 await writeFile(script,`import readline from 'node:readline';
 const rl=readline.createInterface({input:process.stdin});
 rl.on('line',line=>{const m=JSON.parse(line); if(m.id===undefined)return;
 let result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'echo',description:'fixture',inputSchema:{type:'object',properties:{}}}]}:m.method==='tools/call'?{content:[{type:'text',text:'ok'}]}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`)
 let authorized = 0
 const server = createServer(async(req,res)=>{
  if(req.headers.authorization !== 'Bearer fixture-only') {res.writeHead(401);res.end();return}
  authorized++
  if(req.method !== 'POST') {res.writeHead(405);res.end();return}
  const chunks:Buffer[]=[];for await(const chunk of req) chunks.push(Buffer.from(chunk))
  const message=JSON.parse(Buffer.concat(chunks).toString())
  if(message.id===undefined) {res.writeHead(202);res.end();return}
  const result=message.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'http-fixture',version:'1'}}:message.method==='tools/list'?{tools:[{name:'echo',description:'fixture',inputSchema:{type:'object',properties:{}}}]}:message.method==='tools/call'?{content:[{type:'text',text:'ok'}]}:{}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}))
 })
 if(transport==='streamable-http') await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address()
 const transportConfig=transport==='stdio'?{command:process.execPath,args:[script],env:{}}:{url:`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}/mcp`,headers:{Authorization:'Bearer fixture-only'}}
 await writeFile(file,JSON.stringify({serverName:'fixture',transport,...transportConfig,failOnStartupError:true}),{mode:0o600})
 const require=createRequire(import.meta.url),anchor=require.resolve('@deepseek-ai/dsh/package.json')
 const resolution=await createRuntimeResolution({installAnchor:anchor,home})
 const ctx=await boot('mcp-test',config,[...loadOverlayPatches('mcp-test',require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),{id:'session-persistence-jsonl',config:{root:join(home,'sessions')}},{id:'storage-json',config:{root:join(home,'storage')}},{id:'session-telemetry-otel',disabled:true},{id:'session-title-llm',disabled:true},{id:'hmr',disabled:true}],async root=>{await root.plugin(PluginPackages,{resolution});provideCmdline(root,{args:[],exit:()=>{}})},pathToFileURL(anchor).href)
 await ctx.plugin(Hmr,{root:[],ignored:[],debounce:0})
 const off=await ctx.hmr.watchConfig(patch,async()=>{await reconcileProfilePatches(ctx,[...loadOverlayPatches('mcp-test',require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),{id:'session-persistence-jsonl',config:{root:join(home,'sessions')}},{id:'storage-json',config:{root:join(home,'storage')}},{id:'session-telemetry-otel',disabled:true},{id:'session-title-llm',disabled:true},{id:'hmr',disabled:true},...loadOverlayPatches('mcp-test',patch)],'mcp-test');ctx.emit('app-boot/config-reload')})
 const opts={ctx,patchPath:patch,surfacePluginId:'tui',protectedIds:[],settleTimeoutMs:8000}
 try {
  await manageMcp(opts,{action:'add',file})
  expect(ctx.tools.get('mcp__fixture__echo')).toBeUndefined()
  if(process.platform !== 'win32') expect((await stat(patch)).mode & 0o777).toBe(0o600)
  await manageMcp(opts,{action:'enable',id:'mcp-fixture'})
  expect(ctx.tools.get('mcp__fixture__echo')).toBeDefined()
  const result=await ctx.tools.execute({callId:ToolCallId('fixture-call'),name:'mcp__fixture__echo',arguments:{},signal:new AbortController().signal})
  expect(result.isError).not.toBe(true)
  expect(JSON.stringify(result.content)).toContain('ok')
  if(transport==='streamable-http') expect(authorized).toBeGreaterThan(0)
  await manageMcp(opts,{action:'reconnect',id:'mcp-fixture'})
  expect(ctx.tools.get('mcp__fixture__echo')).toBeDefined()
  await writeFile(file,JSON.stringify({serverName:'fixture',transport,...transportConfig,toolCallTimeoutMs:30000,failOnStartupError:true}))
  await manageMcp(opts,{action:'update',id:'mcp-fixture',file})
  expect(ctx.tools.get('mcp__fixture__echo')).toBeUndefined()
  await manageMcp(opts,{action:'enable',id:'mcp-fixture'})
  expect(ctx.tools.get('mcp__fixture__echo')).toBeDefined()
  await manageMcp(opts,{action:'disable',id:'mcp-fixture'})
  expect(ctx.tools.get('mcp__fixture__echo')).toBeUndefined()
  await manageMcp(opts,{action:'remove',id:'mcp-fixture'})
  expect([...ctx.loader.entries()].some(e=>e.options.id==='mcp-fixture')).toBe(false)
  expect(await readFile(patch,'utf8')).toContain('# user-owned comment')
 } finally {await off();await ctx.fiber.dispose();server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();await rm(home,{recursive:true,force:true})}
})
