import type { Db } from '../../config/db.js'
import { findQuantityShortfall, type QuantityEvent } from '../../domain/calculation.js'
import type { Currency } from '../../domain/constants.js'
import type { Asset, Transaction } from '../../generated/prisma/client.js'
import type { AssetInfoLookup } from '../../integrations/asset-info.client.js'
import { quantity as fmtQuantity } from '../../shared/format.js'
import { HttpError } from '../../shared/http-error.js'
import { type IsoDate, toBrazilianDate } from '../../shared/iso-date.js'
import { transactionTypeMeta } from '../../shared/transaction-types.js'
import type { AssetClassService } from '../allocation/asset-class.service.js'
import type { ExchangeRateService } from '../exchange-rate/exchange-rate.service.js'

/** Porte de src/main/kotlin/com/stocks/service/TransactionService.kt. */

export type ResolvedPrice = { price: number; fees: number }

export type ConvertedPrices = {
  price: number
  fees: number
  priceBrl: number
  feesBrl: number
}

export type TickerLookupStatus = 'EXISTS' | 'FOUND_ONLINE' | 'NOT_FOUND'

export type TickerLookupResult = {
  ticker: string
  name: string | null
  type: string | null
  status: TickerLookupStatus
}

export type TransactionInput = {
  type: string
  quantity: number
  price: number
  fees: number
  date: IsoDate
  broker?: string | null | undefined
  notes?: string | null | undefined
  inputCurrency?: string | null | undefined
  /** Nota de negociação que originou a transação, quando veio de um PDF importado. */
  brokerNoteId?: number | null | undefined
}

export type TransactionFilters = {
  ticker?: string | null | undefined
  type?: string | null | undefined
  position?: string | null | undefined
}

export class TransactionService {
  constructor(
    private readonly db: Db,
    private readonly assetInfo: AssetInfoLookup,
    private readonly exchangeRates: ExchangeRateService,
    private readonly assetClasses: AssetClassService,
  ) {}

  /** Busca o ativo; se não existir, cria buscando os dados na fonte do ticker. */
  async findOrCreateAsset(ticker: string): Promise<Asset> {
    const normalized = ticker.trim().toUpperCase()
    const existing = await this.db.asset.findUnique({ where: { ticker: normalized } })
    if (existing !== null) return existing

    // Chamada de rede fora de qualquer transação (regra §3.3 do plano).
    const info = await this.assetInfo.fetchAssetInfo(normalized)
    return this.db.asset.create({
      data: {
        ticker: normalized,
        yfTicker: info.yfTicker,
        name: info.name === normalized ? null : info.name,
        type: info.type,
        currency: info.currency,
        assetClassId: await this.assetClasses.defaultClassIdForType(info.type),
      },
    })
  }

  /**
   * Deduz o preço unitário a partir do que o formulário trouxe.
   *
   * O "valor bruto" é quantidade × preço, sem taxas — são duas formas de dizer a mesma
   * coisa, então ele serve para informar o preço quando só o bruto da nota está à mão.
   * As taxas ficam de fora da conta: são um campo independente, e é isso que faz o número
   * digitado voltar igual na tabela.
   *
   * Quando os dois vêm preenchidos o preço ganha, porque é o campo mais preciso: o bruto
   * chega arredondado em centavos, e derivar o preço dele mexeria na quarta casa a cada
   * vez que o modal de edição fosse salvo sem alterar nada. Para acertar a linha pelo
   * bruto, basta apagar o preço — a tela diz isso no placeholder.
   *
   * Evento sem caixa não negocia preço, então sai antes da exigência de preço ou bruto.
   * A redução de capital passa pela regra normal — sem valor por ação ela não diz nada.
   */
  resolvePrice(
    type: string,
    price: number | null | undefined,
    totalPrice: number | null | undefined,
    fees: number,
    quantity: number,
  ): ResolvedPrice {
    if (!transactionTypeMeta(normalizeType(type)).cashFlow) {
      return normalizePriceFees(type, price ?? 0, fees)
    }

    const fromTotal =
      totalPrice != null && totalPrice > 0 && quantity > 0 ? totalPrice / quantity : null
    const resolvedPrice = price != null && price > 0 ? price : fromTotal

    if (resolvedPrice === null || resolvedPrice <= 0) {
      throw HttpError.badRequest('Informe o preço unitário ou o valor bruto')
    }

    return { price: resolvedPrice, fees }
  }

  /** Cria a transação, criando o ativo automaticamente quando ele não existe. */
  async createTransaction(ticker: string, input: TransactionInput): Promise<Transaction> {
    const normalized = ticker.trim().toUpperCase()
    const asset = await this.findOrCreateAsset(normalized)
    return this.insert(asset, normalized, input)
  }

