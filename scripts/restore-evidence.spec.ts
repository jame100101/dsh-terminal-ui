import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { restoreEvidence } from './restore-evidence.mjs'
it('verifies backups, refuses overwrites and rejects path/symlink escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-restore-test-'))
  try {
    const archive=join(root,'archive'), destination=join(root,'restored'), outside=join(root,'outside')
    mkdirSync(join(archive,'docs/evidence/sub'), {recursive:true}); mkdirSync(outside)
    const data=Buffer.from('historical fixture')
    const source=join(archive,'docs/evidence/sub/a.txt')
    writeFileSync(source,data)
    const manifest={files:[{path:'docs/evidence/sub/a.txt',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}]}
    expect(restoreEvidence(archive,destination,manifest).restored).toBe(1)
    expect(readFileSync(join(destination,'sub/a.txt')).equals(data)).toBe(true)
    expect(restoreEvidence(archive,destination,manifest).restored).toBe(1)
    writeFileSync(join(destination,'sub/a.txt'),'new evidence')
    expect(()=>restoreEvidence(archive,destination,manifest)).toThrow(/Refusing overwrite/)
    rmSync(join(destination,'sub'),{recursive:true}); symlinkSync(outside,join(destination,'sub'))
    expect(()=>restoreEvidence(archive,destination,manifest)).toThrow(/symlink/)
    expect(()=>restoreEvidence(archive,destination,{files:[{...manifest.files[0],path:'docs/evidence/../secret'}]})).toThrow(/Invalid/)
    writeFileSync(source,Buffer.alloc(data.length))
    expect(()=>restoreEvidence(archive,destination,manifest)).toThrow(/mismatch/)
  } finally { rmSync(root,{recursive:true,force:true}) }
})
