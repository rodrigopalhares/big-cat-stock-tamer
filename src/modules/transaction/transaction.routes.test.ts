import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../../../tests/app-harness.js'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset } from '../../../tests/factories.js'
import { encryptedPdf, needsPassword } from '../../../tests/pdf.js'
import { buildApp } from '../../app.js'
import { loadEnv } from '../../config/env.js'
import { buildContainer } from '../../container.js'
import type { BrokerNoteData } from '../../domain/broker-note.js'
import type { AnthropicClient } from '../../integrations/anthropic/anthropic.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { BrokerNoteService } from '../broker-note/broker-note.service.js'

/** Rotas da importação de nota de negociação: leitura, downloads e vínculo no histórico. */

const NOTE: BrokerNoteData = {
  date: isoDate('2026-07-15'),
  broker: 'XP',
  noteNumber: '140232205',
  totalFees: 9.03,
  totalAmount: 30160.98,
  trades: [
    {
      ticker: 'XPLG11',
      security: 'FII XP LOG',
      tickerSource: 'NOTE',
      side: 'C',
      quantity: 329,
      price: 91.64726443768997,
    },
  ],
}

const PDF = Buffer.from('%PDF-1.4 conteúdo da nota')

const RAW_RESPONSE = '{"tradeDate":"2026-07-15","noteNumber":"140232205"}'

const fakeAnthropic = {
  enabled: true,
  extractBrokerNote: () =>
    Promise.resolve({
      note: NOTE,
      rawResponse: RAW_RESPONSE,
      fees: [{ label: 'Taxa de liquidação', value: 6.75 }],
      checkedTotal: 30160.98,
      checkNotes: 'A soma bate com o líquido da nota.',
    }),
} as unknown as AnthropicClient

