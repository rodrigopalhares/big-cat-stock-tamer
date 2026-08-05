import {
  addDays,
  addMonths,
  fromBrazilianDate,
  type IsoDate,
  isoDateOrNull,
  toBrazilianDate,
} from '../../shared/iso-date.js'
import { HttpClient, type Logger, silentLogger } from '../http.js'
import { BcbPtaxResponse, BcbSeriesResponse } from './bcb.schema.js'

/**
 * Cliente do Banco Central: PTAX (dólar) e SGS (CDI).
 * Porte de BcbPtaxClient.kt e de `fetchCdiAnnualRate` em BenchmarkService.kt.
 */

const PTAX_BASE =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
  'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'

/**
 * CDI anualizado base 252, em % ao ano — a taxa que `fetchCdiAnnualRate` promete devolver.
 *
 * Não confundir com as vizinhas, que já custaram caro aqui:
 * - `4391` é o CDI *acumulado no mês*, em % ao mês. Lida como taxa anual, o dia 4 de agosto
 *   devolvia "0,05% a.a." — o mês em curso, ainda pela metade.
 * - `432` é a Selic meta, outro número, sempre um pouco acima do CDI (14,25 contra 14,15).
 * - `12` é o CDI diário, em % ao dia; é a série certa para compor fator ao longo do tempo,
 *   não para responder "qual é o CDI hoje".
 */
const CDI_SERIES = '4389'

/** CDI diário, em % ao dia — a série que compõe fator ao longo do tempo. */
const CDI_DAILY_SERIES = '12'

/**
 * O SGS aceita no máximo dez anos por consulta em série diária. Cinco deixa margem para
 * o limite apertar sem quebrar a carga inicial, ao custo de uma requisição a mais.
 */
const WINDOW_YEARS = 5

export type PtaxQuote = {
  readonly date: IsoDate
  readonly buyRate: number
  readonly sellRate: number
}

export type CdiDailyRate = {
  readonly date: IsoDate
  /** Fração ao dia, já dividida por 100. */
  readonly rate: number
}

export class BcbClient {
  private readonly http: HttpClient
  private readonly logger: Logger

  constructor(options: { http?: HttpClient; logger?: Logger } = {}) {
    this.logger = options.logger ?? silentLogger
    this.http = options.http ?? new HttpClient({ logger: this.logger })
  }

  /** Cotações de compra e venda do dólar no período. Lista vazia em qualquer falha. */
  async fetchPtaxRange(startDate: IsoDate, endDate: IsoDate): Promise<PtaxQuote[]> {
    const url =
      `${PTAX_BASE}?@dataInicial='${toBcbDate(startDate)}'` +
      `&@dataFinalCotacao='${toBcbDate(endDate)}'&$format=json`

    const raw = await this.http.getJson(url)
    if (raw === null) return []

    const parsed = BcbPtaxResponse.safeParse(raw)
    if (!parsed.success) {
      this.logger.warn('Resposta do PTAX em formato inesperado')
      return []
    }

    const quotes: PtaxQuote[] = []
    for (const quote of parsed.data.value) {
      // "2025-03-05 15:36:28.199" — só a data importa.
      const date = isoDateOrNull(quote.dataHoraCotacao.split(' ')[0] ?? '')
      if (date === null) {
        this.logger.warn(`Data de cotação do BCB inválida: ${quote.dataHoraCotacao}`)
        continue
      }
      quotes.push({ date, buyRate: quote.cotacaoCompra, sellRate: quote.cotacaoVenda })
    }
    return quotes
  }

  /** Taxa anual do CDI como fração (14,25% → 0.1425). Null em qualquer falha. */
  async fetchCdiAnnualRate(): Promise<number | null> {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${CDI_SERIES}/dados/ultimos/1?formato=json`

    const raw = await this.http.getJson(url)
    if (raw === null) return null

    const parsed = BcbSeriesResponse.safeParse(raw)
    if (!parsed.success) {
      this.logger.warn('Resposta da série do BCB em formato inesperado')
      return null
    }

    const entry = parsed.data[0]
    if (entry === undefined) return null

    const rate = Number(entry.valor.replace(',', '.'))
    return Number.isFinite(rate) ? rate / 100 : null
  }

  /**
   * CDI diário do período, como fração ao dia (0,052531% a.d. → 0.00052531).
   *
   * Só dias úteis — é o que o BCB publica, e é o que rende. Lista vazia em qualquer falha.
   *
   * O SGS recusa janela maior que dez anos em série diária, devolvendo 406. Como
   * `getJson` transforma status ruim em `null`, um pedido único cobrindo a carteira
   * inteira falharia calado: zero taxa gravada e nenhum erro na tela. Daí o fatiamento.
   */
  async fetchCdiDailyRange(startDate: IsoDate, endDate: IsoDate): Promise<CdiDailyRate[]> {
    if (startDate > endDate) return []

    const rates: CdiDailyRate[] = []
    for (const [from, to] of splitIntoWindows(startDate, endDate)) {
      const url =
        `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${CDI_DAILY_SERIES}/dados?formato=json` +
        `&dataInicial=${toSgsDate(from)}&dataFinal=${toSgsDate(to)}`

      const raw = await this.http.getJson(url)
      // Uma janela vazia é normal (período sem publicação); uma que falhou já foi logada
      // pelo HttpClient. Nos dois casos seguir em frente é melhor que perder o resto.
      if (raw === null) continue

      const parsed = BcbSeriesResponse.safeParse(raw)
      if (!parsed.success) {
        this.logger.warn('Resposta da série diária do CDI em formato inesperado')
        continue
      }

      for (const entry of parsed.data) {
        const date = fromBrazilianDate(entry.data)
        if (date === null) {
          this.logger.warn(`Data inválida na série do CDI: ${entry.data}`)
          continue
        }
        const percent = Number(entry.valor.replace(',', '.'))
        if (!Number.isFinite(percent)) {
          this.logger.warn(`Taxa inválida na série do CDI em ${entry.data}: ${entry.valor}`)
          continue
        }
        rates.push({ date, rate: percent / 100 })
      }
    }
    return rates
  }
}

/** O PTAX espera a data em MM-dd-yyyy. */
function toBcbDate(date: IsoDate): string {
  const [year, month, day] = date.split('-') as [string, string, string]
  return `${month}-${day}-${year}`
}

/** O SGS espera a data em dd/MM/yyyy. */
function toSgsDate(date: IsoDate): string {
  return toBrazilianDate(date)
}

/** Fatia o período em janelas de `WINDOW_YEARS`, inclusivas e sem sobreposição. */
function splitIntoWindows(startDate: IsoDate, endDate: IsoDate): Array<[IsoDate, IsoDate]> {
  const windows: Array<[IsoDate, IsoDate]> = []
  let from = startDate

  while (from <= endDate) {
    // -1 dia para a janela seguinte não repetir o último dia desta.
    const limit = addDays(addYears(from, WINDOW_YEARS), -1)
    const to = limit < endDate ? limit : endDate
    windows.push([from, to])
    from = addDays(to, 1)
  }
  return windows
}

function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * 12)
}
