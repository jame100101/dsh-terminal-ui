import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  test: {
    maxWorkers: 4, pool: 'forks', execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-invariants.ts'],
    include: ['packages/tui/tui/tests/**/*.spec.{ts,tsx}', 'apps/tui-cli/tests/**/*.spec.ts', 'scripts/*.spec.ts'],
  },
})
