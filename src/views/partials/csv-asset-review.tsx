import { ASSET_TYPES } from '../../domain/constants.js'
import type { AssetStatus } from '../../domain/csv/transaction-csv.js'
import type { CsvAssetRow } from '../../modules/csv-import/csv-import.service.js'

/**
 * Etapa 1 do import de CSV: revisão dos ativos.
 * Porte de src/main/resources/templates/fragments/csv-asset-review.html.
 */

const STATUS_BADGE: Record<AssetStatus, { class: string; label: string }> = {
  EXISTS: { class: 'bg-success', label: 'Existente' },
  WILL_CREATE: { class: 'bg-info', label: 'Novo' },
  UNKNOWN: { class: 'bg-warning text-dark', label: 'Desconhecido' },
}

export function CsvAssetReview({ rows, rawCsv }: { rows: CsvAssetRow[]; rawCsv: string }) {
  if (rows.length === 0) {
    return <div class="alert alert-warning">Nenhum ticker encontrado no CSV.</div>
  }

  const newAssetCount = rows.filter((row) => row.assetStatus !== 'EXISTS').length

  return (
    <div>
      <h6 class="mb-3">
        <i class="bi bi-box-seam" /> Etapa 1: Revisão de Ativos
      </h6>
      <p class="text-muted small">
        Revise os ativos encontrados no CSV. Ativos novos podem ser configurados antes de
        prosseguir.
      </p>

      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle small" id="csvAssetTable">
          <thead class="table-light sticky-top">
            <tr>
              <th>Ticker</th>
              <th>Status</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>YF Ticker</th>
              <th>Moeda</th>
              <th class="text-center">Ignorar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AssetRow row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <textarea id="csvRawHidden" class="d-none">
        {rawCsv}
      </textarea>

      <div class="d-flex justify-content-between align-items-center mt-3">
        <span class="text-muted small">
          {rows.length} ativos encontrados
          {newAssetCount > 0 && <span class="text-info ms-2">({newAssetCount} novos)</span>}
        </span>
        <button type="button" class="btn btn-primary" data-csv-next-step>
          <i class="bi bi-arrow-right" /> Próximo
          <span id="csv-step2-spinner" class="d-none">
            <span class="spinner-border spinner-border-sm" role="status" />
          </span>
        </button>
      </div>
    </div>
  )
}

function AssetRow({ row }: { row: CsvAssetRow }) {
  const exists = row.assetStatus === 'EXISTS'
  const badge = STATUS_BADGE[row.assetStatus]

  return (
    <tr class={exists ? 'table-light' : ''}>
      <td>
        {exists ? (
          <span>
            <strong>{row.ticker}</strong>
            <input type="hidden" class="asset-field" data-field="ticker" value={row.ticker} />
          </span>
        ) : (
          <div class="input-group input-group-sm" style="width:140px">
            <input
              type="text"
              class="form-control form-control-sm asset-field"
              data-field="ticker"
              value={row.ticker}
              data-original-ticker={row.ticker}
              data-ticker-lookup
            />
            <span class="input-group-text d-none ticker-spinner">
              <span class="spinner-border spinner-border-sm" role="status" />
            </span>
          </div>
        )}
      </td>
      <td>
        <span class={`badge ${badge.class}`}>{badge.label}</span>
        <input type="hidden" class="asset-field" data-field="status" value={row.assetStatus} />
      </td>
      <td>
        {exists ? (
          <span class="text-muted">{row.name}</span>
        ) : (
          <input
            type="text"
            class="form-control form-control-sm asset-field"
            data-field="name"
            value={row.name}
            style="width:200px"
          />
        )}
      </td>
      <td>
        {exists ? (
          <span class="text-muted">{row.type}</span>
        ) : (
          <select
            class="form-select form-select-sm asset-field"
            data-field="type"
            style="width:130px"
          >
            {ASSET_TYPES.map((t) => (
              <option value={t} selected={t === row.type}>
                {t}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        {exists ? (
          <span class="text-muted">{row.yfTicker}</span>
        ) : (
          <input
            type="text"
            class="form-control form-control-sm asset-field"
            data-field="yfTicker"
            value={row.yfTicker}
            style="width:120px"
            data-yf-ticker-lookup
          />
        )}
      </td>
      <td>
        {exists ? (
          <span class="text-muted">{row.currency}</span>
        ) : (
          <select
            class="form-select form-select-sm asset-field"
            data-field="currency"
            style="width:80px"
          >
            <option value="BRL" selected={row.currency === 'BRL'}>
              BRL
            </option>
            <option value="USD" selected={row.currency === 'USD'}>
              USD
            </option>
          </select>
        )}
      </td>
      <td class="text-center">
        <input type="checkbox" class="form-check-input asset-ignore-check" />
      </td>
    </tr>
  )
}