/** Corpo multipart montado à mão — evita mais uma dependência só para o teste. */
function upload(
  content: Buffer,
  { fileName = 'nota.pdf', contentType = 'application/pdf', password = '' } = {},
) {
  const boundary = '----NotaDeNegociacao'
  // A senha vai antes do arquivo, como o cliente monta o FormData: o `req.file()` lê o
  // corpo em streaming e só enxerga os campos que já passaram quando chega no arquivo.
  const field =
    password === ''
      ? Buffer.alloc(0)
      : Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\n${password}\r\n`,
        )
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  )
  return {
    payload: Buffer.concat([field, head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

describe('rotas de nota de negociação', () => {
  let db: TestDb
  let app: FastifyInstance
  let notesDir: string

  beforeAll(async () => {
    db = await createTestDb()
    notesDir = mkdtempSync(join(tmpdir(), 'stocks-notas-rotas-'))
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: ':memory:',
      LOG_LEVEL: 'silent',
      APP_NOTES_DIR: notesDir,
    })
    const container = buildContainer(db, env)
    app = await buildApp({
      env,
      db,
      container: { ...container, brokerNotes: new BrokerNoteService(db, fakeAnthropic, notesDir) },
    })
    await app.ready()
  })

  afterEach(async () => {
    await clearAllData(db)
  })

  afterAll(async () => {
    await app.close()
    await db.$disconnect()
    rmSync(notesDir, { recursive: true, force: true })
  })

  const parse = () =>
    app.inject({ method: 'POST', url: '/transactions/parse-note', ...upload(PDF) })

  describe('POST /transactions/parse-note', () => {
    it('devolve a prévia da nota com o consolidado e o CSV', async () => {
      const res = await parse()

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('XPLG11')
      expect(res.body).toContain('nota 140232205')
      expect(res.body).toContain('Usar no CSV')
      expect(res.body).toContain('Conferência do total fecha')
      expect(res.body).toContain('91,64726444')
    })

    it('traz a resposta da IA recolhida, com destaque de sintaxe', async () => {
      const res = await parse()

      expect(res.body).toContain('Resposta da IA')
      // `collapse` sem `show`: começa fechada.
      expect(res.body).toContain('<div class="collapse" id="aiResponseBox">')
      expect(res.body).toContain('<span class="json-key">&quot;tradeDate&quot;</span>')
      expect(res.body).toContain('<span class="json-string">&quot;2026-07-15&quot;</span>')
    })

    it('não oferece download do arquivo que o usuário acabou de enviar', async () => {
      const res = await parse()
      const { id } = await db.brokerNote.findFirstOrThrow()

      expect(res.body).not.toContain(`href="/transactions/notes/${id}"`)
      // O da resposta fica, dentro do painel — é o único jeito de obtê-la como arquivo.
      expect(res.body).toContain(`href="/transactions/notes/${id}/response"`)
    })

    it('registra a nota no banco', async () => {
      await parse()

      const saved = await db.brokerNote.findFirstOrThrow()
      expect(saved).toMatchObject({ date: '2026-07-15', broker: 'XP', warning: null })
      expect(saved.fileName).toBe(`20260715_${saved.id}.pdf`)
    })

    it('leva a senha do formulário até o arquivo e arquiva as duas versões', async () => {
      const protegido = encryptedPdf('01234567890')
      const res = await app.inject({
        method: 'POST',
        url: '/transactions/parse-note',
        ...upload(protegido, { password: '01234567890' }),
      })

      expect(res.statusCode).toBe(200)
      const { id, fileName } = await db.brokerNote.findFirstOrThrow()
      expect(fileName).toBe(`20260715_${id}.pdf`)
      expect(needsPassword(readFileSync(join(notesDir, '2026', fileName)))).toBe(false)
      expect(readFileSync(join(notesDir, '2026', `20260715_${id}_orig.pdf`))).toEqual(protegido)
    })

    it('devolve 400 com a senha errada, sem registrar a nota', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transactions/parse-note',
        ...upload(encryptedPdf('01234567890'), { password: 'errada' }),
      })

      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Senha da nota incorreta')
      expect(await db.brokerNote.count()).toBe(0)
    })

    it('pede a senha quando a nota é protegida e o campo veio vazio', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transactions/parse-note',
        ...upload(encryptedPdf('01234567890')),
      })

      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('protegida por senha')
    })

    it('recusa requisição sem arquivo', async () => {
      const boundary = '----SemArquivo'
      const res = await app.inject({
        method: 'POST',
        url: '/transactions/parse-note',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload:
          `--${boundary}\r\nContent-Disposition: form-data; name="csv"\r\n\r\nvazio\r\n` +
          `--${boundary}--\r\n`,
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('downloads', () => {
    it('baixa o arquivo original', async () => {
      await parse()
      const { id } = await db.brokerNote.findFirstOrThrow()

      const res = await app.inject({ method: 'GET', url: `/transactions/notes/${id}` })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      expect(res.headers['content-disposition']).toContain(`20260715_${id}.pdf`)
      expect(res.rawPayload).toEqual(PDF)
    })

    it('baixa a resposta da Anthropic como JSON', async () => {
      await parse()
      const { id, aiResponse } = await db.brokerNote.findFirstOrThrow()

      const res = await app.inject({ method: 'GET', url: `/transactions/notes/${id}/response` })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/json')
      expect(res.headers['content-disposition']).toContain(`20260715_${id}.json`)
      expect(res.body).toBe(aiResponse)
      expect(aiResponse).toBe(RAW_RESPONSE)
    })

    it('404 em nota inexistente', async () => {
      const res = await app.inject({ method: 'GET', url: '/transactions/notes/9999' })
      expect(res.statusCode).toBe(404)
    })

    it('400 em id que não é número', async () => {
      const res = await app.inject({ method: 'GET', url: '/transactions/notes/abc' })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('vínculo com a transação', () => {
    it('liga as transações importadas à nota e mostra o link no histórico', async () => {
      await parse()
      await createAsset(db, 'XPLG11', { type: 'REIT' })
      const note = await db.brokerNote.findFirstOrThrow()

      const res = await app.inject({
        method: 'POST',
        url: '/transactions/batch',
        payload: {
          brokerNoteId: note.id,
          rows: [
            {
              ticker: 'XPLG11',
              date: '2026-07-15',
              type: 'BUY',
              quantity: 329,
              price: 91.64726444,
              fees: 9.03,
              broker: 'XP',
              notes: 'Nota 140232205',
              currency: 'BRL',
            },
          ],
        },
      })

      expect(res.json()).toEqual({ inserted: 1 })
      const created = await db.transaction.findFirstOrThrow()
      expect(created.brokerNoteId).toBe(note.id)

      const page = await app.inject({ method: 'GET', url: '/transactions/' })
      expect(page.body).toContain(`/transactions/notes/${note.id}"`)
    })

    it('importa sem nota quando o CSV foi colado à mão', async () => {
      await createAsset(db, 'PETR4')

      await app.inject({
        method: 'POST',
        url: '/transactions/batch',
        payload: {
          rows: [
            {
              ticker: 'PETR4',
              date: '2024-01-15',
              type: 'BUY',
              quantity: 10,
              price: 30,
              fees: 0,
              broker: '',
              notes: '',
              currency: 'BRL',
            },
          ],
        },
      })

      expect((await db.transaction.findFirstOrThrow()).brokerNoteId).toBeNull()
    })
  })

  it('deixa a aba de nota ativa quando a leitura está habilitada', async () => {
    const res = await app.inject({ method: 'GET', url: '/transactions/' })

    expect(res.body).toContain('Nota de negociação')
    expect(res.body).toContain('data-note-parse')
    expect(res.body).not.toContain('configure APP_ANTHROPIC_API_KEY')
  })
})

describe('sem APP_ANTHROPIC_API_KEY', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
  })

  afterAll(async () => {
    await h.close()
  })

  it('mostra a aba de nota desativada, com o motivo', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/transactions/' })

    expect(res.statusCode).toBe(200)
    // A aba continua visível: escondê-la faria o usuário procurar uma funcionalidade
    // que ele nem sabe que existe.
    expect(res.body).toContain('Nota de negociação')
    // O title fica no <span> de fora: botão desativado não recebe hover no Bootstrap.
    expect(res.body).toContain('<span class="d-inline-block" title="Leitura de nota desativada')
    expect(res.body).toContain('aria-disabled="true"')
    expect(res.body).toContain('configure APP_ANTHROPIC_API_KEY para habilitar')
    // Sem chave o formulário de envio não vai junto.
    expect(res.body).not.toContain('data-note-parse')
  })
})
