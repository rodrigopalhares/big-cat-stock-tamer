import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset } from '../../../tests/factories.js'
import type { BrokerNoteData } from '../../domain/broker-note.js'
import type {
  AnthropicClient,
  BrokerNoteExtraction,
} from '../../integrations/anthropic/anthropic.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { BrokerNoteService } from './broker-note.service.js'

/** A nota 140232205 da XP, reduzida a três execuções com os mesmos totais. */
const NOTE: BrokerNoteData = {
  date: isoDate('2026-07-15'),
  broker: 'XP',
  noteNumber: '140232205',
  totalFees: 9.03,
  totalAmount: 30160.98,
  trades: [
    [100, 91.67],
    [200, 91.63695],
    [29, 91.64],
  ].map(([quantity = 0, price = 0]) => ({
    ticker: 'XPLG11',
    security: 'FII XP LOG',
    tickerSource: 'NOTE' as const,
    side: 'C' as const,
    quantity,
    price,
  })),
}

/** A 139054003: a nota não imprime o código, só "CSU DIGITAL" e "METAL LEVE". */
const NOTE_SEM_TICKER: BrokerNoteData = {
  date: isoDate('2026-06-26'),
  broker: 'XP',
  noteNumber: '139054003',
  totalFees: 8.49,
  totalAmount: 28384.49,
  trades: [
    { security: 'CSU DIGITAL', quantity: 1000, price: 15.168 },
    { security: 'METAL LEVE', quantity: 400, price: 33.02 },
  ].map((t) => ({ ...t, ticker: '', tickerSource: 'NONE' as const, side: 'C' as const })),
}

function fakeAnthropic(extraction: Partial<BrokerNoteExtraction> = {}): AnthropicClient {
  const stub = {
    enabled: true,
    extractBrokerNote: () =>
      Promise.resolve({
        note: NOTE,
        fees: [{ label: 'Taxa de liquidação', value: 6.75 }],
        checkedTotal: 30160.98,
        checkNotes: 'Confere.',
        ...extraction,
      }),
  }
  return stub as unknown as AnthropicClient
}

const upload = {
  file: Buffer.from('%PDF-1.4 conteúdo da nota'),
  fileName: 'NotaNegociacao-7964657-15-07-2026-0.pdf',
  contentType: 'application/pdf',
}

