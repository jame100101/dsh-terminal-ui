import { defineConfig } from 'tsdown'

// The terminal frontend is a Node/Ink renderer, not a browser Harness client.
export default defineConfig({
  entry: ['packages/tui/tui/src/render.tsx'],
  outDir: 'packages/tui/tui/lib/client',
  platform: 'node', format: 'esm', target: 'es2024',
  deps: { neverBundle: [/^@deepseek-ai\//, /^(?:react|react\/jsx-runtime|ink|commander|marked|string-width)$/] },
  dts: false, sourcemap: false, clean: true,
})
