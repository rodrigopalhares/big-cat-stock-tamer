import { describe, expect, it } from 'vitest'
import {
  BCB_PTAX,
  BCB_SGS,
  bcbPtax,
  bcbSeries,
  HttpResponse,
  http,
  server,
} from '../../../tests/msw.js'
import { isoDate } from '../../shared/iso-date.js'
import { BcbClient } from './bcb.client.js'

// Porte de BcbPtaxClient.kt e de `fetchCdiAnnualRate` de BenchmarkService.kt,
// exercitados pelo ExchangeRateServiceTest e pelo fixture bcb_ptax_period.json.

const client = () => new BcbClient()

describe('fetchPtaxRange', () => {
  it('devolve cotações de compra e venda com a data extraída', async () => {
    server.use(bcbPtax('bcb_ptax_period.json'))

    const quotes = await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))

    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes[0]).toEqual({ date: '2025-03-05', buyRate: 5.7908, sellRate: 5.7914 })
  })

  it('descarta a hora do campo dataHoraCotacao', async () => {
    server.use(bcbPtax('bcb_ptax_period.json'))

    const quotes = await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))
    for (const quote of quotes) expect(quote.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('formata a data como MM-dd-yyyy na URL, como o PTAX exige', async () => {
    let requestUrl = ''
    server.use(
      http.get(BCB_PTAX, ({ request }) => {
        requestUrl = decodeURIComponent(request.url)
        return HttpResponse.json({ value: [] })
      }),
    )

    await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-12-31'))

    expect(requestUrl).toContain("@dataInicial='03-05-2025'")
    expect(requestUrl).toContain("@dataFinalCotacao='12-31-2025'")
  })

  it('erro da API devolve lista vazia', async () => {
    server.use(http.get(BCB_PTAX, () => new HttpResponse(null, { status: 500 })))

    expect(await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))).toEqual([])
  })

  it('resposta sem value devolve lista vazia', async () => {
    server.use(http.get(BCB_PTAX, () => HttpResponse.json({})))

    expect(await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))).toEqual([])
  })

  it('cotação com data inválida é descartada, sem derrubar as demais', async () => {
    server.use(
      http.get(BCB_PTAX, () =>
        HttpResponse.json({
          value: [
            { cotacaoCompra: 5.0, cotacaoVenda: 5.1, dataHoraCotacao: 'lixo' },
            { cotacaoCompra: 5.2, cotacaoVenda: 5.3, dataHoraCotacao: '2025-03-06 13:11:00.814' },
          ],
        }),
      ),
    )

    const quotes = await client().fetchPtaxRange(isoDate('2025-03-05'), isoDate('2025-03-07'))
    expect(quotes).toEqual([{ date: '2025-03-06', buyRate: 5.2, sellRate: 5.3 }])
  })
})

describe('fetchCdiAnnualRate', () => {
  /**
   * A 4389 é o CDI anualizado. O `bcbSeries` casa com qualquer série, então sem este teste
   * trocar o número não quebra nada: a 4391 (CDI do mês, % a.m.) devolve um número menor e
   * plausível, e o erro só aparece na tela como um CDI de 0,05% a.a.
   */
  it('consulta a série 4389, do CDI anualizado', async () => {
    let requestUrl = ''
    server.use(
      http.get(BCB_SGS, ({ request }) => {
        requestUrl = request.url
        return HttpResponse.json([])
      }),
    )

    await client().fetchCdiAnnualRate()

    expect(requestUrl).toContain('bcdata.sgs.4389/')
  })

  it('converte percentual com vírgula em fração', async () => {
    server.use(bcbSeries([{ data: '01/03/2025', valor: '14,25' }]))

    expect(await client().fetchCdiAnnualRate()).toBeCloseTo(0.1425, 6)
  })

  it('aceita percentual com ponto', async () => {
    server.use(bcbSeries([{ data: '01/03/2025', valor: '10.5' }]))

    expect(await client().fetchCdiAnnualRate()).toBeCloseTo(0.105, 6)
  })

  it('série vazia devolve null', async () => {
    server.use(bcbSeries([]))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })

  it('valor não numérico devolve null', async () => {
    server.use(bcbSeries([{ data: '01/03/2025', valor: 'abc' }]))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })

  it('erro da API devolve null', async () => {
    server.use(http.get(BCB_SGS, () => new HttpResponse(null, { status: 502 })))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })

  it('resposta em formato inesperado devolve null', async () => {
    server.use(http.get(BCB_SGS, () => HttpResponse.json({ erro: 'nao é array' })))

    expect(await client().fetchCdiAnnualRate()).toBeNull()
  })
})

