/** Reject staged-for-push history containing private agent reports, even if later deleted. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const shipped = new Set(['AGENTS.md','CLAUDE.md','TUI-WEB-COMPARISON.md','docs/architecture.md','docs/architecture.zh.md'])
export function privateReport(path) {
  return (path.endsWith('.md') && !/(?:^|\/)README(?:\.zh)?\.md$/.test(path) && !shipped.has(path))
    || /^(?:docs\/(?:evidence|acceptance|implementation-progress|release-readiness)|evaluation\/tui\/acceptance-ledger)/.test(path)
}
export function unpublishedReports(cwd, local, remote) {
  if (/^0+$/.test(local)) return []
  const revisions = /^0+$/.test(remote) ? [local, '--not', '--remotes'] : [local, `^${remote}`]
  const paths = execFileSync('git', ['log','--format=','--name-only','--diff-filter=AM','--no-renames','--root','-m',...revisions,'--'], {cwd,encoding:'utf8',maxBuffer:32*1024*1024})
  return [...new Set(paths.split('\n').filter(privateReport))]
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const problems = []
  for (const line of readFileSync(0,'utf8').trim().split('\n').filter(Boolean)) {
    const [,local,,remote] = line.split(/\s+/)
    if (!/^[a-f0-9]{40,64}$/.test(local ?? '') || !/^[a-f0-9]{40,64}$/.test(remote ?? '')) throw new Error('Invalid pre-push ref record')
    problems.push(...unpublishedReports(process.cwd(),local,remote))
  }
  if (problems.length) {
    console.error('Push blocked: unpublished history contains agent/acceptance reports. Prepare a clean release commit after explicit approval; deleting the current files does not remove historical blobs.\n'+[...new Set(problems)].join('\n'))
    process.exitCode=1
  }
}
