import type { TickerSource } from '../../domain/broker-note.js'
import type { BrokerNoteImport } from '../../modules/broker-note/broker-note.service.js'
import {
  currencySymbol,
  decimal,
  date as fmtDate,
  quantity as fmtQuantity,
  money,
} from '../../shared/format.js'

/**
 * Prévia da nota lida pela Anthropic, antes de virar CSV.
 *
 * Mostra o consolidado por ticker e as duas conferências: a do modelo e a nossa. Quando
 * o total não fecha, o aviso aparece mas o botão continua ativo — o preview do CSV é
 * editável, então corrigir lá é mais rápido do que refazer a leitura.
 */

export function BrokerNotePreview({ result }: { result: BrokerNoteImport }) {
  const { note, groups, check } = result

  return (
    <div id="notePreview" data-broker-note-id={String(result.id)} data-csv={result.csv}>
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <span class="fw-semibold">
            {note.broker || 'Corretora não identificada'}
            {note.noteNumber !== '' && <span class="text-muted"> · nota {note.noteNumber}</span>}
          </span>
          <span class="text-muted ms-2 small">
            pregão de {fmtDate(note.date)} · {note.trades.length} execuções agrupadas em{' '}
            {groups.length} {groups.length === 1 ? 'ticker' : 'tickers'}
          </span>
        </div>
        <div class="d-flex gap-2">
          <a
            class="btn btn-sm btn-outline-secondary"
            href={`/transactions/notes/${result.id}`}
            download
          >
            <i class="bi bi-file-earmark-pdf" /> Arquivo
          </a>
          <a
            class="btn btn-sm btn-outline-secondary"
            href={`/transactions/notes/${result.id}/response`}
            title="O JSON que o modelo devolveu, sem edição"
            download
          >
            <i class="bi bi-filetype-json" /> Resposta da IA
          </a>
        </div>
      </div>

      <Conference result={result} />

      {groups.some((g) => g.tickerSource === 'NONE') && (
        <div class="alert alert-danger py-2 small">
          <i class="bi bi-exclamation-octagon" /> Esta nota não imprime o código de negociação de
          todos os papéis, e o nome não bateu com nenhum ativo cadastrado. Preencha o ticker das
          linhas marcadas na etapa de revisão — o total da nota fecha mesmo com o papel errado,
          então a conferência acima não protege contra isso.
        </div>
      )}

      <div class="table-responsive mb-3">
        <table class="table table-sm table-bordered align-middle small mb-0">
          <thead class="table-light">
            <tr>
              <th>Ticker</th>
              <th>Papel na nota</th>
              <th>Operação</th>
              <th class="text-end">Qtd</th>
              <th class="text-end">Preço médio</th>
              <th class="text-end">Valor</th>
              <th class="text-end">Taxas rateadas</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr>
                <td class="fw-semibold">
                  {group.ticker === '' ? <span class="text-danger">—</span> : group.ticker}
                  <TickerOrigin source={group.tickerSource} />
                </td>
                <td class="text-muted">{group.security || '—'}</td>
                <td>{group.side === 'C' ? 'Compra' : 'Venda'}</td>
                <td class="text-end">{fmtQuantity(group.quantity)}</td>
                {/* Quatro casas: o médio ponderado quase nunca cai num centavo redondo. */}
                <td class="text-end">
                  {currencySymbol('BRL')} {decimal(group.price, 4)}
                </td>
                <td class="text-end">{money(group.value, 'BRL')}</td>
                <td class="text-end">{money(group.fees, 'BRL')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot class="table-light">
            <tr>
              <td colspan={5} class="text-end fw-semibold">
                Total
              </td>
              <td class="text-end fw-semibold">
                {money(
                  groups.reduce((sum, g) => sum + g.value, 0),
                  'BRL',
                )}
              </td>
              <td class="text-end fw-semibold">{money(note.totalFees, 'BRL')}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {result.fees.length > 0 && (
        <p class="text-muted small">
          Taxas:{' '}
          {result.fees.map((fee, index) => (
            <span>
              {index > 0 && ' · '}
              {fee.label} {money(fee.value, 'BRL')}
            </span>
          ))}
        </p>
      )}

      <div class="d-flex justify-content-end">
        <button type="button" class="btn btn-primary" data-note-use-csv>
          <i class="bi bi-arrow-right-circle" /> Usar no CSV
        </button>
      </div>
    </div>
  )
}

/**
 * Ticker lido da nota não leva selo — é o caso normal. Os outros dois levam, porque
 * deduzido e não identificado exigem conferência humana antes de virar transação.
 */
function TickerOrigin({ source }: { source: TickerSource }) {
  if (source === 'NOTE') return null
  return source === 'NAME' ? (
    <span class="badge bg-info-subtle text-info-emphasis ms-1" title="Deduzido do nome do papel">
      pelo nome
    </span>
  ) : (
    <span class="badge bg-danger ms-1" title="A nota não imprime o código de negociação">
      preencher
    </span>
  )
}

function Conference({ result }: { result: BrokerNoteImport }) {
  const { check } = result
  const alertClass = check.ok ? 'alert-success' : 'alert-warning'

  return (
    <div class={`alert ${alertClass} py-2 small`}>
      <div class="fw-semibold">
        <i class={`bi ${check.ok ? 'bi-check-circle' : 'bi-exclamation-triangle'}`} />{' '}
        {check.ok
          ? `Conferência do total fecha: ${money(check.declared, 'BRL')}`
          : `Total não confere — declarado ${money(check.declared, 'BRL')}, calculado ` +
            `${money(check.calculated, 'BRL')} (diferença ${money(check.difference, 'BRL')})`}
      </div>
      <div class="text-muted mt-1">{result.checkNotes}</div>
    </div>
  )
}
