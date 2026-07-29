import { z } from 'zod'

/**
 * Substitui o bloco `app:` do application.yml e as anotações @Value dos services.
 *
 * A validação acontece uma vez, no boot: configuração errada derruba a aplicação
 * imediatamente com mensagem clara, em vez de virar `undefined` no meio de um request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_DATA_DIR: z.string().min(1).default('./data'),
  DATABASE_URL: z.string().min(1),

  // Em branco desabilita a autenticação — mesmo comportamento do AuthService atual.
  APP_AUTH_PASSWORD: z.string().default(''),
  APP_AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(365),

  // Em branco desabilita a leitura de notas em PDF — mesma convenção da senha.
  APP_ANTHROPIC_API_KEY: z.string().default(''),

  APP_BACKUP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  APP_BACKUP_DAILY_COPIES: z.coerce.number().int().positive().default(7),
  APP_BACKUP_MONTHLY_COPIES: z.coerce.number().int().positive().default(3),
})

export type Env = z.infer<typeof EnvSchema> & {
  readonly authEnabled: boolean
  readonly backupDir: string
  readonly authKeyFile: string
  readonly notesDir: string
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuração inválida:\n${issues}`)
  }
  const env = parsed.data
  // Os derivados leem de `source`, não de process.env — senão `loadEnv(outraCoisa)` mentiria
  // e o teste acabaria apontando para o diretório de dados de produção.
  return {
    ...env,
    authEnabled: env.APP_AUTH_PASSWORD.length > 0,
    backupDir: source['APP_BACKUP_DIR'] ?? `${env.APP_DATA_DIR}/backups`,
    authKeyFile: source['APP_AUTH_KEY_FILE'] ?? `${env.APP_DATA_DIR}/auth.key`,
    notesDir: source['APP_NOTES_DIR'] ?? `${env.APP_DATA_DIR}/notas`,
  }
}
