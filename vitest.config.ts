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
      // `src/**` pegaria também o README de views, que o v8 tenta parsear como código.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/client/**'],
    },
  },
})
