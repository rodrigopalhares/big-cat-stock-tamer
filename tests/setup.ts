// Setup global do Vitest. A infraestrutura de banco de teste entra na fase 4,
// quando existirem services para testar. Por ora só fixa o ambiente.
process.env['NODE_ENV'] = 'test'
process.env['DATABASE_URL'] ??= 'file::memory:'
process.env['LOG_LEVEL'] ??= 'silent'
