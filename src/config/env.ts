import { z } from 'zod'

/**
 * Substitui o bloco `app:` do application.yml e as anotações @Value dos services.
 *
 * A validação acontece uma vez, no boot: configuração errada derruba a aplicação
 * imediatamente com mensagem clara, em vez de virar `undefined` no meio de um request.
 */

/**
 * Curta demais não é senha. Com um segredo só protegendo a carteira inteira, e a aplicação
 * escutando em 0.0.0.0, o tamanho é a defesa — não há segundo fator para compensar.
 */
const MIN_PASSWORD_LENGTH = 12

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    APP_DATA_DIR: z.string().min(1).default('./data'),
    DATABASE_URL: z.string().min(1),

    // Vazia não desliga mais nada sozinha: só passa junto de APP_AUTH_DISABLED=true, e
    // nunca em produção. Quem decide é o superRefine abaixo.
    APP_AUTH_PASSWORD: z.string().default(''),
    APP_AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(365),

    /**
     * Desligar a autenticação passou a ser um ato explícito.
     *
     * Antes bastava esquecer APP_AUTH_PASSWORD: o boot subia calado e a carteira inteira
     * ficava aberta a quem alcançasse a porta. Um campo em branco é omissão, não decisão —
     * e omissão não pode desligar um controle de tudo-ou-nada.
     */
    APP_AUTH_DISABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Em branco desabilita a leitura de notas em PDF. Aqui a convenção continua valendo:
    // sem chave a aba some, e o pior caso é uma funcionalidade a menos.
    APP_ANTHROPIC_API_KEY: z.string().default(''),

    APP_BACKUP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    APP_BACKUP_DAILY_COPIES: z.coerce.number().int().positive().default(7),
    APP_BACKUP_MONTHLY_COPIES: z.coerce.number().int().positive().default(3),
  })
  .superRefine((env, ctx) => {
    // Com senha configurada a autenticação está ligada, e APP_AUTH_DISABLED é ignorada.
    // A regra é assimétrica de propósito: ignorar a flag erra para o lado seguro, enquanto
    // deixá-la vencer a senha permitiria abrir a aplicação sem querer.
    if (env.APP_AUTH_PASSWORD.length > 0) {
      if (env.APP_AUTH_PASSWORD.length < MIN_PASSWORD_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          message: `APP_AUTH_PASSWORD precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
        })
      }
      return
    }

    if (env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        message:
          'APP_AUTH_PASSWORD é obrigatória com NODE_ENV=production. ' +
          'Em produção não há como desligar a autenticação — APP_AUTH_DISABLED não vale aqui.',
      })
      return
    }

    if (!env.APP_AUTH_DISABLED) {
      ctx.addIssue({
        code: 'custom',
        message:
          'APP_AUTH_PASSWORD está vazia. Defina uma senha ou, para rodar sem autenticação ' +
          'fora de produção, declare APP_AUTH_DISABLED=true.',
      })
    }
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
    // Issue do superRefine não tem `path` — sem este cuidado a linha sairia como ": mensagem".
    const issues = parsed.error.issues
      .map((i) => (i.path.length === 0 ? `  ${i.message}` : `  ${i.path.join('.')}: ${i.message}`))
      .join('\n')
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
