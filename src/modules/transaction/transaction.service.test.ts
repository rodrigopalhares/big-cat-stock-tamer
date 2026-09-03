import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createExchangeRate, createTransaction } from '../../../tests/factories.js'
import { server, yahooChart } from '../../../tests/msw.js'
import { BcbClient } from '../../integrations/bcb/bcb.client.js'
import { YahooClient } from '../../integrations/yahoo/yahoo.client.js'
import { isoDate } from '../../shared/iso-date.js'
import { AssetClassService } from '../allocation/asset-class.service.js'
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'
import { TransactionService } from './transaction.service.js'

// Porte de src/test/kotlin/com/stocks/service/TransactionServiceTest.kt

describe('TransactionService', () => {
  let db: TestDb
  let service: TransactionService

  beforeAll(async () => {
    db = await createTestDb()
    service = new TransactionService(
      db,
      new YahooClient(),
      new ExchangeRateService(db, new BcbClient()),
      new AssetClassService(db),
    )
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  describe('resolvePrice', () => {
    it('preço e taxas informados diretamente', () => {
      expect(service.resolvePrice('BUY', 25.5, null, 10, 100)).toEqual({ price: 25.5, fees: 10 })
    })

    it('valor bruto sem preço unitário calcula o preço, sem tocar nas taxas', () => {
      // 2500 / 100 = 25 — as taxas ficam fora do bruto
      expect(service.resolvePrice('BUY', null, 2500, 10, 100)).toEqual({ price: 25, fees: 10 })
    })

    it('com preço e bruto juntos o preço ganha', () => {
      // O bruto vem arredondado em centavos; o preço tem quatro casas e é quem manda.
      expect(service.resolvePrice('BUY', 25.1234, 2512.34, 7, 100)).toEqual({
        price: 25.1234,
        fees: 7,
      })
    })

    it('sem preço e sem bruto dá 400', () => {
      expect(() => service.resolvePrice('BUY', null, null, 0, 100)).toThrow(
        /Informe o preço unitário ou o valor bruto/,
      )
    })

    it('preço zero e sem bruto dá 400', () => {
      expect(() => service.resolvePrice('BUY', 0, null, 0, 100)).toThrow()
    })

    it('desdobramento não exige preço e zera preço e taxas', () => {
      expect(service.resolvePrice('DESDOBRAMENTO', null, null, 0, 100)).toEqual({
        price: 0,
        fees: 0,
      })
    })

    it('agrupamento descarta preço e taxas digitados', () => {
      expect(service.resolvePrice('AGRUPAMENTO', 99, null, 7, 100)).toEqual({ price: 0, fees: 0 })
    })

    it('bonificação sem custo atribuído vale zero', () => {
      expect(service.resolvePrice('BONIFICACAO', null, null, 0, 10)).toEqual({ price: 0, fees: 0 })
    })

    it('bonificação preserva o custo atribuído e zera as taxas', () => {
      expect(service.resolvePrice('BONIFICACAO', 5, null, 7, 10)).toEqual({ price: 5, fees: 0 })
    })

    it('redução de capital exige valor por ação, como compra e venda', () => {
      expect(() => service.resolvePrice('REDUCAO_CAPITAL', null, null, 0, 100)).toThrow(
        /Informe o preço unitário ou o valor bruto/,
      )
    })

    it('redução de capital deduz o valor por ação a partir do bruto recebido', () => {
      // (200 − 0) / 100 = 2 por ação
      expect(service.resolvePrice('REDUCAO_CAPITAL', null, 200, 0, 100)).toEqual({
        price: 2,
        fees: 0,
      })
    })

    it('tipo desconhecido não passa em silêncio', () => {
      expect(() => service.resolvePrice('QUALQUER', 10, null, 0, 1)).toThrow(
        /Tipo de transação desconhecido/,
      )
    })
  })

  describe('eventos societários', () => {
    beforeEach(async () => {
      await createAsset(db, 'PETR4')
    })

    it('bonificação é gravada positiva, com o custo atribuído', async () => {
      const tx = await service.createTransaction('PETR4', {
        type: 'BONIFICACAO',
        quantity: 10,
        price: 5,
        fees: 0,
        date: isoDate('2024-03-01'),
      })

      expect(tx).toMatchObject({ type: 'BONIFICACAO', quantity: 10, price: 5, fees: 0 })
    })

    it('desdobramento grava preço e taxas zerados mesmo se vierem preenchidos', async () => {
      const tx = await service.createTransaction('PETR4', {
        type: 'DESDOBRAMENTO',
        quantity: 100,
        price: 42,
        fees: 9,
        date: isoDate('2024-03-01'),
      })

      expect(tx).toMatchObject({ type: 'DESDOBRAMENTO', quantity: 100, price: 0, fees: 0 })
      expect(tx.priceBrl).toBe(0)
      expect(tx.feesBrl).toBe(0)
    })

    it('agrupamento é gravado com quantidade negativa', async () => {
      await createTransaction(db, 'PETR4', { quantity: 1000 })

      const tx = await service.createTransaction('PETR4', {
        type: 'AGRUPAMENTO',
        quantity: 900,
        price: 0,
        fees: 0,
        date: isoDate('2024-03-01'),
      })

      expect(tx).toMatchObject({ type: 'AGRUPAMENTO', quantity: -900 })
    })

    it('tipo em minúscula é normalizado', async () => {
      const tx = await service.createTransaction('PETR4', {
        type: 'desdobramento',
        quantity: 50,
        price: 0,
        fees: 0,
        date: isoDate('2024-03-01'),
      })

      expect(tx.type).toBe('DESDOBRAMENTO')
    })

    it('redução de capital é gravada positiva e mantém o valor por ação', async () => {
      const tx = await service.createTransaction('PETR4', {
        type: 'REDUCAO_CAPITAL',
        quantity: 100,
        price: 2,
        fees: 0,
        date: isoDate('2024-03-01'),
      })

      expect(tx).toMatchObject({ type: 'REDUCAO_CAPITAL', quantity: 100, price: 2 })
    })

    it('editar para agrupamento inverte o sinal e limpa o preço', async () => {
      await createTransaction(db, 'PETR4', { quantity: 100, price: 20 })
      const created = await createTransaction(db, 'PETR4', { quantity: 100, price: 20 })

      await service.updateTransaction(created.id, {
        type: 'AGRUPAMENTO',
        quantity: 90,
        price: 20,
        fees: 3,
        date: isoDate('2024-04-01'),
      })

      const updated = await db.transaction.findUniqueOrThrow({ where: { id: created.id } })
      expect(updated).toMatchObject({ type: 'AGRUPAMENTO', quantity: -90, price: 0, fees: 0 })
    })
  })

  describe('convertPrices', () => {
    it('mesma moeda BRL não converte', async () => {
      expect(await service.convertPrices(30, 1, 'BRL', 'BRL', isoDate('2024-01-15'))).toEqual({
        price: 30,
        fees: 1,
        priceBrl: 30,
        feesBrl: 1,
      })
    })

    it('mesma moeda USD converte só o valor em reais', async () => {
      await createExchangeRate(db, '2024-01-15', 5)

      expect(await service.convertPrices(100, 2, 'USD', 'USD', isoDate('2024-01-15'))).toEqual({
        price: 100,
        fees: 2,
        priceBrl: 500,
        feesBrl: 10,
      })
    })

    it('entrada em BRL para ativo em USD divide pela taxa', async () => {
      await createExchangeRate(db, '2024-01-15', 5)

      expect(await service.convertPrices(500, 10, 'BRL', 'USD', isoDate('2024-01-15'))).toEqual({
        price: 100,
        fees: 2,
        priceBrl: 500,
        feesBrl: 10,
      })
    })

    it('entrada em USD para ativo em BRL multiplica pela taxa', async () => {
      await createExchangeRate(db, '2024-01-15', 5)

      expect(await service.convertPrices(100, 2, 'USD', 'BRL', isoDate('2024-01-15'))).toEqual({
        price: 500,
        fees: 10,
        priceBrl: 500,
        feesBrl: 10,
      })
    })
  })

  describe('findOrCreateAsset', () => {
    it('devolve o ativo existente sem consultar o Yahoo', async () => {
      await createAsset(db, 'PETR4', { name: 'Petrobras' })

      const asset = await service.findOrCreateAsset('petr4')

      expect(asset.name).toBe('Petrobras')
    })

    it('cria o ativo com os dados do Yahoo quando não existe', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const asset = await service.findOrCreateAsset('PETR3')

      expect(asset.ticker).toBe('PETR3')
      expect(asset.name).toContain('Petrobras')
      expect(asset.currency).toBe('BRL')
    })

    it('ticker não encontrado grava nome nulo', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      const asset = await service.findOrCreateAsset('XXXX9')

      expect(asset.name).toBeNull()
    })
  })

  describe('createTransaction', () => {
    it('grava compra com quantidade positiva', async () => {
      await createAsset(db, 'PETR4')

      const tx = await service.createTransaction('petr4', {
        type: 'BUY',
        quantity: 100,
        price: 25.5,
        fees: 10,
        date: isoDate('2024-06-01'),
      })

      expect(tx).toMatchObject({ assetId: 'PETR4', type: 'BUY', quantity: 100, price: 25.5 })
    })

    it('venda é gravada com quantidade negativa', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4', { quantity: 100 })

      const tx = await service.createTransaction('PETR4', {
        type: 'sell',
        quantity: 50,
        price: 30,
        fees: 0,
        date: isoDate('2024-06-01'),
      })

      expect(tx.type).toBe('SELL')
      expect(tx.quantity).toBe(-50)
    })

    it('corretora e observação em branco viram null', async () => {
      await createAsset(db, 'PETR4')

      const tx = await service.createTransaction('PETR4', {
        type: 'BUY',
        quantity: 10,
        price: 25,
        fees: 0,
        date: isoDate('2024-06-01'),
        broker: '   ',
        notes: '',
      })

      expect(tx.broker).toBeNull()
      expect(tx.notes).toBeNull()
    })

    it('a moeda gravada é sempre a do ativo', async () => {
      await createAsset(db, 'AAPL', { currency: 'USD' })
      await createExchangeRate(db, '2024-06-01', 5)

      const tx = await service.createTransaction('AAPL', {
        type: 'BUY',
        quantity: 10,
        price: 500,
        fees: 0,
        date: isoDate('2024-06-01'),
        inputCurrency: 'BRL',
      })

      expect(tx.currency).toBe('USD')
      expect(tx.price).toBeCloseTo(100, 3)
      expect(tx.priceBrl).toBeCloseTo(500, 3)
    })
  })

  describe('createTransactionForExistingAsset', () => {
    it('ativo inexistente dá 404', async () => {
      await expect(
        service.createTransactionForExistingAsset('XXXX9', {
          type: 'BUY',
          quantity: 1,
          price: 1,
          fees: 0,
          date: isoDate('2024-06-01'),
        }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('listTransactions', () => {
    beforeEach(async () => {
      await createAsset(db, 'PETR4', { type: 'STOCK', hasPosition: true })
      await createAsset(db, 'HGLG11', { type: 'REIT', hasPosition: false })
      await createTransaction(db, 'PETR4', { date: '2024-01-10' })
      await createTransaction(db, 'PETR4', { date: '2024-03-20' })
      await createTransaction(db, 'HGLG11', { date: '2024-02-15' })
    })

    it('ordena por data decrescente', async () => {
      const result = await service.listTransactions()
      expect(result.map((t) => t.date)).toEqual(['2024-03-20', '2024-02-15', '2024-01-10'])
    })

    it('filtra por ticker', async () => {
      expect(await service.listTransactions({ ticker: 'petr4' })).toHaveLength(2)
    })

    it('filtra por tipo de ativo', async () => {
      const result = await service.listTransactions({ type: 'REIT' })
      expect(result.map((t) => t.assetId)).toEqual(['HGLG11'])
    })

    it('filtra por posição', async () => {
      const result = await service.listTransactions({ position: 'with' })
      expect(result.every((t) => t.assetId === 'PETR4')).toBe(true)
    })

    it('pagina com limit e offset, mantendo a ordem', async () => {
      const first = await service.listTransactions({}, { limit: 2, offset: 0 })
      const second = await service.listTransactions({}, { limit: 2, offset: 2 })

      expect(first.map((t) => t.date)).toEqual(['2024-03-20', '2024-02-15'])
      expect(second.map((t) => t.date)).toEqual(['2024-01-10'])
    })

    it('countTransactions conta o total do filtro, não da página', async () => {
      expect(await service.countTransactions()).toBe(3)
      expect(await service.countTransactions({ type: 'REIT' })).toBe(1)
    })

    it('busca por trecho do ticker, sem diferenciar caixa', async () => {
      expect(await service.listTransactions({ search: 'petr' })).toHaveLength(2)
      expect(await service.listTransactions({ search: 'LG1' })).toHaveLength(1)
      expect(await service.listTransactions({ search: 'xyz' })).toEqual([])
    })

    it('filtra por ano', async () => {
      await createTransaction(db, 'PETR4', { date: '2023-12-31' })

      expect(await service.listTransactions({ year: 2024 })).toHaveLength(3)
      expect(await service.listTransactions({ year: 2023 })).toHaveLength(1)
    })

    it('listYears devolve os anos com transação, do mais recente ao mais antigo', async () => {
      await createTransaction(db, 'PETR4', { date: '2022-05-05' })

      expect(await service.listYears()).toEqual([2024, 2022])
    })

    it('position=all não filtra', async () => {
      expect(await service.listTransactions({ position: 'all' })).toHaveLength(3)
    })
  })

  describe('updateTransaction e deleteTransaction', () => {
    it('atualiza e devolve o ticker afetado', async () => {
      await createAsset(db, 'PETR4')
      await createTransaction(db, 'PETR4')
      const tx = await createTransaction(db, 'PETR4')

      const assetId = await service.updateTransaction(tx.id, {
        type: 'SELL',
        quantity: 5,
        price: 40,
        fees: 2,
        date: isoDate('2024-07-01'),
      })

      expect(assetId).toBe('PETR4')
      const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })
      expect(updated.quantity).toBe(-5)
      expect(updated.price).toBe(40)
    })

    it('atualizar transação inexistente dá 404', async () => {
      await expect(
        service.updateTransaction(9999, {
          type: 'BUY',
          quantity: 1,
          price: 1,
          fees: 0,
          date: isoDate('2024-01-01'),
        }),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('apaga e devolve o ticker afetado', async () => {
      await createAsset(db, 'PETR4')
      const tx = await createTransaction(db, 'PETR4')

      expect(await service.deleteTransaction(tx.id)).toBe('PETR4')
      expect(await db.transaction.count()).toBe(0)
    })

    it('apagar transação inexistente dá 404', async () => {
      await expect(service.deleteTransaction(9999)).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('posição não pode ficar negativa', () => {
    beforeEach(async () => {
      await createAsset(db, 'ITUB3')
      await createTransaction(db, 'ITUB3', { quantity: 1586, date: '2024-01-15' })
    })

    const sell = (quantity: number, date: string) => ({
      type: 'SELL',
      quantity,
      price: 40,
      fees: 0,
      date: isoDate(date),
    })

    it('venda maior que a posição dá 400 dizendo quanto havia na data', async () => {
      await expect(
        service.createTransaction('ITUB3', sell(999999, '2026-01-01')),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Venda de 999.999 ITUB3 em 01/01/2026 supera a posição de 1.586 na data.',
      })
      expect(await db.transaction.count()).toBe(1)
    })

    it('venda com data anterior à compra é barrada mesmo havendo posição hoje', async () => {
      await expect(
        service.createTransaction('ITUB3', sell(10, '2023-12-01')),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Venda de 10 ITUB3 em 01/12/2023 supera a posição de 0 na data.',
      })
    })

    it('venda que zera a posição passa', async () => {
      await expect(
        service.createTransaction('ITUB3', sell(1586, '2026-01-01')),
      ).resolves.toBeDefined()
    })

    it('agrupamento acima da posição usa o próprio rótulo na mensagem', async () => {
      await expect(
        service.createTransaction('ITUB3', {
          type: 'AGRUPAMENTO',
          quantity: 2000,
          price: 0,
          fees: 0,
          date: isoDate('2026-01-01'),
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: /^Agrupamento de 2\.000 ITUB3/ })
    })

    it('editar a única compra para venda dá 400 — a linha em edição sai da conta', async () => {
      const buy = await db.transaction.findFirstOrThrow()

      await expect(service.updateTransaction(buy.id, sell(10, '2026-01-01'))).rejects.toMatchObject(
        {
          statusCode: 400,
        },
      )
      expect((await db.transaction.findUniqueOrThrow({ where: { id: buy.id } })).type).toBe('BUY')
    })

    it('editar a própria venda não a conta duas vezes', async () => {
      const existing = await service.createTransaction('ITUB3', sell(1586, '2025-01-01'))

      await expect(
        service.updateTransaction(existing.id, { ...sell(1586, '2025-01-01'), price: 41 }),
      ).resolves.toBe('ITUB3')
    })

    it('quantidade zero dá 400', async () => {
      await expect(
        service.createTransaction('ITUB3', { ...sell(0, '2026-01-01'), type: 'BUY' }),
      ).rejects.toMatchObject({ statusCode: 400, message: 'Quantidade deve ser maior que zero' })
    })
  })

  describe('lookupTickerInfo', () => {
    it('ticker curto demais devolve NOT_FOUND sem consultar nada', async () => {
      expect(await service.lookupTickerInfo('AB')).toEqual({
        ticker: 'AB',
        name: null,
        type: null,
        status: 'NOT_FOUND',
      })
    })

    it('ticker cadastrado devolve EXISTS', async () => {
      await createAsset(db, 'PETR4', { name: 'Petrobras', type: 'STOCK' })

      expect(await service.lookupTickerInfo('petr4')).toMatchObject({
        ticker: 'PETR4',
        name: 'Petrobras',
        status: 'EXISTS',
      })
    })

    it('ticker encontrado no Yahoo devolve FOUND_ONLINE', async () => {
      server.use(yahooChart('yahoo_chart_petr3.json'))

      const result = await service.lookupTickerInfo('PETR3')
      expect(result.status).toBe('FOUND_ONLINE')
      expect(result.name).toContain('Petrobras')
    })

    it('ticker não encontrado devolve NOT_FOUND', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      expect(await service.lookupTickerInfo('XXXX9')).toMatchObject({ status: 'NOT_FOUND' })
    })
  })
})
