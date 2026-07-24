/**
 * Regras de camada do plano (docs/migracao-typescript.md §5).
 *
 *   routes  ->  service  ->  domain
 *      |           |
 *    views     integrations  ->  domain
 *
 * Convenção que não é verificada por máquina não sobrevive ao porte.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-sem-io',
      comment:
        'src/domain/ é puro e síncrono: sem Prisma, sem fetch, sem Fastify, sem service. ' +
        'Se a função precisa de await, ela não pertence ao domínio.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        path: '^(src/(modules|integrations|config|plugins|infra|generated|views)|node_modules/(@prisma|fastify|preact))',
      },
    },
    {
      name: 'views-sem-dados',
      comment: 'src/views/ recebe tudo por props: sem service, sem Prisma, sem config.',
      severity: 'error',
      from: { path: '^src/views' },
      to: { path: '^(src/(modules|config|infra|integrations|generated)|node_modules/@prisma)' },
    },
    {
      name: 'integrations-sem-banco',
      comment: 'src/integrations/ busca dados externos e devolve; quem persiste é o service.',
      severity: 'error',
      from: { path: '^src/integrations' },
      to: { path: '^(src/(modules|generated)|node_modules/@prisma)' },
    },
    {
      name: 'sem-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // `doNotFollow`, não `exclude`: o client gerado precisa aparecer como nó do grafo
    // para a regra domain-sem-io enxergar a dependência — só não vale percorrê-lo.
    doNotFollow: { path: '(node_modules|^src/generated)' },
    exclude: { path: '\\.test\\.tsx?$' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require'] },
  },
}