  /** Cria a transação exigindo que o ativo já exista (rota de API). */
  async createTransactionForExistingAsset(
    assetId: string,
    input: TransactionInput,
  ): Promise<Transaction> {
    const normalized = assetId.toUpperCase()
    const asset = await this.db.asset.findUnique({ where: { ticker: normalized } })
    if (asset === null) throw HttpError.notFound('Ativo não encontrado')
    return this.insert(asset, asset.ticker, input)
  }

  async listTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
    const eligible = await this.resolveEligibleTickers(filters.type, filters.position)

    return this.db.transaction.findMany({
      where: {
        ...(filters.ticker ? { assetId: filters.ticker.toUpperCase() } : {}),
        ...(eligible === null ? {} : { assetId: { in: [...eligible] } }),
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    })
  }

  async updateTransaction(id: number, input: TransactionInput): Promise<string> {
    const tx = await this.db.transaction.findUnique({ where: { id } })
    if (tx === null) throw HttpError.notFound('Transação não encontrada')

    assertQuantity(input.quantity)
    const type = normalizeType(input.type)
    // A própria linha sai da conta: é a versão nova dela que está em julgamento.
    await this.assertPositionStaysNonNegative(
      tx.assetId,
      [{ type, quantity: input.quantity, date: input.date }],
      id,
    )

    const asset = await this.db.asset.findUnique({ where: { ticker: tx.assetId } })
    const assetCurrency = asset?.currency ?? 'BRL'
    const converted = await this.convertPrices(
      input.price,
      input.fees,
      blankToNull(input.inputCurrency) ?? assetCurrency,
      assetCurrency,
      input.date,
    )

    const meta = transactionTypeMeta(type)
    const normalized = normalizePriceFees(type, converted.price, converted.fees)
    const normalizedBrl = normalizePriceFees(type, converted.priceBrl, converted.feesBrl)

    await this.db.transaction.update({
      where: { id },
      data: {
        type,
        quantity: meta.sign * Math.abs(input.quantity),
        price: normalized.price,
        fees: normalized.fees,
        priceBrl: normalizedBrl.price,
        feesBrl: normalizedBrl.fees,
        currency: assetCurrency,
        date: input.date,
        broker: blankToNull(input.broker),
        notes: blankToNull(input.notes),
      },
    })
    return tx.assetId
  }

  async deleteTransaction(id: number): Promise<string> {
    const tx = await this.db.transaction.findUnique({ where: { id } })
    if (tx === null) throw HttpError.notFound('Transação não encontrada')
    await this.db.transaction.delete({ where: { id } })
    return tx.assetId
  }

  /**
   * Converte os valores digitados para a moeda do ativo e para reais.
   *
   * A transação é sempre gravada na moeda do ativo; se o usuário digitou em outra,
   * a conversão acontece aqui, pela cotação da data da operação.
   */
  async convertPrices(
    inputPrice: number,
    inputFees: number,
    inputCurrency: string,
    assetCurrency: string,
    date: IsoDate,
  ): Promise<ConvertedPrices> {
    if (inputCurrency === assetCurrency) {
      if (assetCurrency === 'BRL') {
        return { price: inputPrice, fees: inputFees, priceBrl: inputPrice, feesBrl: inputFees }
      }
      const rate = await this.exchangeRates.getRate(assetCurrency, 'BRL', date)
      return {
        price: inputPrice,
        fees: inputFees,
        priceBrl: inputPrice * rate,
        feesBrl: inputFees * rate,
      }
    }

    if (inputCurrency === 'BRL') {
      // Valores em reais para um ativo em moeda estrangeira.
      const rate = await this.exchangeRates.getRate(assetCurrency, 'BRL', date)
      return {
        price: inputPrice / rate,
        fees: inputFees / rate,
        priceBrl: inputPrice,
        feesBrl: inputFees,
      }
    }

    if (assetCurrency !== 'BRL') {
      throw new Error(
        `Conversão não suportada: inputCurrency=${inputCurrency}, assetCurrency=${assetCurrency}`,
      )
    }

    // Valores em moeda estrangeira para um ativo em reais.
    const rate = await this.exchangeRates.getRate(inputCurrency, 'BRL', date)
    return {
      price: inputPrice * rate,
      fees: inputFees * rate,
      priceBrl: inputPrice * rate,
      feesBrl: inputFees * rate,
    }
  }

  /** Usado pelo formulário para mostrar se o ticker já existe ou será criado. */
  async lookupTickerInfo(ticker: string): Promise<TickerLookupResult> {
    const normalized = ticker.trim().toUpperCase()
    if (normalized.length < 3) {
      return { ticker: normalized, name: null, type: null, status: 'NOT_FOUND' }
    }

    const existing = await this.db.asset.findUnique({ where: { ticker: normalized } })
    if (existing !== null) {
      return {
        ticker: normalized,
        name: existing.name,
        type: existing.type,
        status: 'EXISTS',
      }
    }

    const info = await this.assetInfo.fetchAssetInfo(normalized)
    return info.name === normalized
      ? { ticker: normalized, name: null, type: null, status: 'NOT_FOUND' }
      : { ticker: normalized, name: info.name, type: info.type, status: 'FOUND_ONLINE' }
  }

