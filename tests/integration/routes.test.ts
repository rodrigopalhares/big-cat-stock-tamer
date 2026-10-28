import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TRANSACTION_TYPES } from '../../src/domain/constants.js'
import { date as fmtDate, monthLabel } from '../../src/shared/format.js'
import { addDays, today } from '../../src/shared/iso-date.js'
import { createHarness, type Harness } from '../app-harness.js'
import { clearAllData } from '../db.js'
import {
  createAsset,
  createAssetClass,
  createDividend,
  createPriceHistory,
  createTransaction,
} from '../factories.js'
import {
  BCB_PTAX,
  BCB_SGS,
  bcbSeries,
  HttpResponse,
  http,
  server,
  TESOURO_CSV,
  YAHOO_CHART,
  yahooChart,
} from '../msw.js'

// Porte de PortfolioControllerTest, TransactionControllerTest, DividendControllerTest
// e MonthlyEvolutionControllerTest.

/**
 * Lê um `data-*` do bloco `#evolution-data`, que o dashboard entrega como JSON escapado
 * para o Chart.js montar no cliente.
 */
function chartAttr(html: string, attr: string): unknown {
  const match = new RegExp(`${attr}="([^"]*)"`).exec(html)
  if (match?.[1] === undefined) throw new Error(`atributo ${attr} não encontrado`)
  const json = match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
  return JSON.parse(json)
}

