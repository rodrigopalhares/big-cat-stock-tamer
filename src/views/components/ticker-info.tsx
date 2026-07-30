import type { AssetType } from '../../domain/constants.js'
import { ASSET_TYPES } from '../../domain/constants.js'
import type { ResolvedAssetInfo } from '../../integrations/asset-info.client.js'
import type { TickerLookupResult } from '../../modules/transaction/transaction.service.js'
import { AssetBadge } from './badge.js'

/**
 * Respostas HTMX do preenchimento automático de ticker.
 *
 * No Kotlin isso eram ~80 linhas de HTML concatenado em string dentro de
 * AssetController.tickerInfo e TransactionController.tickerInfo — sem escaping e sem
 * verificação nenhuma. Aqui são componentes com props tipadas.
 */

/** Resposta do formulário de cadastro de ativo: o aviso mais os campos preenchidos via OOB. */
export function AssetTickerInfo({
  ticker,
  info,
  exists,
}: {
  ticker: string
  info: ResolvedAssetInfo | null
  exists: boolean
}) {
  if (exists) {
    return (
      <div class="alert alert-warning small p-2 mb-0">
        <i class="bi bi-exclamation-circle me-1" />
        <strong>{ticker}</strong> já cadastrado
      </div>
    )
  }

  const found = info !== null && info.name !== ticker
  const name = found ? (info as ResolvedAssetInfo).name : ''
  const type = info?.type ?? 'STOCK'
  const currency = info?.currency ?? 'BRL'
  const alternatives = info?.alternatives ?? []

  return (
    <>
      {found ? (
        <div class="alert alert-info small p-2 mb-0">
          <i class="bi bi-cloud-download me-1" />
          <strong>{ticker}</strong> — {name} <span class="badge bg-secondary">{type}</span>
        </div>
      ) : (
        <div class="alert alert-secondary small p-2 mb-0">
          <i class="bi bi-question-circle me-1" />
          <strong>{ticker}</strong> não encontrado na internet
        </div>
      )}

      {alternatives.length > 0 ? (
        <div class="alert alert-warning small p-2 mb-0 mt-2">
          <i class="bi bi-exclamation-triangle me-1" />O ano tem mais de um vencimento. Foi
          escolhido o primeiro; os outros são {alternatives.join(', ')}. Para usar um deles, ajuste
          o código do título depois de cadastrar.
        </div>
      ) : null}

      {/* Swaps out-of-band: preenchem os campos do formulário fora do alvo da requisição. */}
      <input
        hx-swap-oob="true"
        id="assetName"
        type="text"
        name="name"
        class="form-control"
        placeholder="Ex: Petrobras PN"
        value={name}
      />
      <select hx-swap-oob="true" id="assetType" name="type" class="form-select">
        {ASSET_TYPES.map((t) => (
          <option value={t} selected={t === type}>
            {t}
          </option>
        ))}
      </select>
      <input
        hx-swap-oob="true"
        id="assetYfTicker"
        type="hidden"
        name="yf_ticker"
        value={info?.yfTicker ?? ''}
      />
      <select hx-swap-oob="true" id="assetCurrency" name="currency" class="form-select">
        <option value="BRL" selected={currency === 'BRL'}>
          BRL — Real
        </option>
        <option value="USD" selected={currency === 'USD'}>
          USD — Dólar
        </option>
      </select>
    </>
  )
}

/** Resposta do formulário de transação: só o aviso, sem preencher campos. */
export function TransactionTickerInfo({ result }: { result: TickerLookupResult }) {
  switch (result.status) {
    case 'EXISTS':
      return (
        <div class="alert alert-success small p-2 mb-0">
          <i class="bi bi-check-circle-fill me-1" />
          <strong>{result.ticker}</strong>
          {result.name !== null ? ` — ${result.name}` : ''} <AssetBadge type={result.type} />
          <span class="text-muted ms-2">já cadastrado</span>
        </div>
      )
    case 'FOUND_ONLINE':
      return (
        <div class="alert alert-info small p-2 mb-0">
          <i class="bi bi-cloud-download me-1" />
          <strong>{result.ticker}</strong> — {result.name} <AssetBadge type={result.type} />
          <span class="text-muted ms-2">será cadastrado automaticamente</span>
        </div>
      )
    default:
      return (
        <div class="alert alert-warning small p-2 mb-0">
          <i class="bi bi-question-circle me-1" />
          <strong>{result.ticker}</strong>
          <span class="text-muted ms-2">não encontrado na internet — será criado mesmo assim</span>
        </div>
      )
  }
}

export type { AssetType }
