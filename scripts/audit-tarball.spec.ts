import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

/** Construct minimal tar records so rejection tests do not depend on npm/network. */
function archive(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  for (const [name, text] of Object.entries(entries)) {
    const bytes = Buffer.from(text)
    const header = Buffer.alloc(512)
    header.write(`package/${name}`)
    header.write(bytes.length.toString(8).padStart(11, '0'), 124)
    header.write('0', 156)
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]))
}

const payload = {
  'package.json': JSON.stringify({ name: '@jame100101/dsh-tui', bundledDependencies: ['ink'] }),
  'lib/index.js': 'export const name = "tui"',
  'bin/dsh-tui.js': '',
  'cordis.patch.yml': '[]',
  'node_modules/ink/build/dsh-tui-patch.json': '{}',
}

function audit(extra: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'tui-audit-rejection-'))
  try {
    const file = join(directory, 'fixture.tgz')
    writeFileSync(file, archive({ ...payload, ...extra }))
    return spawnSync(process.execPath, [join(import.meta.dirname, 'audit-tarball.mjs'), file], { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('tarball portability audit', () => {
  it('accepts the plugin-only payload', () => expect(audit({}).status).toBe(0))
  it.each(['workspace:*', 'file:../runtime', 'link:../runtime'])('rejects %s dependencies', spec => {
    const result = audit({ 'package.json': JSON.stringify({ name: '@jame100101/dsh-tui', bundledDependencies: ['ink'], dependencies: { runtime: spec } }) })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(spec)
  })
  it.each(['packages/core/session.ts', 'runtime/index.js', 'node_modules/@deepseek-ai/cordis/index.js', '.env', '../escape.js'])('rejects %s', name => {
    expect(audit({ [name]: '' }).status).not.toBe(0)
  })
  it('rejects private Harness imports', () => {
    expect(audit({ 'lib/index.js': "import '@deepseek-ai/dsh-session/src/index.ts'" }).status).not.toBe(0)
  })
  it('rejects build-machine paths', () => {
    expect(audit({ 'lib/index.js': 'const path = "C:/Users/Alice/project"' }).status).not.toBe(0)
  })
})
