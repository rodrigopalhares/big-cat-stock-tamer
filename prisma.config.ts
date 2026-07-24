import { defineConfig, env } from 'prisma/config'

// Prisma 7 não carrega mais o .env sozinho; Node 22 tem loader nativo (sem dotenv).
process.loadEnvFile('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
})