describe('BrokerNoteService', () => {
  let db: TestDb
  const dirs: string[] = []

  const serviceIn = (dir: string) => new BrokerNoteService(db, fakeAnthropic(), dir)
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'stocks-notas-test-'))
    dirs.push(dir)
    return dir
  }

  beforeAll(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await clearAllData(db)
  })

  afterAll(async () => {
    await db.$disconnect()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('salva o arquivo em <ano>/<yyyyMMdd>_<id>.<extensão>', async () => {
    const dir = tempDir()
    const result = await serviceIn(dir).importNote(upload)

    expect(result.fileName).toBe(`20260715_${result.id}.pdf`)
    const path = join(dir, '2026', result.fileName)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path)).toEqual(upload.file)
  })

  it('persiste a nota com o CSV extraído', async () => {
    const result = await serviceIn(tempDir()).importNote(upload)
    const saved = await db.brokerNote.findUniqueOrThrow({ where: { id: result.id } })

    expect(saved).toMatchObject({
      date: '2026-07-15',
      broker: 'XP',
      noteNumber: '140232205',
      originalName: upload.fileName,
      totalAmount: 30160.98,
      totalFees: 9.03,
      warning: null,
    })
    expect(saved.csv).toBe(
      'XPLG11\t15/07/2026\tC\t329\t91,64726444\t9,03\tXP\t0\tBRL\tNota 140232205',
    )
    expect(saved.fileName).toBe(`20260715_${result.id}.pdf`)
  })

  it('agrupa as execuções num único grupo, com as taxas inteiras', async () => {
    const result = await serviceIn(tempDir()).importNote(upload)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({ ticker: 'XPLG11', quantity: 329, fees: 9.03 })
    expect(result.check.ok).toBe(true)
  })

  it('grava o aviso quando a conferência não fecha', async () => {
    const divergent = new BrokerNoteService(
      db,
      fakeAnthropic({ note: { ...NOTE, totalAmount: 30500 } }),
      tempDir(),
    )
    const result = await divergent.importNote(upload)
    const saved = await db.brokerNote.findUniqueOrThrow({ where: { id: result.id } })

    expect(result.check.ok).toBe(false)
    expect(saved.warning).toContain('não confere')
  })

  it('não deixa nota órfã quando a gravação do arquivo falha', async () => {
    const dir = tempDir()
    // Arquivo no lugar da pasta do ano: o mkdir falha com ENOTDIR.
    writeFileSync(join(dir, '2026'), 'não é pasta')

    await expect(serviceIn(dir).importNote(upload)).rejects.toThrow(/não foi possível salvar/i)
    expect(await db.brokerNote.count()).toBe(0)
  })

  it('devolve o arquivo original para download', async () => {
    const service = serviceIn(tempDir())
    const { id } = await service.importNote(upload)

    const file = await service.readFile(id)
    expect(file.content).toEqual(upload.file)
    expect(file.contentType).toBe('application/pdf')
    expect(file.fileName).toBe(`20260715_${id}.pdf`)
  })

  it('devolve o retorno da Anthropic como CSV para download', async () => {
    const service = serviceIn(tempDir())
    const { id, csv } = await service.importNote(upload)

    const file = await service.readCsv(id)
    expect(file.content.toString('utf8')).toBe(csv)
    expect(file.fileName).toBe(`20260715_${id}.csv`)
    expect(file.contentType).toContain('text/csv')
  })

  it('404 em nota inexistente', async () => {
    await expect(serviceIn(tempDir()).findNote(999)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404 quando o arquivo sumiu do disco', async () => {
    const dir = tempDir()
    const service = serviceIn(dir)
    const { id, fileName } = await service.importNote(upload)
    rmSync(join(dir, '2026', fileName))

    await expect(service.readFile(id)).rejects.toMatchObject({ statusCode: 404 })
  })

  describe('nota sem o código de negociação impresso', () => {
    const serviceSemTicker = (dir: string) =>
      new BrokerNoteService(db, fakeAnthropic({ note: NOTE_SEM_TICKER }), dir)

    it('resolve o ticker pelo nome do papel contra os ativos cadastrados', async () => {
      await createAsset(db, 'CSUD3', { name: 'CSU Digital S.A.' })
      await createAsset(db, 'LEVE3', { name: 'MAHLE Metal Leve S.A.' })

      const result = await serviceSemTicker(tempDir()).importNote(upload)

      expect(result.groups.map((g) => [g.ticker, g.tickerSource])).toEqual([
        ['CSUD3', 'NAME'],
        ['LEVE3', 'NAME'],
      ])
      expect(result.csv).toContain('CSUD3\t26/06/2026\tC\t1000')
      expect(result.csv).toContain('LEVE3\t26/06/2026\tC\t400')
    })

    it('deixa o ticker em branco quando o nome não bate com nada', async () => {
      const result = await serviceSemTicker(tempDir()).importNote(upload)

      expect(result.groups.map((g) => g.tickerSource)).toEqual(['NONE', 'NONE'])
      // Sem ticker a linha vai para a revisão em branco, com o papel nas observações.
      expect(result.csv.split('\n')[0]).toBe(
        '\t26/06/2026\tC\t1000\t15,168\t4,54\tXP\t0\tBRL\tNota 139054003 · CSU DIGITAL',
      )
    })

    it('não chuta entre duas classes da mesma empresa', async () => {
      await createAsset(db, 'CSUD3', { name: 'CSU Digital S.A.' })
      await createAsset(db, 'CSUD4', { name: 'CSU Digital S.A.' })

      const result = await serviceSemTicker(tempDir()).importNote(upload)

      expect(result.groups[0]).toMatchObject({ ticker: '', tickerSource: 'NONE' })
    })

    it('não vai ao banco quando a nota já traz todos os códigos', async () => {
      const result = await serviceIn(tempDir()).importNote(upload)

      expect(result.groups[0]?.tickerSource).toBe('NOTE')
    })
  })

  it('segue desabilitado quando o cliente da Anthropic não tem chave', () => {
    const disabled = { enabled: false } as unknown as AnthropicClient
    expect(new BrokerNoteService(db, disabled, tempDir()).enabled).toBe(false)
  })
})
