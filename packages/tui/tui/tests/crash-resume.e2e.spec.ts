import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
const fixture = fileURLToPath(new URL('./fixtures/crash-host.ts', import.meta.url))
it('cold-resumes a killed official process without replaying an in-flight tool side effect', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-crash-test-'))
  const children: ReturnType<typeof spawn>[] = []
  const launch = (mode: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', fixture, mode], {
      env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    let output = ''
    child.stdout.on('data', data => { output += String(data) })
    child.stderr.on('data', data => { output += String(data) })
    const exited = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    return { child, exited, output: () => output }
  }
  try {
    const first = launch('crash')
    await expect.poll(async () => {
      if (first.child.exitCode !== null) throw new Error(first.output())
      try { return await readFile(join(home, 'ready'), 'utf8') } catch { return '' }
    }, { timeout: 30_000 }).not.toBe('')
    first.child.kill('SIGKILL')
    await first.exited
    const second = launch('resume')
    expect(await second.exited, second.output()).toBe(0)
    const result = JSON.parse(await readFile(join(home, 'result.json'), 'utf8'))
    expect(await readFile(join(home, 'effects'), 'utf8')).toBe('executed\n')
    expect(result.autoRequests).toBe(0)
    expect(result.requests).toBe(1)
    const ended = result.before.filter((event: {type: string}) => event.type === 'turn/end')
    expect(ended).toHaveLength(1)
    expect(ended[0].data.reason.kind).toBe('interrupted')
    const tool = result.nodes.find((node: {kind: string}) => node.kind === 'tool')
    expect(tool.status).not.toBe('done')
    expect(tool.status).not.toBe('running')
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
    await rm(home, { recursive: true, force: true })
  }
}, 60_000)
