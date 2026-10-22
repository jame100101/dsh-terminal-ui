/** Keep acceptance claims reviewable; passing unit tests is not product acceptance. */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
assert(process.argv[2], 'Usage: node scripts/verify-acceptance.mjs <external-review-directory>')
const ledger = readFileSync(resolve(process.argv[2], 'evaluation/tui/acceptance-ledger.json'))
const archive = JSON.parse(readFileSync(resolve(process.argv[2], 'docs/evidence-archive.json'), 'utf8'))
const original = archive.files.find(entry => entry.path === 'docs/evidence/parity-acceptance.json')
// The migrated ledger is a historical record, not a newly certified HEAD report.
assert(original && createHash('sha256').update(ledger).digest('hex') === original.sha256, 'Historical acceptance ledger changed during migration')
const report = JSON.parse(ledger.toString())
const expected = [...Array.from({ length: 35 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 15 }, (_, i) => `UI-${String(i + 1).padStart(2, '0')}`)]
assert.deepEqual(report.cases.map(item => item.id).sort(), expected.sort(), 'all 50 scenarios must remain present exactly once')
for (const item of report.cases) {
  assert(['PASS', 'FAIL', 'UNTESTED'].includes(item.status), `${item.id}: invalid status`)
  assert(item.scenario && item.requirement && Array.isArray(item.evidence), `${item.id}: missing contract`)
  if (item.status !== 'UNTESTED') assert(item.evidence.length > 0, `${item.id}: result requires evidence`)
}
console.log(JSON.stringify({ status: 'PASS', historicalBaseline: report.baseline, contracts: report.cases.length, results: Object.fromEntries(['PASS', 'FAIL', 'UNTESTED'].map(status => [status, report.cases.filter(item => item.status === status).length])) }))
