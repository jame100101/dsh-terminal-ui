/** Check bilingual documents and local links; --write records confirmed hashes. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const pairs = ['README', 'apps/tui-cli/README', 'packages/tui/tui/README', 'docs/architecture']
let links = 0
for (const pair of pairs) {
  const digest = {}
  for (const lang of ['', '.zh']) {
    const path = `${pair}${lang}.md`
    const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
    assert(text.endsWith('\n') && !text.endsWith('\n\n'), `${path}: final newline`)
    for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue
      assert(existsSync(resolve(dirname(path), decodeURIComponent(target))), `${path}: missing ${target}`)
      links++
    }
    digest[lang === '' ? 'english' : 'chinese'] = createHash('sha256').update(text).digest('hex')
  }
  const record = `# Confirmed bilingual content hashes; pnpm test:docs --write\nenglish: ${digest.english}\nchinese: ${digest.chinese}\n`
  const sidecar = `${pair}.i18n.yaml`
  if (process.argv.includes('--write')) writeFileSync(sidecar, record)
  else assert.equal(readFileSync(sidecar, 'utf8').replaceAll('\r\n', '\n'), record, `${pair}: bilingual record stale`)
}
console.log(JSON.stringify({ status: 'PASS', pairs: pairs.length, localLinks: links }))

const allowedMarkdown = new Set(["AGENTS.md", "CLAUDE.md", "README.md", "README.zh.md", "TUI-WEB-COMPARISON.md", "apps/tui-cli/README.md", "apps/tui-cli/README.zh.md", "docs/architecture.md", "docs/architecture.zh.md", "packages/tui/tui/README.md", "packages/tui/tui/README.zh.md"])
for (const path of execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n')) {
  if (!existsSync(path)) continue
  assert(!path.endsWith('.md') || allowedMarkdown.has(path), `Agent document must stay outside Git: ${path}`)
  assert(!/^(?:docs\/.*(?:acceptance|evidence|implementation-progress|release-readiness)|evaluation\/tui\/acceptance-ledger)/.test(path), `Acceptance record must stay outside Git: ${path}`)
}
