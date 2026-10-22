import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { privateReport, unpublishedReports } from './verify-push-content.mjs'
it('blocks a report in unpublished history even after deletion, without changing history', () => {
  const cwd=mkdtempSync(join(tmpdir(),'dsh-push-guard-'))
  const git=(...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8'})
  try {
    git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid')
    writeFileSync(join(cwd,'README.md'),'Public instructions\n');git('add','.');git('commit','-m','baseline')
    const baseline=git('rev-parse','HEAD').trim()
    writeFileSync(join(cwd,'phase-report.md'),'Private report\n');git('add','.');git('commit','-m','report')
    unlinkSync(join(cwd,'phase-report.md'));git('add','-u');git('commit','-m','remove')
    const head=git('rev-parse','HEAD').trim()
    expect(unpublishedReports(cwd,head,baseline)).toEqual(['phase-report.md'])
    expect(git('rev-parse','HEAD').trim()).toBe(head)
    expect(privateReport('README.zh.md')).toBe(false)
    expect(privateReport('docs/evidence/secret.json')).toBe(true)
    expect(privateReport('packages/tui/tui/src/index.ts')).toBe(false)
  } finally {rmSync(cwd,{recursive:true,force:true})}
})