describe('rotas da aplicação', () => {
  let h: Harness

  beforeAll(async () => {
    h = await createHarness()
  })

  afterAll(async () => {
    await h.close()
  })

  beforeEach(async () => {
    await clearAllData(h.db)
  })

  describe('dashboard', () => {
    it('GET / redireciona para o portfólio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/portfolio/')
    })

    it('carteira vazia mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma posição encontrada')
    })

    it('mostra a posição com o valor formatado em pt-BR', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 1000, price: 10, date: '2024-01-01' })
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 15)

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.body).toContain('PETR4')
      // 15.000 com separador de milhar — o que o format.js fazia no cliente.
      expect(res.body).toContain('15.000,00')
    })

    it('o nome do ativo fica no title do ticker, fora do corpo da tabela', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras PN' })
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 10, date: '2024-01-01' })
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 15)

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      // O nome existe só como atributo; a ordenação lê o textContent da célula, e o nome
      // ali dentro fazia "PETR4" comparar como "PETR4Petrobras PN".
      expect(res.body).toContain('title="Petrobras PN"')
      expect(res.body).not.toContain('>Petrobras PN<')
    })

    it('agrupa as posições por classe de alocação, com "Sem classe" por último', async () => {
      const rf = await createAssetClass(h.db, 'Renda Fixa')
      const intl = await createAssetClass(h.db, 'Internacional')
      for (const [ticker, type, classId] of [
        ['VALE3', 'STOCK', null],
        ['IVVB11', 'ETF', intl.id],
        ['TD:IPCA2035', 'TESOURO_DIRETO', rf.id],
        ['AAPL34', 'BDR', intl.id],
      ] as const) {
        await createAsset(h.db, ticker, { type, assetClassId: classId })
        await createTransaction(h.db, ticker, { quantity: 10, price: 10, date: '2024-01-02' })
        await h.container.assets.refreshPositionFields(ticker)
        await createPriceHistory(h.db, ticker, '2024-06-01', 12)
      }

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })
      const at = (text: string) => res.body.indexOf(text)

      // Classes em ordem alfabética; dentro da classe, por tipo (BDR antes de ETF).
      expect(at('Subtotal Internacional')).toBeGreaterThan(at('IVVB11'))
      expect(at('AAPL34')).toBeLessThan(at('IVVB11'))
      expect(at('TD:IPCA2035')).toBeGreaterThan(at('Subtotal Internacional'))
      expect(at('Subtotal Renda Fixa')).toBeGreaterThan(at('TD:IPCA2035'))
      expect(at('VALE3')).toBeGreaterThan(at('Subtotal Renda Fixa'))
      expect(at('Subtotal Sem classe')).toBeGreaterThan(at('VALE3'))

      // Subtotal soma o grupo: 2 ativos × 10 × 12.
      expect(res.body).toMatch(/Subtotal Internacional[\s\S]*?2 ativos[\s\S]*?240,00/)
      expect(res.body).toContain(`data-class="${intl.id}"`)
      expect(res.body).toContain('data-class="none"')
      expect(res.body).toContain(`<option value="${rf.id}">Renda Fixa</option>`)
    })

    it('classe sem posição fica fora da tabela e do filtro', async () => {
      await createAssetClass(h.db, 'Cripto')
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-02' })
      await h.container.assets.refreshPositionFields('PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.body).not.toContain('Cripto')
      expect(res.body).toContain('Subtotal Sem classe')
    })

    describe('cotações', () => {
      async function seedPosicao(priceDate: string) {
        await createAsset(h.db, 'PETR4', { yfTicker: 'PETR4.SA' })
        await createAsset(h.db, 'AAPL', { currency: 'USD', yfTicker: 'AAPL' })
        await createTransaction(h.db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-02' })
        await createTransaction(h.db, 'AAPL', { quantity: 1, price: 100, date: '2024-01-02' })
        await h.container.assets.refreshPositionFields('PETR4')
        await h.container.assets.refreshPositionFields('AAPL')
        await createPriceHistory(h.db, 'PETR4', priceDate, 15)
        await createPriceHistory(h.db, 'AAPL', '2024-01-02', 100)
        await h.db.exchangeRate.create({
          data: {
            date: '2024-01-02',
            fromCurrency: 'USD',
            toCurrency: 'BRL',
            buyRate: 5,
            sellRate: 5,
          },
        })
      }

      /**
       * A primeira abertura do dia esperava ~20s por Yahoo, CSV do Tesouro e PTAX. Como no
       * teste do CDI, a asserção é sobre a chamada: o `HttpClient` engole erro de rede, então
       * uma busca acidental não mudaria nem o status nem o conteúdo da página.
       */
      it('renderizar o dashboard não chama API nenhuma', async () => {
        await seedPosicao('2024-06-03')
        const chamadas: string[] = []
        const registra = (nome: string) => () => {
          chamadas.push(nome)
          return HttpResponse.json({})
        }
        server.use(
          http.get(YAHOO_CHART, registra('yahoo')),
          http.get(TESOURO_CSV, registra('tesouro')),
          http.get(BCB_PTAX, registra('ptax')),
        )

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.statusCode).toBe(200)
        expect(chamadas).toEqual([])
      })

      it('mostra a data da cotação sem alerta quando é recente', async () => {
        await seedPosicao(today())

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.body).toContain(`Cotações de ${fmtDate(today())}`)
        expect(res.body).not.toContain('bi-exclamation-triangle-fill')
      })

      it('cotação anterior ao último dia útil aparece em vermelho', async () => {
        await seedPosicao('2024-06-03')

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.body).toMatch(/text-danger[^>]*>\s*<i class="bi bi-exclamation-triangle-fill/)
        expect(res.body).toContain('Cotações de 03/06/2024')
      })

      it('a data é a da cotação mais recente da carteira', async () => {
        // AAPL ficou em 02/01/2024; a mais recente é a de PETR4.
        await seedPosicao(addDays(today(), -1))

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.body).toContain(`Cotações de ${fmtDate(addDays(today(), -1))}`)
      })

      it('o botão de atualizar cotações busca o dólar', async () => {
        await seedPosicao('2024-06-03')
        let buscouDolar = false
        server.use(
          yahooChart('yahoo_chart_empty.json'),
          bcbSeries([]),
          http.get(BCB_PTAX, () => {
            buscouDolar = true
            return HttpResponse.json({ value: [] })
          }),
        )

        const res = await h.app.inject({ method: 'POST', url: '/portfolio/update-prices' })

        expect(res.statusCode).toBe(200)
        expect(buscouDolar).toBe(true)
      })
    })

    describe('comparação com o CDI', () => {
      /** Carteira valendo 15.000 sobre um aporte de 10.000, com um dia útil de CDI. */
      async function seedCarteiraComCdi() {
        await createAsset(h.db, 'PETR4')
        await createTransaction(h.db, 'PETR4', { quantity: 1000, price: 10, date: '2024-01-02' })
        await h.container.assets.refreshPositionFields('PETR4')
        await createPriceHistory(h.db, 'PETR4', '2024-06-01', 15)
        await h.db.cdiRate.create({ data: { date: '2024-01-02', rate: 0.0005 } })
      }

      it('sem série gravada o bloco do CDI não aparece', async () => {
        await createAsset(h.db, 'PETR4')
        await createTransaction(h.db, 'PETR4', { quantity: 1000, price: 10, date: '2024-01-02' })
        await h.container.assets.refreshPositionFields('PETR4')
        await createPriceHistory(h.db, 'PETR4', '2024-06-01', 15)

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.body).not.toContain('Se fosse CDI')
      })

      it('mostra o bloco e a data da última taxa', async () => {
        await seedCarteiraComCdi()

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.body).toContain('Se fosse CDI')
        expect(res.body).toContain('Acima do CDI')
        // Sombra de 10.000 rendendo um dia; a carteira vale 15.000.
        expect(res.body).toContain('10.005,00')
        expect(res.body).toContain('02/01/2024')
      })

      it('a TIR do CDI sai no rodapé da tabela, ao lado da TIR da carteira', async () => {
        await seedCarteiraComCdi()

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })
        const tfoot = /<tfoot[\s\S]*?<\/tfoot>/.exec(res.body)?.[0] ?? ''

        expect(tfoot).toContain('Se fosse CDI')
        expect(tfoot).toContain('Total')
      })

      /**
       * A linha do CDI usa colSpan para pular as colunas sem equivalente. Errar a soma
       * desalinha o rodapé inteiro, e nenhum outro teste olharia para isso.
       */
      it('a linha do CDI cobre exatamente as colunas do cabeçalho', async () => {
        await seedCarteiraComCdi()

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })
        const table = /<table id="positionsTable"[\s\S]*?<\/table>/.exec(res.body)?.[0] ?? ''
        // `<th[\s>]` e não `<th`, senão o próprio `<thead>` entra na contagem.
        const colunas = (/<thead[\s\S]*?<\/thead>/.exec(table)?.[0].match(/<th[\s>]/g) ?? []).length

        const linhaCdi = /<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Se fosse CDI[\s\S]*?<\/tr>/.exec(table)?.[0]
        expect(linhaCdi).toBeDefined()

        const largura = [...(linhaCdi as string).matchAll(/<td(?:\s+colSpan="(\d+)")?/gi)].reduce(
          (total, m) => total + Number(m[1] ?? 1),
          0,
        )
        expect(largura).toBe(colunas)
      })

      it('a linha do CDI vai para o gráfico', async () => {
        await seedCarteiraComCdi()
        await h.container.evolution.recalculate()

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })
        const cdi = chartAttr(res.body, 'data-cdi') as Array<number | null>

        expect(cdi.some((v) => v !== null)).toBe(true)
      })

      /**
       * O dashboard é a página mais aberta do app e não pode bloquear numa chamada ao BCB.
       * Quem busca é o job das 18:30 e o botão de atualizar cotações.
       *
       * A asserção é sobre a chamada, não sobre o efeito: o `HttpClient` engole erro de
       * rede devolvendo null, então uma busca acidental no render passaria despercebida
       * tanto pelo status da página quanto pela contagem de taxas gravadas.
       */
      it('renderizar o dashboard não busca a série do CDI', async () => {
        await seedCarteiraComCdi()
        let chamou = false
        server.use(
          http.get(BCB_SGS, () => {
            chamou = true
            return HttpResponse.json([])
          }),
        )

        const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

        expect(res.statusCode).toBe(200)
        expect(chamou).toBe(false)
      })

      it('o botão de atualizar cotações busca a série', async () => {
        await seedCarteiraComCdi()
        server.use(
          yahooChart('yahoo_chart_empty.json'),
          bcbSeries([{ data: '03/01/2024', valor: '0,05' }]),
          http.get(BCB_PTAX, () => HttpResponse.json({ value: [] })),
        )

        const res = await h.app.inject({ method: 'POST', url: '/portfolio/update-prices' })

        expect(res.statusCode).toBe(200)
        expect(await h.db.cdiRate.count()).toBe(2)
      })
    })

    it('GET /portfolio/api devolve o resumo', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ totalInvested: 0, positions: [] })
    })

    it('GET /portfolio/api/:ticker devolve 404 para ativo inexistente', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api/XXXX9' })
      expect(res.statusCode).toBe(404)
    })

    it('GET /portfolio/api/:ticker devolve a posição do ativo', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 25)

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api/PETR4' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ticker: 'PETR4', quantity: 100, currentPrice: 25 })
    })

    it('GET /portfolio/api/:ticker devolve 404 para ativo cadastrado sem transação', async () => {
      // 404 por outro motivo que o anterior: o ativo existe, mas não tem posição a montar.
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/api/PETR4' })

      expect(res.statusCode).toBe(404)
    })

    it('com snapshots monta os dados do gráfico', async () => {
      const fiis = await createAssetClass(h.db, 'FIIs', { color: '#9966ff' })
      await createAssetClass(h.db, 'Cripto')
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await createAsset(h.db, 'HGLG11', { type: 'REIT', assetClassId: fiis.id })
      await createTransaction(h.db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-05' })
      await createTransaction(h.db, 'HGLG11', { quantity: 1, price: 150, date: '2024-01-05' })
      await h.container.assets.refreshPositionFields('PETR4')
      await h.container.assets.refreshPositionFields('HGLG11')
      await h.db.monthlySnapshot.createMany({
        data: [
          {
            assetId: 'PETR4',
            month: '2024-01-01',
            quantity: 10,
            avgPrice: 10,
            marketPrice: 12,
            totalCost: 100,
            marketValue: 120,
          },
          {
            assetId: 'HGLG11',
            month: '2024-01-01',
            quantity: 1,
            avgPrice: 150,
            marketPrice: 160,
            totalCost: 150,
            marketValue: 160,
          },
        ],
      })
      await h.db.benchmarkPrice.create({
        data: { ticker: 'IBOV', month: '2024-01-01', close: 130000 },
      })

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.statusCode).toBe(200)
      expect(chartAttr(res.body, 'data-labels')).toEqual(['01/2024'])
      // Uma série por classe com ativo cadastrado, na cor da classe, somando o valor de
      // mercado dos snapshots do mês. Cripto não tem ativo e fica fora da legenda.
      expect(chartAttr(res.body, 'data-datasets')).toEqual([
        { label: 'FIIs', color: '#9966ff', data: [160] },
        { label: 'Sem classe', color: '#6c757d', data: [120] },
      ])
      expect(chartAttr(res.body, 'data-invested')).toEqual([250])
      // Sem provento nem venda, o aporte é o próprio custo das compras do mês.
      expect(chartAttr(res.body, 'data-net-contribution')).toEqual([250])
      // As linhas de referência entram com um ponto por mês; o cálculo é testado em domain/chart.
      expect(chartAttr(res.body, 'data-ibov')).toHaveLength(1)
    })

    it('com proventos monta o gráfico mensal por classe de alocação', async () => {
      const acoes = await createAssetClass(h.db, 'Ações', { color: '#36a2eb' })
      await createAsset(h.db, 'PETR4', { type: 'STOCK', assetClassId: acoes.id })
      await createAsset(h.db, 'HGLG11', { type: 'REIT' })
      await createDividend(h.db, 'PETR4', { date: '2024-01-10', totalAmount: 100 })
      await createDividend(h.db, 'PETR4', { date: '2024-03-10', totalAmount: 40, taxWithheld: 6 })
      await createDividend(h.db, 'HGLG11', { date: '2024-02-10', totalAmount: 80 })

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Proventos por Mês')

      // O eixo vai do primeiro provento até o mês corrente, então o tamanho depende de
      // quando o teste roda — o que dá para fixar são as pontas e os três primeiros meses.
      const labels = chartAttr(res.body, 'data-dividend-labels') as string[]
      expect(labels[0]).toBe('01/2024')
      expect(labels.at(-1)).toBe(monthLabel(today()))

      // Uma série por classe, com o líquido do mês e zero onde não houve provento.
      // "Sem classe" vem por último, como na tabela.
      const datasets = chartAttr(res.body, 'data-dividend-datasets') as Array<{
        label: string
        color: string
        data: number[]
      }>
      expect(datasets.map((d) => d.label)).toEqual(['Ações', 'Sem classe'])
      expect(datasets[0]?.color).toBe('#36a2eb')
      expect(datasets[0]?.data.slice(0, 3)).toEqual([100, 0, 34])
      expect(datasets[1]?.data.slice(0, 3)).toEqual([0, 80, 0])
      for (const dataset of datasets) expect(dataset.data).toHaveLength(labels.length)
      expect(chartAttr(res.body, 'data-dividend-moving-average')).toHaveLength(labels.length)
    })

    it('a média móvel acompanha as séries', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      await createDividend(h.db, 'PETR4', { date: today(), totalAmount: 300, taxWithheld: 45 })

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      // Com um mês só no eixo, a média é o próprio líquido do mês.
      expect(chartAttr(res.body, 'data-dividend-labels')).toEqual([monthLabel(today())])
      expect(chartAttr(res.body, 'data-dividend-moving-average')).toEqual([255])
    })

    it('sem proventos não desenha o gráfico mensal', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('Proventos por Mês')
    })
  })

  describe('detalhe do ativo', () => {
    it('mostra transações e proventos do ativo', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })
      await createTransaction(h.db, 'PETR4', { date: '2024-03-15' })
      await createDividend(h.db, 'PETR4', { date: '2024-04-10', totalAmount: 120 })

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Petrobras')
      expect(res.body).toContain('15/03/2024')
      expect(res.body).toContain('10/04/2024')
    })

    it('ativo inexistente dá 404', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/assets/XXXX9' })
      expect(res.statusCode).toBe(404)
    })

    it('oferece lançar transação e provento sem sair da tela', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })

      expect(res.body).toContain('Nova Transação')
      expect(res.body).toContain('Novo Provento')
      // Os dois botões abrem o mesmo modal do formulário completo, e o ticker vai junto.
      expect(res.body).toContain('data-new-tx')
      expect(res.body).toContain('data-new-div')
      expect(res.body).toContain('id="editTxModal"')
      expect(res.body).toContain('id="editDivModal"')
    })

    it('o provento listado pode ser editado e excluído de volta para o ativo', async () => {
      await createAsset(h.db, 'PETR4')
      const dividend = await createDividend(h.db, 'PETR4', { totalAmount: 100 })

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })

      expect(res.body).toContain('data-edit-div')
      expect(res.body).toContain(`/dividends/${dividend.id}/delete`)
      expect(res.body).toContain('value="/assets/PETR4"')
    })

    it('com posição aberta mostra os cartões de posição', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })
      // Sem isso o ativo fica com `hasPosition = false` e os cartões nem renderizam.
      await h.container.assets.refreshPositionFields('PETR4')
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 25)

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Preço Médio')
      expect(res.body).toContain('20,00')
      expect(res.body).toContain('25,00')
    })
  })

  describe('transações', () => {
    it('GET /transactions/ responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma transação registrada')
    })

    it('a primeira página traz 100 linhas e a sentinela da próxima, com os filtros', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK' })
      for (let i = 0; i < 101; i++) {
        await createTransaction(h.db, 'PETR4', {
          date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
        })
      }

      const res = await h.app.inject({ method: 'GET', url: '/transactions/?type=STOCK' })

      expect(res.body.match(/data-edit-tx/g)).toHaveLength(100)
      expect(res.body).toContain('hx-trigger="revealed"')
      expect(res.body).toContain('hx-get="/transactions/rows?type=STOCK&amp;offset=100"')
      // O contador é do total, não da página.
      expect(res.body).toContain('<span class="badge bg-secondary ms-1">101</span>')
    })

    it('/transactions/rows devolve a página seguinte e, na última, nenhuma sentinela', async () => {
      await createAsset(h.db, 'PETR4')
      for (let i = 0; i < 101; i++) await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/transactions/rows?offset=100' })

      expect(res.statusCode).toBe(200)
      expect(res.body.match(/data-edit-tx/g)).toHaveLength(1)
      expect(res.body).not.toContain('hx-trigger="revealed"')
      expect(res.body).not.toContain('<!DOCTYPE')
    })

    it('lista curta não tem sentinela', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })
      expect(res.body).not.toContain('hx-trigger="revealed"')
    })

    it('filtra por operação e nomeia os dois filtros sem ambiguidade', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 100, date: '2024-01-15' })
      await createTransaction(h.db, 'PETR4', { type: 'SELL', quantity: -10, date: '2024-02-15' })

      const res = await h.app.inject({ method: 'GET', url: '/transactions/?operation=SELL' })

      expect(res.body).toContain('Tipo de ativo: Todos')
      expect(res.body).toContain('Operação: Todas')
      expect(res.body.match(/data-edit-tx/g)).toHaveLength(1)
      expect(res.body).toContain('<option value="SELL" selected>')
    })

    it('busca por trecho do ticker e filtro por ano', async () => {
      await createAsset(h.db, 'PETR4')
      await createAsset(h.db, 'VALE3')
      await createTransaction(h.db, 'PETR4', { date: '2024-01-15' })
      await createTransaction(h.db, 'VALE3', { date: '2023-01-15' })

      const search = await h.app.inject({ method: 'GET', url: '/transactions/?q=val' })
      expect(search.body).toContain('/assets/VALE3')
      expect(search.body).not.toContain('/assets/PETR4')

      const year = await h.app.inject({ method: 'GET', url: '/transactions/?year=2024' })
      expect(year.body).toContain('/assets/PETR4')
      expect(year.body).not.toContain('/assets/VALE3')
      expect(year.body).toContain('<option value="2024" selected>')
    })

    it('a lista renderiza a linha da transação', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })
      await createTransaction(h.db, 'PETR4', {
        quantity: 100,
        price: 25.5,
        fees: 10,
        date: '2024-06-01',
        broker: 'XP',
      })

      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })

      expect(res.body).toContain('01/06/2024')
      expect(res.body).toContain('25,50')
      expect(res.body).toContain('XP')
      // Líquido: 100 × 25,50 + 10 de taxas — é o que saiu da conta.
      expect(res.body).toContain('2.560,00')
    })

    it('cria via formulário e redireciona', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          price: '25.50',
          fees: '10',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      expect(await h.db.transaction.count()).toBe(1)
      // A posição do ativo é recalculada junto.
      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.hasPosition).toBe(true)
    })

    it('criada pela tela do ativo, volta para ela', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          price: '25.50',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
          returnTo: '/assets/PETR4',
        },
      })

      expect(res.headers.location).toBe('/assets/PETR4')
    })

    /**
     * `returnTo` ia direto para o Location — era o achado F3 da auditoria. O redirect acontece
     * depois da escrita, então o usuário chega ao site do atacante logo após uma operação que
     * deu certo, que é o contexto de maior confiança para pedir a senha de novo.
     */
    it('destino externo em returnTo é ignorado', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          price: '25.50',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
          returnTo: 'https://evil.example.com/phish',
        },
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/transactions/')
    })

    it('valor bruto sem preço deduz o preço unitário', async () => {
      await createAsset(h.db, 'PETR4')

      await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          total_price: '2500',
          fees: '10',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      const tx = await h.db.transaction.findFirstOrThrow()
      expect(tx.price).toBeCloseTo(25, 4)
      expect(tx.fees).toBeCloseTo(10, 4)
    })

    it('sem preço nem bruto dá 400', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BUY',
          quantity: '100',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(400)
    })

    it('desdobramento sem preço é aceito e não exige preço nem total', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'DESDOBRAMENTO',
          quantity: '100',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      // O custo total não muda; o preço médio cai pela metade.
      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.quantity).toBeCloseTo(200, 4)
      expect(asset.totalCost).toBeCloseTo(2000, 4)
      expect(asset.avgPrice).toBeCloseTo(10, 4)
    })

    it('venda acima da posição volta 400 em português e não grava', async () => {
      await createAsset(h.db, 'ITUB3')
      await createTransaction(h.db, 'ITUB3', { quantity: 1586, price: 20, date: '2024-01-02' })

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'ITUB3',
          type: 'SELL',
          quantity: '999999',
          price: '40',
          fees: '0',
          date: '2026-01-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Venda de 999.999 ITUB3 em 01/01/2026 supera a posição de 1.586')
      expect(await h.db.transaction.count()).toBe(1)
    })

    it('o lote do CSV pede JSON e recebe o motivo em JSON, não a página de erro', async () => {
      await createAsset(h.db, 'ITUB3')
      await createTransaction(h.db, 'ITUB3', { quantity: 1586, price: 20, date: '2024-01-02' })

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/batch',
        headers: { accept: 'application/json' },
        payload: {
          rows: [
            {
              ticker: 'ITUB3',
              date: '2026-09-02',
              type: 'SELL',
              quantity: 5000,
              price: 40,
              fees: 0,
              broker: '',
              notes: '',
              currency: 'BRL',
            },
          ],
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'Venda de 5.000 ITUB3 em 02/09/2026 supera a posição de 1.586 na data.',
      })
      expect(await h.db.transaction.count()).toBe(1)
    })

    it('agrupamento reduz a posição sem realizar resultado', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 1000, price: 1, date: '2024-01-02' })

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'AGRUPAMENTO',
          quantity: '900',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.quantity).toBeCloseTo(100, 4)
      expect(asset.avgPrice).toBeCloseTo(10, 4)
      expect(asset.realizedPnl).toBe(0)
    })

    it('bonificação com custo atribuído entra no preço médio', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })

      await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'BONIFICACAO',
          quantity: '10',
          price: '5',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.quantity).toBeCloseTo(110, 4)
      expect(asset.totalCost).toBeCloseTo(2050, 4)
    })

    it('redução de capital abate o preço médio sem mexer na quantidade', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 100, price: 20, date: '2024-01-02' })

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/new',
        payload: {
          ticker: 'PETR4',
          type: 'REDUCAO_CAPITAL',
          quantity: '100',
          total_price: '200',
          fees: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      const asset = await h.db.asset.findUniqueOrThrow({ where: { ticker: 'PETR4' } })
      expect(asset.quantity).toBeCloseTo(100, 4)
      expect(asset.totalCost).toBeCloseTo(1800, 4)
      expect(asset.avgPrice).toBeCloseTo(18, 4)
      expect(asset.realizedPnl).toBe(0)
    })

    it('os formulários de criação e de edição oferecem todos os tipos', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })

      // Um `select` no formulário novo, outro no modal de edição e o filtro de operação do
      // histórico — os três com os seis tipos.
      for (const id of ['txType', 'editTxType']) {
        expect(res.body).toContain(`id="${id}"`)
      }
      for (const value of TRANSACTION_TYPES) {
        expect(res.body.match(new RegExp(`value="${value}"`, 'g'))).toHaveLength(3)
      }
    })

    it('a lista mostra o badge de cada evento societário', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { type: 'BONIFICACAO', quantity: 10, price: 5 })
      await createTransaction(h.db, 'PETR4', { type: 'DESDOBRAMENTO', quantity: 100, price: 0 })
      await createTransaction(h.db, 'PETR4', { type: 'AGRUPAMENTO', quantity: -90, price: 0 })
      await createTransaction(h.db, 'PETR4', { type: 'REDUCAO_CAPITAL', quantity: 10, price: 2 })

      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })

      expect(res.body).toContain('Bonificação')
      expect(res.body).toContain('Desdobramento')
      expect(res.body).toContain('Agrupamento')
      expect(res.body).toContain('Redução de Capital')
    })

    it('a API JSON aceita evento societário e recusa tipo inventado', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4', { quantity: 1000, price: 1, date: '2024-01-02' })

      const ok = await h.app.inject({
        method: 'POST',
        url: '/transactions/api',
        payload: {
          assetId: 'PETR4',
          type: 'AGRUPAMENTO',
          quantity: 900,
          price: 0,
          date: '2024-06-01',
        },
      })
      expect(ok.statusCode).toBe(201)
      expect(
        await h.db.transaction.findFirstOrThrow({ where: { type: 'AGRUPAMENTO' } }),
      ).toMatchObject({ quantity: -900 })

      // Recusa sem gravar: o ZodError vira 400 no setErrorHandler, com o campo em português.
      const bad = await h.app.inject({
        method: 'POST',
        url: '/transactions/api',
        payload: { assetId: 'PETR4', type: 'XPTO', quantity: 1, price: 1, date: '2024-06-01' },
      })
      expect(bad.statusCode).toBe(400)
      expect(bad.json().details[0]).toMatch(/^Tipo deve ser um destes: BUY, SELL/)
      expect(await h.db.transaction.count()).toBe(2)
    })

    it('a API JSON não deixa desdobramento gravar preço', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/api',
        payload: {
          assetId: 'PETR4',
          type: 'DESDOBRAMENTO',
          quantity: 100,
          price: 99,
          fees: 7,
          date: '2024-06-01',
        },
      })

      expect(res.statusCode).toBe(201)
      expect(await h.db.transaction.findFirstOrThrow()).toMatchObject({ price: 0, fees: 0 })
    })

    it('exclui e redireciona', async () => {
      await createAsset(h.db, 'PETR4')
      const tx = await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'POST', url: `/transactions/${tx.id}/delete` })

      expect(res.statusCode).toBe(302)
      expect(await h.db.transaction.count()).toBe(0)
    })

    it('parse-csv devolve a etapa 1 como fragmento', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/parse-csv',
        payload: { csv: 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('<!DOCTYPE')
      expect(res.body).toContain('Etapa 1: Revisão de Ativos')
      expect(res.body).toContain('Existente')
    })

    it('parse-csv-step2 devolve o preview das transações', async () => {
      await createAsset(h.db, 'PETR4')

      // urlencoded de propósito: é o que o cliente manda. Com JSON o teste passava
      // enquanto o browser levava 415.
      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/parse-csv-step2',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          csv: 'PETR4\t01/06/2024\tC\t100\t25,50\t0\tXP\t0\tBRL\t',
        }).toString(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('csvPreviewTable')
      expect(res.body).toContain('Confirmar Importação')
    })

    it('batch importa e devolve a contagem', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/transactions/batch',
        payload: {
          rows: [
            {
              ticker: 'PETR4',
              date: '2024-06-01',
              type: 'BUY',
              quantity: 100,
              price: 25.5,
              fees: 0,
              broker: 'XP',
              notes: '',
              currency: 'BRL',
            },
          ],
        },
      })

      expect(res.json()).toEqual({ inserted: 1 })
      expect(await h.db.transaction.count()).toBe(1)
    })

    it('ticker-info devolve fragmento sem doctype', async () => {
      await createAsset(h.db, 'PETR4', { name: 'Petrobras' })

      const res = await h.app.inject({
        method: 'GET',
        url: '/transactions/ticker-info?ticker=PETR4',
      })

      expect(res.body).toContain('já cadastrado')
      expect(res.body).not.toContain('<!DOCTYPE')
    })

    it('API JSON cria com 201 e exclui com 204', async () => {
      await createAsset(h.db, 'PETR4')

      const created = await h.app.inject({
        method: 'POST',
        url: '/transactions/api',
        payload: {
          assetId: 'PETR4',
          type: 'BUY',
          quantity: 10,
          price: 25,
          fees: 0,
          date: '2024-06-01',
        },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({ assetId: 'PETR4', quantity: 10 })

      const id = created.json().id
      const deleted = await h.app.inject({ method: 'DELETE', url: `/transactions/api/${id}` })
      expect(deleted.statusCode).toBe(204)
    })
  })

  describe('proventos', () => {
    it('GET /dividends/ responde 200', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/dividends/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhum provento registrado')
    })

    it('cria via formulário e redireciona', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/new',
        payload: {
          ticker: 'PETR4',
          type: 'DIVIDENDO',
          total_amount: '150',
          tax_withheld: '0',
          date: '2024-06-01',
          currency: 'BRL',
        },
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/dividends/')
      expect(await h.db.dividend.count()).toBe(1)
    })

    it('criado pela tela do ativo, volta para ela', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/new',
        payload: {
          ticker: 'PETR4',
          type: 'DIVIDENDO',
          total_amount: '150',
          tax_withheld: '0',
          date: '2024-06-01',
          currency: 'BRL',
          returnTo: '/assets/PETR4',
        },
      })

      expect(res.headers.location).toBe('/assets/PETR4')
    })

    it('destino externo em returnTo é ignorado', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/new',
        payload: {
          ticker: 'PETR4',
          type: 'DIVIDENDO',
          total_amount: '150',
          tax_withheld: '0',
          date: '2024-06-01',
          currency: 'BRL',
          returnTo: '//evil.example.com/',
        },
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/dividends/')
    })

    it('lista mostra o valor líquido', async () => {
      await createAsset(h.db, 'PETR4')
      await createDividend(h.db, 'PETR4', { totalAmount: 100, taxWithheld: 15 })

      const res = await h.app.inject({ method: 'GET', url: '/dividends/' })
      expect(res.body).toContain('85,00')
    })

    it('cabeçalho mostra o líquido de tudo que o filtro pegou, e a sentinela leva o filtro', async () => {
      await createAsset(h.db, 'PETR4')
      await createAsset(h.db, 'MXRF11', { type: 'REIT' })
      for (let i = 0; i < 101; i++) {
        await createDividend(h.db, 'PETR4', { totalAmount: 10, taxWithheld: 1 })
      }
      await createDividend(h.db, 'MXRF11', { totalAmount: 1000 })

      const res = await h.app.inject({ method: 'GET', url: '/dividends/?assetType=STOCK' })

      // 101 × 9 líquidos — o MXRF11 fica fora pelo filtro, e a soma passa da página de 100.
      expect(res.body).toContain('R$ 909,00 líquidos')
      expect(res.body).toContain('hx-get="/dividends/rows?assetType=STOCK&amp;offset=100"')

      const rows = await h.app.inject({
        method: 'GET',
        url: '/dividends/rows?assetType=STOCK&offset=100',
      })
      expect(rows.body.match(/data-edit-div/g)).toHaveLength(1)
      expect(rows.body).not.toContain('hx-trigger="revealed"')
    })

    it('filtra a lista pelo tipo do ativo', async () => {
      await createAsset(h.db, 'PETR4')
      await createAsset(h.db, 'MXRF11', { type: 'REIT' })
      await createDividend(h.db, 'PETR4', { totalAmount: 100 })
      await createDividend(h.db, 'MXRF11', { totalAmount: 42 })

      const res = await h.app.inject({ method: 'GET', url: '/dividends/?assetType=REIT' })

      expect(res.body).toContain('MXRF11')
      expect(res.body).not.toContain('/assets/PETR4')
    })

    it('o filtro só oferece tipo de ativo que tem provento', async () => {
      await createAsset(h.db, 'MXRF11', { type: 'REIT' })
      await createAsset(h.db, 'BOVA11', { type: 'ETF' })
      await createDividend(h.db, 'MXRF11')

      const res = await h.app.inject({ method: 'GET', url: '/dividends/' })
      const filter = /<select name="assetType"[\s\S]*?<\/select>/.exec(res.body)?.[0] ?? ''

      expect(filter).toContain('REIT')
      expect(filter).not.toContain('ETF')
    })

    it('trocar o tipo do provento não perde o filtro de ativo', async () => {
      await createAsset(h.db, 'MXRF11', { type: 'REIT' })
      await createDividend(h.db, 'MXRF11', { type: 'RENDIMENTO' })

      const res = await h.app.inject({ method: 'GET', url: '/dividends/?assetType=REIT' })

      // Os dois selects no mesmo form: submeter um manda o outro junto.
      const form = /<form method="get" action="\/dividends\/"[\s\S]*?<\/form>/.exec(res.body)?.[0]
      expect(form).toContain('name="assetType"')
      expect(form).toContain('name="type"')
      expect(form).toContain('value="REIT" selected')
    })

    it('GET /dividends/api filtra pelo tipo do ativo', async () => {
      await createAsset(h.db, 'PETR4')
      await createAsset(h.db, 'MXRF11', { type: 'REIT' })
      await createDividend(h.db, 'PETR4')
      await createDividend(h.db, 'MXRF11')

      const res = await h.app.inject({ method: 'GET', url: '/dividends/api?assetType=reit' })

      expect(res.json()).toHaveLength(1)
      expect(res.json()[0].assetId).toBe('MXRF11')
    })

    it('edita e volta para a origem informada', async () => {
      await createAsset(h.db, 'PETR4')
      const dividend = await createDividend(h.db, 'PETR4', { totalAmount: 100, taxWithheld: 0 })

      const res = await h.app.inject({
        method: 'POST',
        url: `/dividends/${dividend.id}/edit`,
        payload: {
          type: 'JCP',
          total_amount: '200',
          tax_withheld: '30',
          date: '2024-07-01',
          currency: 'BRL',
          returnTo: '/assets/PETR4',
        },
      })

      expect(res.statusCode).toBe(302)
      // O provento é editado tanto pela lista quanto pelo detalhe do ativo — o formulário
      // diz para onde voltar.
      expect(res.headers.location).toBe('/assets/PETR4')

      const updated = await h.db.dividend.findUniqueOrThrow({ where: { id: dividend.id } })
      expect(updated).toMatchObject({ type: 'JCP', totalAmount: 200, taxWithheld: 30 })
    })

    it('exclui e volta para a lista quando não há origem', async () => {
      await createAsset(h.db, 'PETR4')
      const dividend = await createDividend(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'POST', url: `/dividends/${dividend.id}/delete` })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/dividends/')
      expect(await h.db.dividend.count()).toBe(0)
    })

    it('parse-csv marca ativo não cadastrado', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/parse-csv',
        payload: { csv: 'XXXX9\t01/03/2026\tDIVIDENDO\t1,00\t0,00\tBRL\tXP' },
      })

      expect(res.body).toContain('Ativo não cadastrado')
      expect(res.body).not.toContain('<!DOCTYPE')
    })

    it('API JSON cria com 201', async () => {
      await createAsset(h.db, 'PETR4')

      const res = await h.app.inject({
        method: 'POST',
        url: '/dividends/api',
        payload: {
          ticker: 'PETR4',
          type: 'DIVIDENDO',
          date: '2024-06-01',
          totalAmount: 150,
          taxWithheld: 0,
        },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ assetId: 'PETR4', netAmount: 150 })
    })
  })

  describe('evolução', () => {
    it('sem dados mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/evolution/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhum dado de evolução encontrado')
    })

    it('recalcular redireciona', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/evolution/recalculate' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/evolution/')
    })

    it('API devolve meses e tickers', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/evolution/api' })
      expect(res.json()).toEqual({ months: [], tickers: [], currentTickers: [] })
    })

    it('do mês mais recente para o mais antigo, em páginas de 36, só com colunas de quem tem posição', async () => {
      await createAsset(h.db, 'PETR4')
      await createAsset(h.db, 'VALE3')
      const snapshot = (assetId: string, month: string, quantity: number) => ({
        assetId,
        month,
        quantity,
        avgPrice: 10,
        marketPrice: 12,
        totalCost: quantity * 10,
        marketValue: quantity * 12,
      })
      const months: string[] = []
      for (let i = 0; i < 40; i++) {
        const year = 2021 + Math.floor(i / 12)
        months.push(`${year}-${String((i % 12) + 1).padStart(2, '0')}-01`)
      }
      await h.db.monthlySnapshot.createMany({
        data: [
          ...months.map((month) => snapshot('PETR4', month, 10)),
          // VALE3 foi vendida: aparece nos meses antigos e zerada no último.
          snapshot('VALE3', months[0] as string, 5),
          snapshot('VALE3', months[39] as string, 0),
        ],
      })

      const page = await h.app.inject({ method: 'GET', url: '/evolution/' })
      const body = page.body.slice(page.body.indexOf('<tbody>'))
      expect(body.indexOf('04/2024')).toBeLessThan(body.indexOf('03/2024'))
      expect(page.body).toContain('<th class="text-end">PETR4</th>')
      expect(page.body).not.toContain('<th class="text-end">VALE3</th>')
      expect(page.body).toContain('hx-get="/evolution/rows?offset=36"')

      const rest = await h.app.inject({ method: 'GET', url: '/evolution/rows?offset=36' })
      expect(rest.body).toContain('04/2021')
      expect(rest.body).toContain('01/2021')
      expect(rest.body).not.toContain('hx-trigger="revealed"')
    })

    it('API de recalcular devolve status ok', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/evolution/api/recalculate' })
      expect(res.json()).toEqual({ status: 'ok' })
    })

    it('recalcular pelo botão HTMX devolve 200 vazio; o POST comum ainda redireciona', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/evolution/recalculate',
        headers: { 'hx-request': 'true' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('')
    })

    it('mostra a tabela quando há snapshots', async () => {
      await createAsset(h.db, 'PETR4')
      await h.db.monthlySnapshot.create({
        data: {
          assetId: 'PETR4',
          month: '2024-01-01',
          quantity: 10,
          avgPrice: 10,
          marketPrice: 12,
          totalCost: 100,
          marketValue: 120,
        },
      })

      const res = await h.app.inject({ method: 'GET', url: '/evolution/' })
      expect(res.body).toContain('01/2024')
      expect(res.body).toContain('PETR4')
    })
  })

  describe('tabela de posições', () => {
    it('fecha um subtotal por classe, com a TIR do grupo, e marca as colunas secundárias', async () => {
      const acoes = await createAssetClass(h.db, 'Ações')
      const fiis = await createAssetClass(h.db, 'FIIs')
      await createAsset(h.db, 'PETR4', { type: 'STOCK', hasPosition: true, assetClassId: acoes.id })
      await createAsset(h.db, 'VALE3', { type: 'STOCK', hasPosition: true, assetClassId: acoes.id })
      await createAsset(h.db, 'HGLG11', { type: 'REIT', hasPosition: true, assetClassId: fiis.id })
      await createTransaction(h.db, 'PETR4', { quantity: 10, price: 10, date: '2024-01-15' })
      await createTransaction(h.db, 'VALE3', { quantity: 10, price: 20, date: '2024-01-15' })
      await createTransaction(h.db, 'HGLG11', { quantity: 1, price: 100, date: '2024-01-15' })
      for (const ticker of ['PETR4', 'VALE3', 'HGLG11']) {
        await h.container.assets.refreshPositionFields(ticker)
      }

      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.body.match(/data-subtotal/g)).toHaveLength(2)
      expect(res.body).toContain('Subtotal Ações')
      expect(res.body).toContain('· 2 ativos')
      expect(res.body).toContain('Subtotal FIIs')
      expect(res.body).toContain('· 1 ativo')
      // Custo total das duas ações: 100 + 200.
      expect(res.body).toContain('R$ 300,00')
      expect(res.body).toContain('positions-table table-sticky"')
      expect(res.body).toContain('<th class="col-secondary" data-sort="text">Moeda')
      expect(res.body).toContain('id="toggleColumns"')
    })
  })

  describe('exclusão de ativo e acessibilidade', () => {
    it('a lista não tem mais lixeira por linha; excluir fica no modal, com a contagem do que some', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4')
      await createDividend(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/assets/?position=all' })

      expect(res.body).not.toContain('action="/assets/PETR4/delete"')
      expect(res.body).toContain('data-asset-transaction-count="2"')
      expect(res.body).toContain('data-asset-dividend-count="1"')
      expect(res.body).toContain('form="deleteAssetForm"')
      expect(res.body).toContain('id="deleteAssetForm"')
      expect(res.body).toContain('aria-label="Editar PETR4"')
    })

    it('o detalhe do ativo traz as mesmas contagens para o modal', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/assets/PETR4' })
      expect(res.body).toContain('data-asset-transaction-count="1"')
      expect(res.body).toContain('data-asset-dividend-count="0"')
    })

    it('botões só com ícone têm aria-label e todo rótulo aponta para o seu campo', async () => {
      await createAsset(h.db, 'PETR4')
      await createTransaction(h.db, 'PETR4')

      const res = await h.app.inject({ method: 'GET', url: '/transactions/' })

      expect(res.body).toContain('aria-label="Excluir transação"')
      expect(res.body).toContain('aria-label="Editar transação"')
      expect(res.body).toContain('for="txDate"')
      expect(res.body).toContain('id="txDate"')
      expect(res.body).toContain('for="txType"')
      // Nenhum rótulo de formulário sem `for` sobrou.
      expect(res.body).not.toMatch(/<label class="form-label">/)
    })

    it('a importação oferece um exemplo copiável e um modelo para baixar', async () => {
      const page = await h.app.inject({ method: 'GET', url: '/transactions/' })
      expect(page.body).toContain('data-csv-example="csvTextarea"')
      expect(page.body).toContain('id="csvExampleText"')
      expect(page.body).toContain('href="/modelos/transacoes.tsv"')

      const model = await h.app.inject({ method: 'GET', url: '/modelos/transacoes.tsv' })
      expect(model.statusCode).toBe(200)
      expect(model.body).toContain('PETR4\t01/01/2024\tC\t100')

      const dividends = await h.app.inject({ method: 'GET', url: '/dividends/' })
      expect(dividends.body).toContain('href="/modelos/proventos.tsv"')
    })
  })

  describe('rótulos da interface', () => {
    it('o menu diz Risco, a página diz Métricas de Risco e a navbar não expõe a stack', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/risk-metrics/' })

      expect(res.body).toContain('Métricas de Risco')
      expect(res.body).toContain('> Risco</a>')
      expect(res.body).not.toContain('Risk Metrics')
      expect(res.body).not.toContain('Fastify + TypeScript')
      expect(res.body).toContain('<title>Risco — Carteira</title>')
    })

    it('tipo de ativo aparece em português no badge e no select, com o código no value', async () => {
      await createAsset(h.db, 'TD:IPCA2035', { type: 'TESOURO_DIRETO' })

      const res = await h.app.inject({ method: 'GET', url: '/assets/?position=all' })

      expect(res.body).toContain('title="TESOURO_DIRETO">Tesouro Direto</span>')
      expect(res.body).toContain('<option value="TESOURO_DIRETO">Tesouro Direto</option>')
    })

    it('sem snapshot, o dashboard oferece o recálculo no lugar do gráfico', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/portfolio/' })

      expect(res.body).toContain('aparece depois do primeiro recálculo')
      expect(res.body).toContain('hx-post="/evolution/recalculate"')
      expect(res.body).not.toContain('id="evolutionChart"')
    })

    it('os formulários de lançamento começam recolhidos abaixo de lg', async () => {
      for (const [url, id] of [
        ['/transactions/', 'newTransactionForm'],
        ['/dividends/', 'newDividendForm'],
        ['/assets/', 'newAssetForm'],
      ]) {
        const res = await h.app.inject({ method: 'GET', url: url as string })
        expect(res.body).toContain(`id="${id}" class="collapse d-lg-block"`)
        expect(res.body).toContain(`data-bs-target="#${id}"`)
      }
    })

    it('os filtros de Proventos separam tipo de ativo de tipo de provento', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/dividends/' })

      expect(res.body).toContain('Tipo de ativo: Todos')
      expect(res.body).toContain('Provento: Todos')
    })
  })

  describe('risk metrics', () => {
    it('sem dados mostra o estado vazio', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/risk-metrics/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhuma métrica calculada')
    })

    it('mostra o beta e marca o não confiável', async () => {
      await createAsset(h.db, 'PETR4', { type: 'STOCK', hasPosition: true, quantity: 10 })
      await createPriceHistory(h.db, 'PETR4', '2024-06-01', 10)
      await h.db.riskMetric.create({
        data: { ticker: 'PETR4', calculatedAt: '2024-06-30', beta: 1.25, dataPoints: 5 },
      })

      const res = await h.app.inject({ method: 'GET', url: '/risk-metrics/' })
      expect(res.body).toContain('1,25')
      expect(res.body).toContain('⚠️')
      // Único ativo do tipo — a posição é 100% do STOCK.
      expect(res.body).toContain('100,00%')
    })

    it('esconde o ativo sem posição até pedirem todos', async () => {
      await createAsset(h.db, 'VALE3', { type: 'STOCK' })
      await h.db.riskMetric.create({
        data: { ticker: 'VALE3', calculatedAt: '2024-06-30', beta: 1.25, dataPoints: 12 },
      })

      const filtered = await h.app.inject({ method: 'GET', url: '/risk-metrics/' })
      expect(filtered.body).not.toContain('VALE3')

      const all = await h.app.inject({ method: 'GET', url: '/risk-metrics/?position=all' })
      expect(all.body).toContain('VALE3')
    })
  })

  describe('atualização de cotações', () => {
    it('POST /portfolio/update-prices responde vazio', async () => {
      server.use(yahooChart('yahoo_chart_empty.json'))

      const res = await h.app.inject({ method: 'POST', url: '/portfolio/update-prices' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('')
    })
  })
})
