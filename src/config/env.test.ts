import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'

/**
 * A matriz de autenticação do boot.
 *
 * Antes deste teste, esquecer APP_AUTH_PASSWORD subia a aplicação inteira aberta em silêncio.
 * Cada linha aqui existe para que esse caminho não volte por descuido.
 */
describe('loadEnv — autenticação', () => {
  const base = { DATABASE_URL: 'file::memory:', LOG_LEVEL: 'silent' } as const
  const env = (extra: NodeJS.ProcessEnv) => () => loadEnv({ ...base, ...extra })

  const SENHA = 'senha-bem-comprida'

  describe('em produção', () => {
    const prod = { NODE_ENV: 'production' } as const

    it('senha vazia derruba o boot', () => {
      expect(env({ ...prod })).toThrow(/APP_AUTH_PASSWORD é obrigatória com NODE_ENV=production/)
    })

    it('APP_AUTH_DISABLED não é aceita — nem com a flag o boot sobe sem senha', () => {
      expect(env({ ...prod, APP_AUTH_DISABLED: 'true' })).toThrow(
        /não há como desligar a autenticação/,
      )
    })

    it('com senha, sobe protegido', () => {
      expect(env({ ...prod, APP_AUTH_PASSWORD: SENHA })().authEnabled).toBe(true)
    })
  })

  describe('fora de produção', () => {
    it('senha vazia sem a flag derruba o boot', () => {
      expect(env({ NODE_ENV: 'development' })).toThrow(/declare APP_AUTH_DISABLED=true/)
    })

    it('senha vazia com a flag sobe aberto', () => {
      const loaded = env({ NODE_ENV: 'development', APP_AUTH_DISABLED: 'true' })()
      expect(loaded.authEnabled).toBe(false)
    })

    it('APP_AUTH_DISABLED=false é o padrão e não libera nada', () => {
      expect(env({ NODE_ENV: 'development', APP_AUTH_DISABLED: 'false' })).toThrow(
        /declare APP_AUTH_DISABLED=true/,
      )
    })
  })

  describe('tamanho da senha', () => {
    it.each(['a', 'curta', 'onzecaract'])('rejeita senha de %s caracteres', (password) => {
      expect(env({ NODE_ENV: 'development', APP_AUTH_PASSWORD: password })).toThrow(
        /pelo menos 12 caracteres/,
      )
    })

    it('aceita exatamente 12 caracteres', () => {
      expect(
        env({ NODE_ENV: 'development', APP_AUTH_PASSWORD: '123456789012' })().authEnabled,
      ).toBe(true)
    })
  })

  /**
   * A flag só é consultada com a senha vazia. A assimetria é deliberada: ignorar a flag erra
   * para o lado seguro, enquanto deixá-la vencer a senha abriria a aplicação sem querer.
   */
  it('com senha configurada, APP_AUTH_DISABLED=true é ignorada', () => {
    const loaded = env({
      NODE_ENV: 'development',
      APP_AUTH_PASSWORD: SENHA,
      APP_AUTH_DISABLED: 'true',
    })()
    expect(loaded.authEnabled).toBe(true)
  })

  it('a mensagem de erro não sai com dois-pontos solto na frente', () => {
    expect(env({ NODE_ENV: 'production' })).toThrow(/\n {2}APP_AUTH_PASSWORD é obrigatória/)
  })
})
