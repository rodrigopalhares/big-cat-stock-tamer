import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// Prisma 7 não carrega mais o .env sozinho; Node 22 tem loader nativo (sem dotenv).
// Só carrega se existir: em produção as variáveis vêm do ambiente, e no `postinstall`
// de um clone novo o .env ainda não foi criado.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // O fallback deixa `prisma generate` funcionar antes de existir configuração alguma.
  // Qualquer comando que toque o banco de verdade usa o valor do ambiente.
  datasource: { url: process.env['DATABASE_URL'] ?? 'file:./data/stocks.db' },
})
