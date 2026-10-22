import { expect, it } from 'vitest'
import { moduleSpecifiers } from './module-specifiers.mjs'

it('audits createRequire bindings and direct Node resolvers without treating approval promises as imports', () => {
  const source = `
    import fs from 'node:fs';
    export { Context } from '@deepseek-ai/cordis';
    const requireFromHere = createRequire(import.meta.url);
    requireFromHere.resolve('ink');
    requireFromHere('react');
    createRequire(import.meta.url).resolve('scheduler');
    require.resolve('typescript');
    import.meta.resolve('zod');
    import('@deepseek-ai/dsh');
    answer.resolve('allowed-once');
    Promise.resolve('rejected');
    presets.resolve('standard');
  `
  expect(moduleSpecifiers('fixture.ts', source)).toEqual([
    'node:fs', '@deepseek-ai/cordis', 'ink', 'react', 'scheduler',
    'typescript', 'zod', '@deepseek-ai/dsh',
  ])
})
