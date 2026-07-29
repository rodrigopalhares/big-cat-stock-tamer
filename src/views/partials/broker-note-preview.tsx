import type { TickerSource } from '../../domain/broker-note.js'
import type { BrokerNoteImport } from '../../modules/broker-note/broker-note.service.js'
import {
  currencySymbol,
  decimal,
  date as fmtDate,
  quantity as fmtQuantity,
  money,
} from '../../shared/format.js'
import { prettyJson, tokenizeJson } from '../../shared/json-view.js'

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
      <div class="mb-3">
        <span class="fw-semibold">
          {note.broker || 'Corretora não identificada'}
          {note.noteNumber !== '' && <span class="text-muted"> · nota {note.noteNumber}</span>}
        </span>
        <span class="text-muted ms-2 small">
          pregão de {fmtDate(note.date)} · {note.trades.length} execuções agrupadas em{' '}
          {groups.length} {groups.length === 1 ? 'ticker' : 'tickers'}
        </span>
      </div>

      <Conference result={result} />
      <AiResponse raw={result.rawResponse} noteId={result.id} />

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
 * A resposta do modelo, recolhida por padrão.
 *
 * Fica logo abaixo da conferência porque é ali que ela é útil: quando o total não fecha, a
 * primeira pergunta é o que o modelo leu de fato. O `collapse` do Bootstrap funciona por
 * delegação, então continua respondendo mesmo com o fragmento injetado por innerHTML.
 */
function AiResponse({ raw, noteId }: { raw: string; noteId: number }) {
  const tokens = tokenizeJson(prettyJson(raw))

  return (
    <div class="mb-3">
      <button
        type="button"
        class="btn btn-sm btn-link p-0 text-decoration-none"
        data-bs-toggle="collapse"
        data-bs-target="#aiResponseBox"
        aria-expanded="false"
        aria-controls="aiResponseBox"
      >
        <i class="bi bi-chevron-right json-caret" /> Resposta da IA
      </button>
      {/* O download fica aqui dentro: quem quer o arquivo já abriu o painel. */}
      <a
        class="btn btn-sm btn-link p-0 text-decoration-none ms-3 small"
        href={`/transactions/notes/${noteId}/response`}
        download
      >
        <i class="bi bi-download" /> Baixar
      </a>
      <div class="collapse" id="aiResponseBox">
        {/* Tudo numa linha: quebra dentro do <pre> viraria espaço em branco na tela. */}
        {/* biome-ignore format: o <pre> preserva o que o formatador acrescentaria */}
        <pre class="json-view border rounded p-3 mt-2 mb-0"><code>{tokens.map((token) => (token.type === 'plain' ? token.text : <span class={`json-${token.type}`}>{token.text}</span>))}</code></pre>
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
