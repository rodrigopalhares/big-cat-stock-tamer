import type { AssetStatus, CsvRow } from '../../domain/csv/transaction-csv.js'
import { TRANSACTION_TYPE_LIST } from '../../shared/transaction-types.js'

/**
 * Etapa 2 do import de CSV: revisão das transações.
 * Porte de src/main/resources/templates/fragments/csv-preview.html.
 */

const STATUS_BADGE: Record<AssetStatus, { class: string; label: string }> = {
  EXISTS: { class: 'bg-success', label: 'Existente' },
  WILL_CREATE: { class: 'bg-info', label: 'Novo' },
  UNKNOWN: { class: 'bg-warning text-dark', label: 'Desconhecido' },
}

export function CsvPreview({ rows }: { rows: CsvRow[] }) {
  if (rows.length === 0) {
    return <div class="alert alert-warning">Nenhuma linha válida encontrada no CSV.</div>
  }

  const withError = rows.filter((row) => row.error !== null).length
  const importable = rows.length - withError

  return (
    <div>
      {withError > 0 && (
        <div class="form-check form-switch mb-2">
          <input
            class="form-check-input"
            type="checkbox"
            id="csvShowErrorsOnly"
            data-csv-errors-only
          />
          <label class="form-check-label small" for="csvShowErrorsOnly">
            Mostrar apenas linhas com erro
          </label>
        </div>
      )}

      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle small" id="csvPreviewTable">
          <thead class="table-light sticky-top">
            <tr>
              <th>#</th>
              <th>Ticker</th>
              <th>Data</th>
              <th>Tipo</th>
              <th class="text-end">Qtd</th>
              <th class="text-end">Preço</th>
              <th class="text-end">Taxas</th>
              <th>Corretora</th>
              <th>Notas</th>
              <th>Moeda</th>
              <th>Status</th>
              <th class="text-center">Ignorar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PreviewRow row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div class="d-flex justify-content-between align-items-center mt-3">
        <span class="text-muted small">
          {rows.length} linhas processadas
          {withError > 0 && <span class="text-danger ms-2">({withError} com erro)</span>}
        </span>
        <button
          type="button"
          class="btn btn-primary"
          id="csvBatchSubmitBtn"
          data-csv-batch-submit
          disabled={importable === 0}
        >
          <i class="bi bi-check-lg" /> Confirmar Importação (
          <span id="csvBatchCount">{importable}</span> transações)
        </button>
      </div>
    </div>
  )
}

function PreviewRow({ row }: { row: CsvRow }) {
  const hasError = row.error !== null
  const badge = STATUS_BADGE[row.assetStatus]

  return (
    <tr class={hasError ? 'table-danger' : ''} data-has-error={String(hasError)}>
      <td>
        {row.rowIndex + 1}
        {hasError && (
          <span class="badge bg-danger ms-1 csv-error-badge" title={row.error ?? ''}>
            {row.error}
          </span>
        )}
      </td>
      <td>
        <Field field="ticker" value={row.ticker} width="80px" />
      </td>
      <td>
        <input
          type="date"
          class="form-control form-control-sm csv-field"
          data-field="date"
          value={row.date}
          style="width:140px"
        />
      </td>
      <td>
        <select class="form-select form-select-sm csv-field" data-field="type" style="width:140px">
          {TRANSACTION_TYPE_LIST.map((meta) => (
            <option value={meta.type} selected={row.type === meta.type}>
              {meta.labelPt}
            </option>
          ))}
        </select>
      </td>
      <td>
        <NumberField field="quantity" value={row.quantity} step="0.0001" width="100px" />
      </td>
      <td>
        <NumberField field="price" value={row.price} step="0.0001" width="100px" />
      </td>
      <td>
        <NumberField field="fees" value={row.fees} step="0.01" width="80px" />
      </td>
      <td>
        <Field field="broker" value={row.broker} width="80px" />
      </td>
      <td>
        <Field field="notes" value={row.notes} width="120px" />
      </td>
      <td>
        <select
          class="form-select form-select-sm csv-field"
          data-field="currency"
          style="width:70px"
        >
          <option value="BRL" selected={row.currency === 'BRL'}>
            BRL
          </option>
          <option value="USD" selected={row.currency === 'USD'}>
            USD
          </option>
        </select>
      </td>
      <td>
        {hasError ? (
          <span class="badge bg-danger csv-error-badge">{row.error}</span>
        ) : (
          <span class={`badge ${badge.class}`}>{badge.label}</span>
        )}
      </td>
      <td class="text-center">
        {/* Linha com erro já vem marcada para ignorar — evita importar dado quebrado por descuido. */}
        <input
          type="checkbox"
          class="form-check-input csv-ignore-check"
          data-ticker={row.ticker}
          checked={hasError}
        />
      </td>
    </tr>
  )
}

function Field({ field, value, width }: { field: string; value: string; width: string }) {
  return (
    <input
      type="text"
      class="form-control form-control-sm csv-field"
      data-field={field}
      value={value}
      style={`width:${width}`}
    />
  )
}

function NumberField({
  field,
  value,
  step,
  width,
}: {
  field: string
  value: number
  step: string
  width: string
}) {
  return (
    <input
      type="number"
      class="form-control form-control-sm csv-field text-end"
      data-field={field}
      value={String(value)}
      step={step}
      style={`width:${width}`}
    />
  )
}
