import { sourceChildEnv } from '../../scripts/source-env.mjs'
/** Real rc.2 host/Agent/persistence/TUI, keyless provider, disposable home only. */
import assert from 'node:assert/strict'
import { summarizeReleaseSoak } from './release-soak.mjs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { readProcessTable, walkProcessTree, linearSlopePerMinute } from './process-tree.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)), require=createRequire(import.meta.url)
const duration=Number(process.env.DSH_HOST_SOAK_MS ?? 900000)
assert(Number.isFinite(duration)&&duration>=5000&&duration<=7200000,'duration 5s–2h required')
const pauseMs=Number(process.env.DSH_HOST_SOAK_PAUSE_MS ?? 500)
assert(Number.isFinite(pauseMs)&&pauseMs>=0&&pauseMs<=10000,'pause 0–10000ms required')
const out=resolve(process.env.DSH_HOST_SOAK_REPORT ?? join(root,'.artifacts/release-load/host.json'))
await mkdir(dirname(out),{recursive:true})
const home=await mkdtemp(join(tmpdir(),'dsh-host-soak-'))
const terminal=new (require('@xterm/headless').Terminal)({cols:110,rows:35,allowProposedApi:true,scrollback:0})
const child=require('node-pty').spawn(process.execPath,[...(process.env.DSH_HOST_SOAK_GC === '1'?['--expose-gc']:[]),'--import','tsx/esm',join(root,'packages/tui/tui/tests/fixtures/pipe-host.ts')],{
 cwd:root,cols:110,rows:35,name:'xterm-256color',env:{...sourceChildEnv(process.env,home),NODE_ENV:process.env.DSH_HOST_SOAK_NODE_ENV??'production',HOME:home,CI:'false',TERM:'xterm-256color',TUI_PIPE_SOAK:'1',TUI_PIPE_DELAY:'0',TUI_PIPE_FAIL:'0',TUI_PIPE_NOTIFY:'0'}
})
let exited=false, exitCode, bytes=0, tail='', parsed=Promise.resolve(), error=null, rounds=0, switches=0, newSessions=0
const samples=[],latencies=[],started=Date.now()
child.onExit(e=>{exited=true;exitCode=e.exitCode})
child.onData(data=>{bytes+=Buffer.byteLength(data);tail=(tail+data).slice(-8000);parsed=parsed.then(()=>new Promise(resolve=>terminal.write(data,resolve)))})
terminal.onData(data=>{if(!exited)child.write(data)})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const screen=()=>Array.from({length:terminal.rows},(_,y)=>terminal.buffer.active.getLine(y)?.translateToString(true)??'').join('\n')
async function until(check){const deadline=Date.now()+15000;while(Date.now()<deadline){await parsed;if(exited)throw new Error(`Host exited: ${exitCode}`);if(check(screen()))return;await delay(10)}throw new Error('Response timeout: '+screen())}
const composer=(frame,text)=>frame.split('\n').some(line=>line.trim().startsWith('❯')&&line.trim().replace(/^❯\s*/u,'')===text)
async function command(text){child.write(text);await until(frame=>composer(frame,text));child.write('\r');await until(frame=>!composer(frame,text))}
let activeSessionId
async function sessionId(){
 await command('/session-source');await until(frame=>/\"id\": \"session-[a-f0-9-]+\"/.test(frame))
 const id=screen().match(/\"id\": \"(session-[a-f0-9-]+)\"/)?.[1]
 assert(id,'Missing official session id');child.write('\x1b');await until(frame=>!frame.includes('DSH-TUI masked session source'));return id
}
try {
 await until(frame=>frame.includes('DSH-TUI'))
 while(Date.now()-started<duration){
  if(rounds%20===0){if(rounds){await command('/new');await until(frame=>frame.includes('Welcome to DSH-TUI'));newSessions++}activeSessionId=await sessionId()}
  const before=Date.now();await command(`soak-task-${rounds+1} 中文🌏`);rounds++
  await until(frame=>new RegExp(`soak answer ${rounds}(?:\\s|$)`).test(frame));latencies.push(Date.now()-before)
  if(rounds%10===0){
   await command('/bg');await until(frame=>frame.includes('Live / persisted sessions'));child.write('\x1b')
   await until(frame=>!frame.includes('Live / persisted sessions'))
   await command(`/sessions ${activeSessionId}`);await until(frame=>frame.includes('Live / persisted sessions · 1'))
   child.write('\r');await until(frame=>!frame.includes('Live / persisted sessions')&&frame.includes(`soak answer ${rounds}`));assert.equal(await sessionId(),activeSessionId,'Resume switched to a different session');switches++
  }
  if(!samples.length||Date.now()-started-samples.at(-1).elapsedMs>=5000){const entries=await readProcessTable();assert(entries.some(entry=>entry.pid===child.pid),'Host missing from process sample');const tree=walkProcessTree(child.pid,entries);samples.push({elapsedMs:Date.now()-started,rssBytes:tree.rssBytes,processes:tree.processes.length,rounds})}
  if(samples.at(-1)?.rssBytes>1_000_000_000)throw new Error('Host RSS exceeded 1 GB budget')
  await delay(pauseMs)
 }
 child.write('\x04');const deadline=Date.now()+10000;while(!exited&&Date.now()<deadline)await delay(20)
 assert(exited&&exitCode===0,'Graceful host exit failed')
 const counts=JSON.parse(await readFile(join(home,'requests.json'),'utf8'))
 const withTools=process.env.DSH_HOST_SOAK_TOOLS==='1'
 assert.equal(counts.requests,rounds*(withTools?2:1),'Unexpected extra provider requests')
 assert.equal(counts.tools,withTools?rounds:0,'Tool execution count mismatch')
} catch(e){error=String(e)} finally {if(!exited)child.kill();await delay(200);terminal.dispose()}
let memory=[]
try {memory=(await readFile(join(home,'memory.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))} catch(e){error??=String(e)}
const warmup=Math.min(60000,duration/4),tailSamples=samples.filter(x=>x.elapsedMs>=warmup)
const slope=linearSlopePerMinute(tailSamples.map(x=>({elapsedMs:x.elapsedMs,value:x.rssBytes})))
if(slope>16*1024*1024)error??='Post-warmup RSS slope exceeded 16 MiB/min budget'
latencies.sort((a,b)=>a-b)
const report={toolPayloadBytes:Number(process.env.DSH_HOST_SOAK_TOOL_BYTES??0),pauseMs,heapSnapshotDiagnostic:Boolean(process.env.DSH_HOST_SOAK_HEAP_DIR),nodeEnv:process.env.DSH_HOST_SOAK_NODE_ENV??'production',forcedGcDiagnostic:process.env.DSH_HOST_SOAK_GC==='1',scope:'Real rc.2 Agent/Session/TUI with synthetic provider; optional official tool loop verifies disposable files; no network accounts or external child tools',withTools:process.env.DSH_HOST_SOAK_TOOLS==='1',platform:process.platform,requestedMs:duration,elapsedMs:Date.now()-started,rounds,switches,newSessions,bytes,exitCode,error,rssSlopeBytesPerMinute:slope,peakRssBytes:Math.max(0,...samples.map(x=>x.rssBytes)),peakHeapBytes:Math.max(0,...memory.map(x=>x.heapUsed)),peakAgents:Math.max(0,...memory.map(x=>x.agents??0)),peakSessions:Math.max(0,...memory.map(x=>x.sessions??0)),responseP95Ms:latencies[Math.floor(latencies.length*.95)]??null,samples,memory,...(error?{lastOutput:tail}:{})}
if (process.env.DSH_HOST_SOAK_RELEASE === '1') report.releaseCheck = summarizeReleaseSoak(report)
await writeFile(out,JSON.stringify(report,null,2)+'\n');await rm(home,{recursive:true,force:true})
console.log(JSON.stringify({...report,samples:samples.length,memory:memory.length,lastOutput:undefined}))
if(error || (report.releaseCheck && report.releaseCheck.status !== 'PASS'))process.exitCode=1
