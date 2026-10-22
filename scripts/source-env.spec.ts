import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { sourceChildEnv } from './source-env.mjs'
it('loads production React in the child while preserving the selected home and credential environment', () => {
 const original={...process.env,NODE_ENV:'development',DEEPSEEK_API_KEY:'synthetic-key',DSH_HOME:'/previous-home'}
 const env=sourceChildEnv(original,'/isolated-home')
 const require=createRequire(import.meta.url)
 const result=spawnSync(process.execPath,['-e',`require(process.argv[1]); process.stdout.write(JSON.stringify({production:Object.keys(require.cache).some(p=>p.endsWith('react.production.js')),home:process.env.DSH_HOME,key:process.env.DEEPSEEK_API_KEY}))`,require.resolve('react')],{env,encoding:'utf8'})
 expect(result.status,result.stderr).toBe(0)
 expect(JSON.parse(result.stdout)).toEqual({production:true,home:'/isolated-home',key:'synthetic-key'})
 expect(original.NODE_ENV).toBe('development');expect(original.DSH_HOME).toBe('/previous-home')
})
