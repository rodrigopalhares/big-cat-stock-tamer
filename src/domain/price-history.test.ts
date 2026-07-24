import { describe, expect, it } from 'vitest'
import { type IsoDate, isoDate } from '../shared/iso-date.js'
import {
  type AssetTickerInfo,
  categorizeAssets,
  type DatedPrice,
  filterBatchToRecords,
  resolveYfTicker,
} from './price-history.js'

// Porte de ResolveYfTickerTest, CategorizeAssetsTest e FilterBatchToRecordsTest
// em src/test/kotlin/com/stocks/service/PriceHistoryServiceTest.kt

const asset = (
  ticker: string,
  yfTicker: string | null,
  type: string,
  delisted = false,
): AssetTickerInfo => ({ ticker, yfTicker, type, delisted })

describe('resolveYfTicker', () => {
  it('usa o símbolo explícito quando existe', () => {
    expect(resolveYfTicker('PETR4', 'PETR4.SA')).toBe('PETR4.SA')
  })

  it('sem símbolo, acrescenta .SA para ação brasileira', () => {
    expect(resolveYfTicker('PETR4', null)).toBe('PETR4.SA')
  })

  it('ticker com ponto é mantido como está', () => {
    expect(resolveYfTicker('SAP.DE', null)).toBe('SAP.DE')
  })
})

describe('categorizeAssets', () => {
  it('ação vai para o mapa do Yahoo', () => {
    const result = categorizeAssets([asset('PETR4', null, 'STOCK')])
    expect([...result.yfTickerMap]).toEqual([['PETR4.SA', 'PETR4']])
    expect(result.tdTickerMap.size).toBe(0)
  })

  it('Tesouro vai para o mapa próprio', () => {
    const result = categorizeAssets([asset('TD1', 'Tesouro Selic;01/03/2029', 'TESOURO_DIRETO')])
    expect(result.yfTickerMap.size).toBe(0)
    expect([...result.tdTickerMap]).toEqual([['Tesouro Selic;01/03/2029', 'TD1']])
  })

  it('Tesouro sem símbolo é descartado', () => {
    const result = categorizeAssets([asset('TD1', null, 'TESOURO_DIRETO')])
    expect(result.yfTickerMap.size).toBe(0)
    expect(result.tdTickerMap.size).toBe(0)
  })

  it('mistura de ativos vai para os mapas certos', () => {
    const result = categorizeAssets([
      asset('PETR4', null, 'STOCK'),
      asset('TD1', 'Tesouro Selic;01/03/2029', 'TESOURO_DIRETO'),
      asset('BOVA11', 'BOVA11.SA', 'ETF'),
    ])
    expect(Object.fromEntries(result.yfTickerMap)).toEqual({
      'PETR4.SA': 'PETR4',
      'BOVA11.SA': 'BOVA11',
    })
    expect(Object.fromEntries(result.tdTickerMap)).toEqual({ 'Tesouro Selic;01/03/2029': 'TD1' })
  })

  it('ativo deslistado é pulado', () => {
    const result = categorizeAssets([
      asset('PETR4', null, 'STOCK', true),
      asset('VALE3', null, 'STOCK'),
    ])
    expect(Object.fromEntries(result.yfTickerMap)).toEqual({ 'VALE3.SA': 'VALE3' })
  })

  it.each(['RENDA_FIXA', 'OUTROS'])('tipo sem cotação (%s) é pulado', (type) => {
    const result = categorizeAssets([asset('CDB1', null, type)])
    expect(result.yfTickerMap.size).toBe(0)
    expect(result.tdTickerMap.size).toBe(0)
  })

  it('tipo nulo cai no mapa do Yahoo', () => {
    const result = categorizeAssets([{ ticker: 'PETR4', yfTicker: null, type: null }])
    expect(Object.fromEntries(result.yfTickerMap)).toEqual({ 'PETR4.SA': 'PETR4' })
  })
})

describe('filterBatchToRecords', () => {
  const batch = (entries: Array<[string, Array<[string, number]>]>) =>
    new Map<string, DatedPrice[]>(
      entries.map(([k, v]) => [k, v.map(([d, p]) => [isoDate(d), p] as DatedPrice)]),
    )

  it('lote vazio', () => {
    expect(filterBatchToRecords(new Map(), () => true)).toEqual([])
  })

  it('filtra por data', () => {
    const cutoff = isoDate('2024-06-01')
    const result = filterBatchToRecords(
      batch([
        [
          'PETR4',
          [
            ['2024-05-01', 30],
            ['2024-06-01', 31],
            ['2024-07-01', 32],
          ],
        ],
      ]),
      (_, date) => date >= cutoff,
    )

    expect(result).toEqual([
      { assetId: 'PETR4', date: '2024-06-01', close: 31 },
      { assetId: 'PETR4', date: '2024-07-01', close: 32 },
    ])
  })

  it('traduz a chave do lote pelo resolver', () => {
    const resolverMap = new Map([['Tesouro Selic;01/03/2029', 'TD1']])
    const result = filterBatchToRecords(
      batch([['Tesouro Selic;01/03/2029', [['2024-01-01', 14000]]]]),
      () => true,
      (key) => resolverMap.get(key) ?? null,
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.assetId).toBe('TD1')
  })

  it('resolver devolvendo null descarta a série', () => {
    const result = filterBatchToRecords(
      batch([['UNKNOWN', [['2024-01-01', 100]]]]),
      () => true,
      () => null,
    )
    expect(result).toEqual([])
  })

  it('o predicado recebe o ticker já resolvido', () => {
    const seen: string[] = []
    filterBatchToRecords(
      batch([['Tesouro Selic;01/03/2029', [['2024-01-01', 14000]]]]),
      (ticker: string, _date: IsoDate) => {
        seen.push(ticker)
        return true
      },
      () => 'TD1',
    )
    expect(seen).toEqual(['TD1'])
  })
})
