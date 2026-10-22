import {it,expect} from 'vitest'
import {mkdtemp,writeFile,rm,unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {watchKeybindings} from '../src/keybindings-runtime'
import type {KeybindingConfig} from '../src/keybindings'
it('hot reload retains last valid bindings, resets on delete and disposes its watcher',async()=>{
 const home=await mkdtemp(join(tmpdir(),'dsh-keybindings-')),path=join(home,'keybindings.json')
 const states:KeybindingConfig[]=[]
 const off=watchKeybindings(path,state=>states.push(state))
 try {
  await expect.poll(()=>states.length).toBeGreaterThan(0)
  await writeFile(path,JSON.stringify({bindings:[{context:'Chat',bindings:{'ctrl+j':'chat:submit'}}]}))
  await expect.poll(()=>states.at(-1)?.bindings.length).toBe(1)
  await writeFile(path,'invalid')
  await expect.poll(()=>states.at(-1)?.error).toBeTruthy()
  expect(states.at(-1)?.bindings.length).toBe(1)
  await unlink(path)
  await expect.poll(()=>states.at(-1)?.bindings.length).toBe(0)
  off();const length=states.length
  await writeFile(path,'{}');await new Promise(r=>setTimeout(r,600))
  expect(states.length).toBe(length)
 } finally {off();await rm(home,{recursive:true,force:true})}
})
