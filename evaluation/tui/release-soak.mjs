/** Release evidence for the large-output host workload, not a general leak proof. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { summarizeMemoryTrend } from './memory-trend.mjs'

export function summarizeReleaseSoak(report) {
  const trend = summarizeMemoryTrend(report)
  const reasons = []
  if (!report.withTools || !Number.isSafeInteger(report.toolPayloadBytes) || report.toolPayloadBytes < 32768) reasons.push('Requires actual tools with at least 32 KiB output')
  if (!Number.isFinite(report.requestedMs) || report.requestedMs < 45 * 60000 || !Number.isFinite(report.elapsedMs) || report.elapsedMs < report.requestedMs) reasons.push('Requested long workload did not complete')
  if (report.nodeEnv !== 'production') reasons.push('Release workload must use the production renderer')
  const memory = report.memory ?? []
  if (!memory.length || memory.some(p => !Number.isInteger(p.agents) || !Number.isInteger(p.sessions) || p.agents < 0 || p.sessions < 0)) reasons.push('Missing host ownership samples')
  const ownershipGrowth = memory.some(p => p.agents > 2 || p.sessions > 2)
  if (ownershipGrowth) reasons.push('More than two live Agents or Sessions in the serial switch workload')
  // Coverage/diagnostic errors cannot be presented as a successful release run.
  const status = reasons.length && !ownershipGrowth ? 'UNTESTED'
    : ownershipGrowth || trend.status === 'FAIL' ? 'FAIL' : trend.status
  return { status, reasons, trend }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportPath = process.env.DSH_HOST_SOAK_REPORT ?? join(await mkdtemp(join(tmpdir(), 'dsh-release-soak-')), 'host.json')
  console.log(`Release evidence: ${reportPath}`)
  const child = spawn(process.execPath, [fileURLToPath(new URL('./host-soak.mjs', import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOST_SOAK_REPORT: reportPath, DSH_HOST_SOAK_MS: process.env.DSH_HOST_SOAK_MS ?? '3600000', DSH_HOST_SOAK_TOOL_BYTES: process.env.DSH_HOST_SOAK_TOOL_BYTES ?? '32768', DSH_HOST_SOAK_TOOLS: '1', DSH_HOST_SOAK_RELEASE: '1' },
  })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
