import tseslint from 'typescript-eslint'

// Escopo deliberadamente estreito: só as regras que exigem o type checker do
// TypeScript e que o Biome não cobre. Formatação e estilo são do Biome.
// Motivo em docs/fase-0-spike.md §2 — o Biome não enxerga PrismaPromise.
export default tseslint.config(
  {
    ignores: ['dist/**', 'src/generated/**', 'public/js/**', 'node_modules/**', 'build/**'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
)