  /**
   * Recusa a redução (venda ou agrupamento) que deixaria a posição negativa em algum ponto
   * do histórico — a venda de 999.999 ações de um papel com 1.586 entrava calada e virava
   * um "Total Investido" negativo de milhões no dashboard.
   *
   * Fica no service, e não na rota, porque é um dos três caminhos de escrita (formulário,
   * API e lote do CSV) e a regra vale para todos. Público porque o lote valida todas as
   * linhas de um ticker de uma vez, antes de gravar qualquer uma.
   *
   * [excludeId] tira do histórico a linha em edição: quem está em julgamento é a versão nova.
   */
  async assertPositionStaysNonNegative(
    assetId: string,
    candidates: readonly QuantityEvent[],
    excludeId?: number,
  ): Promise<void> {
    // Só quem reduz pode estourar; compra e evento que só soma não precisam da consulta.
    if (candidates.every((c) => transactionTypeMeta(c.type).sign > 0)) return

    const existing = await this.db.transaction.findMany({
      where: { assetId, ...(excludeId === undefined ? {} : { id: { not: excludeId } }) },
      select: { type: true, quantity: true, date: true },
    })
    const shortfall = findQuantityShortfall(
      existing.map((t) => ({ ...t, date: t.date as IsoDate })),
      candidates,
    )
    if (shortfall === null) return

    const { candidate, available } = shortfall
    throw HttpError.badRequest(
      `${transactionTypeMeta(candidate.type).labelPt} de ${fmtQuantity(Math.abs(candidate.quantity))} ` +
        `${assetId} em ${toBrazilianDate(candidate.date)} supera a posição de ` +
        `${fmtQuantity(available)} na data.`,
    )
  }

  private async insert(
    asset: Asset,
    assetId: string,
    input: TransactionInput,
  ): Promise<Transaction> {
    assertQuantity(input.quantity)
    const type = normalizeType(input.type)
    await this.assertPositionStaysNonNegative(assetId, [
      { type, quantity: input.quantity, date: input.date },
    ])

    const converted = await this.convertPrices(
      input.price,
      input.fees,
      blankToNull(input.inputCurrency) ?? asset.currency,
      asset.currency,
      input.date,
    )
    const meta = transactionTypeMeta(type)
    const normalized = normalizePriceFees(type, converted.price, converted.fees)
    const normalizedBrl = normalizePriceFees(type, converted.priceBrl, converted.feesBrl)

    return this.db.transaction.create({
      data: {
        assetId,
        type,
        quantity: meta.sign * Math.abs(input.quantity),
        price: normalized.price,
        fees: normalized.fees,
        priceBrl: normalizedBrl.price,
        feesBrl: normalizedBrl.fees,
        currency: asset.currency as Currency,
        date: input.date,
        broker: blankToNull(input.broker),
        notes: blankToNull(input.notes),
        brokerNoteId: input.brokerNoteId ?? null,
      },
    })
  }

  /** Null quando não há filtro — o chamador então não restringe por ticker. */
  private async resolveEligibleTickers(
    type?: string | null,
    position?: string | null,
  ): Promise<Set<string> | null> {
    const hasTypeFilter = Boolean(type)
    const hasPositionFilter = Boolean(position) && position !== 'all'
    if (!hasTypeFilter && !hasPositionFilter) return null

    const assets = await this.db.asset.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(position === 'with' ? { hasPosition: true } : {}),
        ...(position === 'without' ? { hasPosition: false } : {}),
      },
      select: { ticker: true },
    })
    return new Set(assets.map((a) => a.ticker))
  }
}

function blankToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === '' ? null : value
}

/** Quantidade zero (ou NaN) gravaria uma linha que o cálculo ignora e a tabela mostra. */
function assertQuantity(quantity: number): void {
  if (!(Math.abs(quantity) > 0)) throw HttpError.badRequest('Quantidade deve ser maior que zero')
}

function normalizeType(type: string): string {
  return type.trim().toUpperCase()
}

/**
 * Preço e taxas que o tipo admite, aplicado imediatamente antes de gravar.
 *
 * Fica aqui, e não na rota, porque o formulário HTML é só um dos três caminhos de escrita —
 * a API JSON e o lote do CSV não passam por `resolvePrice`. Sem isso, um desdobramento
 * vindo da API guardaria o preço que o cliente mandasse e a tabela mostraria um valor que
 * o cálculo ignora.
 */
function normalizePriceFees(type: string, price: number, fees: number): ResolvedPrice {
  switch (transactionTypeMeta(normalizeType(type)).costEffect) {
    case 'MARKET':
    case 'RETURN_OF_CAPITAL':
      return { price, fees }
    case 'FIXED_PRICE':
      // Bonificação: o custo atribuído vale, corretagem não existe.
      return { price, fees: 0 }
    case 'NONE':
      return { price: 0, fees: 0 }
  }
}
