import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const require=createRequire(import.meta.url)
const ink=dirname(require.resolve('ink'))
const load=(name:string)=>import(pathToFileURL(join(ink,name+'.js')).href)
it('bounds retained text by both entry count and character weight, preserving hot values', async()=>{
 const {default:Cache}=await load('bounded-text-cache')
 const c=new Cache(3,80)
 c.set('a','one');c.set('b','two');c.set('c','three');expect(c.get('a')).toBe('one')
 c.set('d','four');expect(c.get('b')).toBeUndefined();expect(c.get('a')).toBe('one')
 for(let i=0;i<10000;i++)c.set(String(i),'中文🌏'.repeat(i%20))
 expect(c.size).toBeLessThanOrEqual(3);expect(c.retainedCharacters).toBeLessThanOrEqual(80)
 c.set('oversized','x'.repeat(81));expect(c.get('oversized')).toBeUndefined()
 c.set('same','old');c.set('same','new');expect(c.get('same')).toBe('new')
})
it('keeps dimensions and wrapping correct after eviction and avoids ambiguous width keys',async()=>{
 const {default:measure}=await load('measure-text'),{default:wrap}=await load('wrap-text')
 expect(measure('中文🌏\nabc')).toEqual({width:6,height:2})
 // Both used to have key "a12wrap", returning the first call's value.
 expect(wrap('a1',2,'wrap')).toBe('a1');expect(wrap('a',12,'wrap')).toBe('a')
 for(let i=0;i<5000;i++){measure('unique '+i);wrap('unique '+i,5,'wrap')}
 expect(measure('中文🌏\nabc')).toEqual({width:6,height:2})
 expect(wrap('中文🌏',4,'wrap')).toBe('中文\n🌏')
 expect(wrap('',4,'wrap')).toBe('')
})