describe('fetchCdiDailyRange', () => {
  /** Captura as URLs pedidas e responde com a série passada, se houver. */
  function captureUrls(body: Array<{ data: string; valor: string }> = []) {
    const urls: string[] = []
    server.use(
      http.get(BCB_SGS, ({ request }) => {
        urls.push(decodeURIComponent(request.url))
        return HttpResponse.json(body)
      }),
    )
    return urls
  }

  it('consulta a série 12, do CDI diário, com a data em dd/MM/yyyy', async () => {
    const urls = captureUrls()

    await client().fetchCdiDailyRange(isoDate('2024-01-02'), isoDate('2024-01-10'))

    expect(urls[0]).toContain('bcdata.sgs.12/')
    expect(urls[0]).toContain('dataInicial=02/01/2024')
    expect(urls[0]).toContain('dataFinal=10/01/2024')
  })

  it('converte o percentual diário em fração', async () => {
    server.use(bcbSeries([{ data: '02/01/2024', valor: '0,052531' }]))

    const rates = await client().fetchCdiDailyRange(isoDate('2024-01-01'), isoDate('2024-01-31'))

    expect(rates).toEqual([{ date: '2024-01-02', rate: 0.00052531 }])
  })

  /**
   * O SGS recusa janela maior que dez anos em série diária, com 406. Como o `getJson`
   * transforma status ruim em null, um pedido único cobrindo a carteira inteira — que
   * começa em 2008 — gravaria zero taxa sem erro nenhum na tela.
   */
  it('fatia período longo em janelas, sem repetir dia nem deixar buraco', async () => {
    const urls = captureUrls()

    await client().fetchCdiDailyRange(isoDate('2008-07-09'), isoDate('2026-08-04'))

    expect(urls.length).toBeGreaterThan(1)
    expect(urls[0]).toContain('dataInicial=09/07/2008')
    expect(urls[urls.length - 1]).toContain('dataFinal=04/08/2026')

    // A janela seguinte começa exatamente um dia depois do fim da anterior.
    const inicios = urls.map((u) => u.match(/dataInicial=(\S+?)&/)?.[1] as string)
    const fins = urls.map((u) => u.match(/dataFinal=([^&\s]+)/)?.[1] as string)
    for (let i = 1; i < urls.length; i++) {
      expect(diasEntre(fins[i - 1] as string, inicios[i] as string)).toBe(1)
    }
  })

  it('nenhuma janela ultrapassa dez anos, que é o limite do SGS', async () => {
    const urls = captureUrls()

    await client().fetchCdiDailyRange(isoDate('2008-07-09'), isoDate('2026-08-04'))

    for (const url of urls) {
      const inicio = url.match(/dataInicial=(\S+?)&/)?.[1] as string
      const fim = url.match(/dataFinal=([^&\s]+)/)?.[1] as string
      expect(diasEntre(inicio, fim)).toBeLessThan(365 * 10)
    }
  })

  it('junta o resultado de todas as janelas', async () => {
    server.use(bcbSeries([{ data: '02/01/2024', valor: '0,05' }]))

    const rates = await client().fetchCdiDailyRange(isoDate('2008-01-01'), isoDate('2026-01-01'))

    // O mesmo fixture volta em cada janela; o que importa é nada se perder no caminho.
    expect(rates.length).toBeGreaterThan(1)
  })

  it('janela que falha não derruba as demais', async () => {
    let call = 0
    server.use(
      http.get(BCB_SGS, () => {
        call += 1
        return call === 1
          ? new HttpResponse(null, { status: 406 })
          : HttpResponse.json([{ data: '02/01/2020', valor: '0,05' }])
      }),
    )

    const rates = await client().fetchCdiDailyRange(isoDate('2008-01-01'), isoDate('2026-01-01'))

    expect(rates.length).toBeGreaterThan(0)
  })

  it('período invertido devolve lista vazia sem consultar', async () => {
    const urls = captureUrls()

    expect(await client().fetchCdiDailyRange(isoDate('2024-06-30'), isoDate('2024-01-01'))).toEqual(
      [],
    )
    expect(urls).toHaveLength(0)
  })

  it('data inválida na série é descartada, sem derrubar as demais', async () => {
    server.use(
      bcbSeries([
        { data: 'lixo', valor: '0,05' },
        { data: '03/01/2024', valor: '0,05' },
      ]),
    )

    const rates = await client().fetchCdiDailyRange(isoDate('2024-01-01'), isoDate('2024-01-31'))

    expect(rates).toEqual([{ date: '2024-01-03', rate: 0.0005 }])
  })

  it('taxa não numérica é descartada', async () => {
    server.use(
      bcbSeries([
        { data: '02/01/2024', valor: 'abc' },
        { data: '03/01/2024', valor: '0,05' },
      ]),
    )

    const rates = await client().fetchCdiDailyRange(isoDate('2024-01-01'), isoDate('2024-01-31'))

    expect(rates).toEqual([{ date: '2024-01-03', rate: 0.0005 }])
  })

  it('erro da API devolve lista vazia', async () => {
    server.use(http.get(BCB_SGS, () => new HttpResponse(null, { status: 406 })))

    expect(await client().fetchCdiDailyRange(isoDate('2024-01-01'), isoDate('2024-01-31'))).toEqual(
      [],
    )
  })
})

/** Dias entre duas datas em dd/MM/yyyy, como aparecem na URL do SGS. */
function diasEntre(from: string, to: string): number {
  const parse = (value: string) => {
    const [day, month, year] = value.split('/') as [string, string, string]
    return Date.UTC(Number(year), Number(month) - 1, Number(day))
  }
  return (parse(to) - parse(from)) / 86_400_000
}
