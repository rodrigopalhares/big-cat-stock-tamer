import { DIVIDEND_TYPES, VALID_CURRENCIES } from '../../domain/constants.js'
import type { DividendCsvRow } from '../../domain/csv/dividend-csv.js'

/**
 * Preview do import de proventos.
 * Porte de src/main/resources/templates/fragments/dividend-csv-preview.html.
 *
 * Diferente do CSV de transações, aqui não há etapa de revisão de ativos: provento exige
 * ativo já cadastrado, então linha com ticker desconhecido vem marcada como erro.
 */
export function DividendCsvPreview({ rows }: { rows: DividendCsvRow[] }) {
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
            id="divCsvShowErrorsOnly"
            data-csv-errors-only
          />
          <label class="form-check-label small" for="divCsvShowErrorsOnly">
            Mostrar apenas linhas com erro
          </label>
        </div>
      )}

      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle small" id="divCsvPreviewTable">
          <thead class="table-light sticky-top">
            <tr>
              <th>#</th>
              <th>Ticker</th>
              <th>Data</th>
              <th>Tipo</th>
              <th class="text-end">Valor Bruto</th>
              <th class="text-end">IR Retido</th>
              <th>Moeda</th>
              <th>Corretora</th>
              <th>Notas</th>
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
          id="divCsvBatchSubmitBtn"
          data-div-csv-batch-submit
          disabled={importable === 0}
        >
          <i class="bi bi-check-lg" /> Confirmar Importação (
          <span id="divCsvBatchCount">{importable}</span> proventos)
        </button>
      </div>
    </div>
  )
}

function PreviewRow({ row }: { row: DividendCsvRow }) {
  const hasError = row.error !== null

  return (
    <tr class={hasError ? 'table-danger' : ''} data-has-error={String(hasError)}>
      <td>{row.rowIndex + 1}</td>
      <td>
        <input
          type="text"
          class="form-control form-control-sm div-csv-field"
          data-field="ticker"
          value={row.ticker}
          style="width:80px"
        />
      </td>
      <td>
        <input
          type="date"
          class="form-control form-control-sm div-csv-field"
          data-field="date"
          value={row.date}
          style="width:140px"
        />
      </td>
      <td>
        <select
          class="form-select form-select-sm div-csv-field"
          data-field="type"
          style="width:130px"
        >
          {DIVIDEND_TYPES.map((t) => (
            <option value={t} selected={t === row.type}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="number"
          class="form-control form-control-sm div-csv-field text-end"
          data-field="totalAmount"
          value={String(row.totalAmount)}
          step="0.01"
          style="width:100px"
        />
      </td>
      <td>
        <input
          type="number"
          class="form-control form-control-sm div-csv-field text-end"
          data-field="taxWithheld"
          value={String(row.taxWithheld)}
          step="0.01"
          style="width:90px"
        />
      </td>
      <td>
        <select
          class="form-select form-select-sm div-csv-field"
          data-field="currency"
          style="width:70px"
        >
          {VALID_CURRENCIES.map((currency) => (
            <option value={currency} selected={currency === row.currency}>
              {currency}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="text"
          class="form-control form-control-sm div-csv-field"
          data-field="broker"
          value={row.broker}
          style="width:80px"
        />
      </td>
      <td>
        <input
          type="text"
          class="form-control form-control-sm div-csv-field"
          data-field="notes"
          value={row.notes}
          style="width:120px"
        />
      </td>
      <td>
        {hasError ? (
          <span class="badge bg-danger csv-error-badge" title={row.error ?? ''}>
            {row.error}
          </span>
        ) : (
          <span class="badge bg-success">OK</span>
        )}
      </td>
      <td class="text-center">
        <input type="checkbox" class="form-check-input div-csv-ignore-check" checked={hasError} />
      </td>
    </tr>
  )
}
