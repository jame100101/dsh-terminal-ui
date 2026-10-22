import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['packages/tui/tui/lib/types/index.js', 'packages/tui/tui/lib/types/startup.js'],
  outDir: 'packages/tui/tui/lib',
  format: 'esm', platform: 'node', target: 'es2024',
  deps: { neverBundle: [/^@deepseek-ai\//, /^(?:react|react\/jsx-runtime|ink|commander|marked|string-width|diff)$/] },
  fixedExtension: false, dts: false, sourcemap: false, clean: false,
})
