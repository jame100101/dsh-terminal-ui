import { rmSync, realpathSync, lstatSync, existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const output = resolve(root, 'packages/tui/tui/lib')
if (!output.startsWith(root + sep)) throw new Error('Build output outside repository')
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Build output is a symlink')
rmSync(output, { recursive: true, force: true })
