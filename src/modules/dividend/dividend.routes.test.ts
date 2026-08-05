import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset } from '../../../tests/factories.js'
import { buildXlsx, movimentacaoXlsx } from '../../../tests/xlsx.js'
import { buildApp } from '../../app.js'
import { loadEnv } from '../../config/env.js'

/**
 * Upload do extrato de Movimentação da B3. Os dados são fictícios de propósito — o que o
 * teste fixa é o formato do arquivo, não a carteira.
 */

const XP = 'XP INVESTIMENTOS CCTVM S/A.'

function extrato(rows: readonly (readonly string[])[]) {
  return Buffer.from(movimentacaoXlsx(rows))
}

/** Corpo multipart montado à mão, como no teste da nota de negociação. */
function upload(content: Buffer, fileName = 'movimentacao.xlsx') {
  const boundary = '----ExtratoB3'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n',
  )
  return {
    payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

describe('POST /dividends/parse-xlsx', () => {
  let db: TestDb
  let app: FastifyInstance

  beforeAll(async () => {
    db = await createTestDb()
    app = await buildApp({
      env: loadEnv({ ...process.env, DATABASE_URL: ':memory:', LOG_LEVEL: 'silent' }),
      db,
    })
    await app.ready()
  })

  afterEach(async () => {
    await clearAllData(db)
  })

  afterAll(async () => {
    await app.close()
    await db.$disconnect()
  })

  const parse = (file: Buffer) =>
    app.inject({ method: 'POST', url: '/dividends/parse-xlsx', ...upload(file) })

  it('devolve o preview com o provento e o resumo do que foi descartado', async () => {
    await createAsset(db, 'PETR4')

    const res = await parse(
      extrato([
        ['Credito', '10/06/2026', 'Rendimento', 'PETR4 - PAPEL DE TESTE', XP, '100', '-', '500'],
        ['Credito', '10/06/2026', 'Transferência', 'PETR4 - PAPEL DE TESTE', XP, '100', '-', '-'],
      ]),
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('PETR4')
    expect(res.body).toContain('RENDIMENTO')
    expect(res.body).toContain('1 linhas de custódia descartadas')
  })

  it('destaca o reembolso, que pode ser JCP disfarçado', async () => {
    await createAsset(db, 'PETR4')

    const res = await parse(
      extrato([
        ['Credito', '01/07/2026', 'Reembolso', 'PETR4 - PAPEL DE TESTE', XP, '0', '-', '23.79'],
      ]),
    )

    expect(res.body).toContain('dividendo ou JCP')
  })

  it('arquivo que não é o extrato da B3 vira 400, não 500', async () => {
    const res = await parse(Buffer.from(buildXlsx([['Ticker', 'Data']])))

    expect(res.statusCode).toBe(400)
  })

  it('multipart sem arquivo vira 400', async () => {
    const boundary = '----ExtratoB3'
    const res = await app.inject({
      method: 'POST',
      url: '/dividends/parse-xlsx',
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="outro"\r\n\r\nx\r\n--${boundary}--\r\n`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    })

    expect(res.statusCode).toBe(400)
  })
})
