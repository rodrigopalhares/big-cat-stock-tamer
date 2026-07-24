import { type IsoDate, isoDateOrNull } from '../../shared/iso-date.js'
import { HttpClient, type Logger, silentLogger } from '../http.js'
import { BcbPtaxResponse, BcbSeriesResponse } from './bcb.schema.js'

/**
 * Cliente do Banco Central: PTAX (dólar) e SGS (Selic meta, usada como proxy do CDI).
 * Porte de BcbPtaxClient.kt e de `fetchCdiAnnualRate` em BenchmarkService.kt.
 */

const PTAX_BASE =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
  'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'

/** Selic meta — o BCB não publica série diária de CDI aberta. */
const CDI_SERIES = '4391'

export type PtaxQuote = {
  readonly date: IsoDate
  readonly buyRate: number
  readonly sellRate: number
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
}

/** O PTAX espera a data em MM-dd-yyyy. */
function toBcbDate(date: IsoDate): string {
  const [year, month, day] = date.split('-') as [string, string, string]
  return `${month}-${day}-${year}`
}
