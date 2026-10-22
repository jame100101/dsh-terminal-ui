import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseEditorCommand, runExternalEditor } from '../src/external-editor'

it('parses quoted executable/arguments and Windows paths without evaluating shell syntax', () => {
  expect(parseEditorCommand('"C:\\Program Files\\Editor\\edit.exe" --wait "a b"')).toEqual({ command: 'C:\\Program Files\\Editor\\edit.exe', args: ['--wait', 'a b'] })
  expect(parseEditorCommand(String.raw`"\\server\share\editor.exe" --wait`)).toEqual({ command: String.raw`\\server\share\editor.exe`, args: ['--wait'] })
  expect(parseEditorCommand("editor --flag 'literal $HOME;value'")).toEqual({ command: 'editor', args: ['--flag', 'literal $HOME;value'] })
  expect(() => parseEditorCommand('editor; touch bad')).toThrow('shell syntax')
  expect(() => parseEditorCommand('editor $(touch bad)')).toThrow('shell syntax')
  expect(() => parseEditorCommand('editor "open')).toThrow('unclosed quote')
})

it('fails explicitly without VISUAL/EDITOR configuration', async () => {
  await expect(runExternalEditor('original', { cwd: tmpdir(), env: {} })).rejects.toThrow('Set VISUAL or EDITOR')
})

it('runs a real editor process with private file, literal arguments and cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-editor-test-'))
  const script = join(root, 'editor fixture.mjs'); const probe = join(root, 'probe.json')
  await writeFile(script, `import {readFile,writeFile,stat} from 'node:fs/promises';
const file=process.argv.at(-1); const before=await readFile(file,'utf8');
await writeFile(process.env.PROBE,JSON.stringify({file,mode:(await stat(file)).mode&511,cwd:process.cwd(),arg:process.argv[2],before}));
await writeFile(file,before+'\\n已编辑 😀');`)
  try {
    const edited = await runExternalEditor('原稿', { cwd: root, env: { ...process.env, VISUAL: `"${process.execPath}" "${script}" 'literal $HOME;value'`, EDITOR: 'not-used', PROBE: probe } })
    expect(edited).toBe('原稿\n已编辑 😀')
    const data = JSON.parse(await readFile(probe, 'utf8'))
    expect(data).toMatchObject({ mode: 0o600, cwd: await realpath(root), arg: 'literal $HOME;value', before: '原稿' })
    await expect(stat(data.file)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects nonzero exit and removes even partially modified output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-editor-fail-'))
  const script = join(root, 'fail.mjs'); const probe = join(root, 'probe')
  await writeFile(script, `import {writeFile} from 'node:fs/promises';const file=process.argv.at(-1);await writeFile(process.env.PROBE,file);await writeFile(file,'partial');process.exitCode=7;`)
  try {
    await expect(runExternalEditor('original', { cwd: root, env: { ...process.env, VISUAL: '', EDITOR: `"${process.execPath}" "${script}"`, PROBE: probe } })).rejects.toThrow('Editor exited 7')
    await expect(stat(await readFile(probe, 'utf8'))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('cancels an actual child, waits for close and cleans its temporary draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-editor-cancel-'))
  const script = join(root, 'wait.mjs'); const probe = join(root, 'probe')
  await writeFile(script, `import {writeFile} from 'node:fs/promises';await writeFile(process.env.PROBE,process.argv.at(-1));setInterval(()=>{},1000);`)
  const controller = new AbortController()
  try {
    const pending = runExternalEditor('original', { cwd: root, signal: controller.signal, env: { ...process.env, VISUAL: `"${process.execPath}" "${script}"`, PROBE: probe } })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    let file = ''
    // writeFile creates the probe before writing its path; an empty read is not readiness.
    for (let n = 0; n < 100; n++) {
      try { file = await readFile(probe, 'utf8'); if (file !== '') break } catch { /* Child has not created its probe yet. */ }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(file).not.toBe('')
    controller.abort(); await rejected
    await expect(stat(file)).rejects.toThrow()
  } finally { controller.abort(); await rm(root, { recursive: true, force: true }) }
})

it('rejects a symlink output without reading or changing its target', async () => {
  if (process.platform === 'win32') return // Windows symlink privilege is an explicit CI/platform concern.
  const root = await mkdtemp(join(tmpdir(), 'dsh-editor-link-'))
  const script = join(root, 'link.mjs'); const target = join(root, 'untouched')
  await writeFile(target, 'private original')
  await writeFile(script, `import {unlink,symlink} from 'node:fs/promises';const file=process.argv.at(-1);await unlink(file);await symlink(process.env.TARGET,file);`)
  try {
    await expect(runExternalEditor('draft', { cwd: root, env: { ...process.env, VISUAL: `"${process.execPath}" "${script}"`, TARGET: target } })).rejects.toThrow('regular private file')
    expect(await readFile(target, 'utf8')).toBe('private original')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('reports a missing configured executable and a pre-aborted edit explicitly', async () => {
  await expect(runExternalEditor('draft', { cwd: tmpdir(), env: { VISUAL: 'dsh-nonexistent-editor-fixture' } })).rejects.toThrow('Could not launch')
  const controller = new AbortController(); controller.abort()
  await expect(runExternalEditor('draft', { cwd: tmpdir(), signal: controller.signal, env: { VISUAL: 'editor' } })).rejects.toMatchObject({ name: 'AbortError' })
})
