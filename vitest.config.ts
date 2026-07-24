import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Vitest 4 transforma com oxc, não esbuild — configurar `esbuild` aqui é ignorado.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/client/**'],
    },
  },
})
