import { ASSET_TYPES } from '../../domain/constants.js'
import type { TransactionView } from '../../modules/transaction/transaction.schema.js'
import { date as fmtDate, money, quantity } from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { TRANSACTION_TYPE_LIST } from '../../shared/transaction-types.js'
import { TransactionBadge } from '../components/badge.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/transactions.html. */

const NOTE_DISABLED_REASON =
  'Leitura de nota desativada: configure APP_ANTHROPIC_API_KEY para habilitar.'

export type TransactionsPageProps = {
  transactions: TransactionView[]
  assets: Array<{ ticker: string; name: string }>
  selectedTicker: string | null
  selectedType: string
  selectedPosition: string
  today: IsoDate
  /** Falso sem APP_ANTHROPIC_API_KEY — a aba de nota aparece desativada, com o motivo. */
  noteImportEnabled: boolean
}

export function TransactionsPage(props: TransactionsPageProps) {
  const { transactions } = props

  return (
    <Layout title="Transações" path="/transactions/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-arrow-left-right" /> Transações
          </h2>
          <button
            type="button"
            class="btn btn-outline-primary"
            data-bs-toggle="modal"
            data-bs-target="#csvImportModal"
          >
            <i class="bi bi-file-earmark-spreadsheet" /> Importar
          </button>
        </div>

        <CsvImportModal noteImportEnabled={props.noteImportEnabled} />

        <div class="row g-4">
          <div class="col-lg-4">
            <NewTransactionForm {...props} />
          </div>
          <div class="col-lg-8">
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white d-flex justify-content-between align-items-center">
                <span class="fw-semibold">
                  Histórico <span class="badge bg-secondary ms-1">{transactions.length}</span>
                </span>
                <HistoryFilters {...props} />
              </div>
              <div class="card-body p-0">
                {transactions.length > 0 ? (
                  <HistoryTable transactions={transactions} />
                ) : (
                  <div class="text-center py-5 text-muted">
                    <i class="bi bi-inbox fs-1" />
                    <p class="mt-2">Nenhuma transação registrada.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransactionModal />
      <script src="/js/transactions.js" defer />
    </Layout>
  )
}

function CsvImportModal({ noteImportEnabled }: { noteImportEnabled: boolean }) {
  return (
    <div class="modal fade" id="csvImportModal" tabindex={-1} aria-hidden="true">
      <div class="modal-dialog modal-fullscreen">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-file-earmark-spreadsheet" /> Importar Transações
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar" />
          </div>
          <div class="modal-body d-flex flex-column overflow-hidden">
            {/* div em vez de ul/li: o Bootstrap aceita as duas formas e o lint não quer
                papel interativo em lista. */}
            <div class="nav nav-tabs flex-shrink-0 mb-3" role="tablist">
              <button
                type="button"
                class="nav-link active"
                data-bs-toggle="tab"
                data-bs-target="#csvTabPane"
                role="tab"
              >
                <i class="bi bi-file-earmark-spreadsheet" /> CSV
              </button>
              <NoteTab enabled={noteImportEnabled} />
            </div>
            <div class="tab-content flex-grow-1 min-h-0">
              <div
                class="tab-pane fade show active h-100 overflow-auto"
                id="csvTabPane"
                role="tabpanel"
              >
                <div class="flex-shrink-0 mb-3">
                  <label class="form-label">Cole os dados do CSV (separado por tab):</label>
                  <textarea
                    id="csvTextarea"
                    name="csv"
                    class="form-control font-monospace"
                    rows={6}
                    placeholder="PETR4&#9;01/01/2024&#9;C&#9;100&#9;25,50&#9;10,00&#9;XP&#9;0&#9;BRL&#9;"
                  />
                  <div class="form-text">
                    Formato: ticker &lt;tab&gt; data &lt;tab&gt; C/V/B/D/A/R.CAP &lt;tab&gt; qtd
                    &lt;tab&gt; preço &lt;tab&gt; taxas &lt;tab&gt; corretora &lt;tab&gt; irrf
                    &lt;tab&gt; moeda &lt;tab&gt; notas
                    <br />B = bonificação, D = desdobramento, A = agrupamento. Nesses três a
                    quantidade é o delta de ações; o preço só vale na bonificação, como custo
                    atribuído.
                    <br />
                    R.CAP = redução de capital: a quantidade é a base de ações e o preço é o valor
                    devolvido por ação, que abate o preço médio.
                  </div>
                </div>
                <div class="flex-shrink-0 mb-3">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    hx-post="/transactions/parse-csv"
                    hx-include="#csvTextarea"
                    hx-target="#csv-preview-area"
                    hx-indicator="#csv-spinner"
                  >
                    <i class="bi bi-arrow-repeat" /> Processar
                  </button>
                  <span id="csv-spinner" class="htmx-indicator">
                    <span class="spinner-border spinner-border-sm" role="status" /> Processando...
                  </span>
                </div>
                <div id="csv-preview-area" />
              </div>
              <NoteImportPane enabled={noteImportEnabled} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A aba nunca some — sumir faria o usuário procurar uma funcionalidade que ele nem sabe
 * que existe. Sem chave ela fica desativada, com o motivo.
 *
 * O `title` vai no `<span>` de fora, não no botão: o Bootstrap aplica
 * `pointer-events: none` em `.nav-link:disabled`, então o botão não recebe o hover e a
 * dica nunca apareceria. O envoltório recebe o evento no lugar dele.
 */
function NoteTab({ enabled }: { enabled: boolean }) {
  const tab = (
    <button
      type="button"
      class={`nav-link${enabled ? '' : ' disabled'}`}
      data-bs-toggle="tab"
      data-bs-target="#noteTabPane"
      role="tab"
      disabled={!enabled}
      aria-disabled={enabled ? undefined : 'true'}
    >
      <i class="bi bi-file-earmark-pdf" /> Nota de negociação
      {!enabled && <i class="bi bi-lock ms-1" />}
    </button>
  )

  if (enabled) return tab
  return (
    <span class="d-inline-block" title={NOTE_DISABLED_REASON}>
      {tab}
    </span>
  )
}

/**
 * Aba da nota de negociação: envia o PDF, mostra a prévia e joga o CSV extraído no
 * textarea da aba ao lado — daí em diante o fluxo é o mesmo do CSV colado à mão.
 */
function NoteImportPane({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <div class="tab-pane fade h-100 overflow-auto" id="noteTabPane" role="tabpanel">
        <div class="alert alert-secondary">
          <i class="bi bi-lock" /> {NOTE_DISABLED_REASON}
        </div>
      </div>
    )
  }

  return (
    <div class="tab-pane fade h-100 overflow-auto" id="noteTabPane" role="tabpanel">
      <div class="mb-3">
        <label class="form-label" for="noteFile">
          Envie o arquivo da nota de negociação:
        </label>
        <input
          type="file"
          class="form-control"
          id="noteFile"
          accept="application/pdf,image/png,image/jpeg,image/webp"
        />
        <div class="form-text">
          A nota é lida pela Anthropic, agrupada por ticker e com as taxas rateadas
          proporcionalmente ao valor operado de cada papel. O arquivo enviado e o CSV extraído ficam
          salvos e podem ser baixados depois pela própria transação.
        </div>
      </div>
      <div class="mb-3">
        <button type="button" class="btn btn-secondary" data-note-parse>
          <i class="bi bi-stars" /> Ler nota
        </button>
        <span id="note-spinner" class="d-none ms-2">
          <span class="spinner-border spinner-border-sm" role="status" /> Lendo a nota...
        </span>
      </div>
      <div id="note-preview-area" />
    </div>
  )
}

function NewTransactionForm({ assets, selectedTicker, today }: TransactionsPageProps) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">
        <i class="bi bi-plus-circle" /> Nova Transação
      </div>
      <div class="card-body">
        <form method="post" action="/transactions/new">
          <div class="mb-3">
            <label class="form-label">
              Ticker <span class="text-danger">*</span>
            </label>
            {selectedTicker === null ? (
              <input
                type="text"
                name="ticker"
                id="tickerInput"
                class="form-control"
                list="ticker-list"
                placeholder="Ex: PETR4, MXRF11, BOVA11"
                autocomplete="off"
                required
                data-uppercase
                hx-get="/transactions/ticker-info"
                hx-trigger="change, keyup changed delay:600ms"
                hx-target="#ticker-preview"
                hx-include="this"
              />
            ) : (
              <input
                type="text"
                name="ticker"
                id="tickerInput"
                class="form-control"
                value={selectedTicker}
                readonly
                required
              />
            )}
            <datalist id="ticker-list">
              {assets.map((a) => (
                <option value={a.ticker}>{a.name}</option>
              ))}
            </datalist>
            <div id="ticker-preview" class="mt-2" />
          </div>

          <div class="mb-3">
            <label class="form-label">
              Tipo <span class="text-danger">*</span>
            </label>
            <TransactionTypeSelect idPrefix="tx" selected="BUY" />
            <div class="form-text" id="txTypeHint" />
          </div>

          <div class="mb-3">
            <label class="form-label">Moeda</label>
            <select name="currency" id="txCurrency" class="form-select">
              <option value="BRL" selected>
                BRL
              </option>
              <option value="USD">USD</option>
            </select>
          </div>

          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label">
                Quantidade <span class="text-danger">*</span>
              </label>
              <input
                type="number"
                id="txQty"
                name="quantity"
                class="form-control"
                step="0.0001"
                min="0.0001"
                required
              />
            </div>
            <div class="col-6" id="txPriceCol">
              <label class="form-label" id="txPriceLabel">
                Preço Unit.
              </label>
              <input
                type="number"
                id="txPrice"
                name="price"
                class="form-control"
                step="0.0001"
                min="0"
                placeholder="ou informe o total"
              />
            </div>
          </div>

          <div class="row g-2 mb-3" id="txMarketExtrasRow">
            <div class="col-6">
              <label class="form-label">Valor Total</label>
              <input
                type="number"
                id="txTotal"
                name="total_price"
                class="form-control"
                step="0.01"
                min="0"
                placeholder="opcional"
              />
            </div>
            <div class="col-6">
              <label class="form-label">Taxas</label>
              <input
                type="number"
                id="txFees"
                name="fees"
                class="form-control"
                step="0.01"
                min="0"
                value="0"
              />
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label">
              Data <span class="text-danger">*</span>
            </label>
            <input type="date" name="date" class="form-control" value={today} required />
          </div>
          <div class="mb-3">
            <label class="form-label">Corretora</label>
            <input type="text" name="broker" class="form-control" placeholder="Ex: Clear, XP" />
          </div>
          <div class="mb-3">
            <label class="form-label">Notas</label>
            <textarea name="notes" class="form-control" rows={2} placeholder="Opcional" />
          </div>
          <button type="submit" class="btn btn-primary w-100">
            <i class="bi bi-check-lg" /> Registrar
          </button>
        </form>
      </div>
    </div>
  )
}

/**
 * Seis tipos não cabem num grupo de botões — vira `select`, percorrendo o mesmo mapa que
 * o cálculo usa, como a página de proventos já faz com `DIVIDEND_TYPES`.
 */
function TransactionTypeSelect({
  idPrefix,
  selected,
}: {
  idPrefix: string
  selected: string | null
}) {
  return (
    <select name="type" id={`${idPrefix}Type`} class="form-select" data-tx-type-select required>
      {TRANSACTION_TYPE_LIST.map((meta) => (
        <option value={meta.type} selected={meta.type === selected}>
          {meta.labelPt}
        </option>
      ))}
    </select>
  )
}

function HistoryFilters({ selectedTicker, selectedType, selectedPosition }: TransactionsPageProps) {
  const hasFilters = selectedTicker !== null || selectedType !== '' || selectedPosition !== ''
  return (
    <div class="d-flex align-items-center gap-2">
      <form method="get" action="/transactions/" class="d-flex align-items-center gap-2 mb-0">
        {selectedTicker !== null && <input type="hidden" name="ticker" value={selectedTicker} />}
        <select name="type" class="form-select form-select-sm" style="width:auto" data-autosubmit>
          <option value="">Tipo: Todos</option>
          {ASSET_TYPES.map((t) => (
            <option value={t} selected={t === selectedType}>
              {t}
            </option>
          ))}
        </select>
        <select
          name="position"
          class="form-select form-select-sm"
          style="width:auto"
          data-autosubmit
        >
          <option value="">Posição: Todos</option>
          <option value="with" selected={selectedPosition === 'with'}>
            Com posição
          </option>
          <option value="without" selected={selectedPosition === 'without'}>
            Sem posição
          </option>
        </select>
      </form>
      {hasFilters && (
        <a href="/transactions/" class="btn btn-sm btn-outline-secondary">
          <i class="bi bi-x-lg" />
        </a>
      )}
    </div>
  )
}

function HistoryTable({ transactions }: { transactions: TransactionView[] }) {
  return (
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle small">
        <thead class="table-light">
          <tr>
            <th>Data</th>
            <th>Ativo</th>
            <th>Tipo</th>
            <th class="text-end">Qtd</th>
            <th class="text-end">Preço</th>
            <th class="text-end">Taxas</th>
            <th class="text-end">Total</th>
            <th>Corretora</th>
            <th class="text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <TransactionRow transaction={t} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TransactionRow({ transaction: t }: { transaction: TransactionView }) {
  const foreign = t.currency !== 'BRL'
  const dual = (value: number, valueBrl: number, extraClass = '') => (
    <>
      {money(value, t.currency)}
      {foreign && <div class={`text-muted small ${extraClass}`}>{money(valueBrl)}</div>}
    </>
  )

  return (
    <tr>
      <td>{fmtDate(t.date)}</td>
      <td class="fw-bold">
        <a href={`/assets/${t.assetTicker}`} class="text-decoration-none">
          {t.assetTicker}
        </a>
      </td>
      <td>
        <TransactionBadge type={t.type} />
      </td>
      <td class="text-end">{quantity(t.quantity)}</td>
      <td class="text-end">{dual(t.price, t.priceBrl)}</td>
      <td class="text-end text-muted">{dual(t.fees, t.feesBrl)}</td>
      <td class="text-end fw-semibold">{dual(t.total, t.totalBrl)}</td>
      <td class="text-muted">
        {t.broker ?? '—'}
        {t.brokerNoteId !== null && (
          <a
            href={`/transactions/notes/${t.brokerNoteId}`}
            class="ms-1 text-decoration-none"
            title="Baixar a nota de negociação"
            download
          >
            <i class="bi bi-file-earmark-pdf" />
          </a>
        )}
      </td>
      <td class="text-center text-nowrap">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary border-0"
          title="Editar"
          data-edit-tx
          data-tx-id={String(t.id)}
          data-tx-type={t.type}
          data-tx-quantity={String(t.quantity)}
          data-tx-price={String(t.price)}
          data-tx-fees={String(t.fees)}
          data-tx-date={t.date}
          data-tx-currency={t.currency}
          data-tx-broker={t.broker ?? ''}
          data-tx-notes={t.notes ?? ''}
        >
          <i class="bi bi-pencil" />
        </button>
        <form
          method="post"
          action={`/transactions/${t.id}/delete`}
          class="d-inline"
          data-confirm="Excluir esta transação?"
        >
          <button type="submit" class="btn btn-sm btn-outline-danger border-0">
            <i class="bi bi-trash" />
          </button>
        </form>
      </td>
    </tr>
  )
}

/**
 * Serve para editar e para criar: na tela do ativo o ticker já está decidido, então o mesmo
 * formulário vira o de "Nova Transação" com um `ticker` escondido — o cliente troca a ação,
 * o título e o ícone. Só o campo "Valor Total" fica de fora; ele é conveniência da tela de
 * transações, e o preço aqui é obrigatório.
 */
export function TransactionModal() {
  return (
    <div class="modal fade" id="editTxModal" tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-pencil" id="editTxModalIcon" />{' '}
              <span id="editTxModalTitle">Editar Transação</span>
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" />
          </div>
          <form id="editTxForm" method="post">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Tipo</label>
                <TransactionTypeSelect idPrefix="editTx" selected={null} />
              </div>
              <div class="mb-3">
                <label class="form-label">Moeda</label>
                <select id="editTxCurrency" name="currency" class="form-select">
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              {/* Quantidade e data valem para todo tipo; preço e taxas, só quando há negócio. */}
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label">Quantidade</label>
                  <input
                    type="number"
                    id="editTxQty"
                    name="quantity"
                    class="form-control"
                    step="0.0001"
                    min="0.0001"
                    required
                  />
                </div>
                <div class="col-6">
                  <label class="form-label">Data</label>
                  <input type="date" id="editTxDate" name="date" class="form-control" required />
                </div>
              </div>
              <div class="row g-2 mb-3" id="editTxMarketRow">
                <div class="col-6" id="editTxPriceCol">
                  <label class="form-label" id="editTxPriceLabel">
                    Preço Unit.
                  </label>
                  <input
                    type="number"
                    id="editTxPrice"
                    name="price"
                    class="form-control"
                    step="0.0001"
                    min="0"
                    required
                    data-required-when-visible="true"
                  />
                </div>
                <div class="col-6" id="editTxFeesCol">
                  <label class="form-label">Taxas</label>
                  <input
                    type="number"
                    id="editTxFees"
                    name="fees"
                    class="form-control"
                    step="0.01"
                    min="0"
                    value="0"
                  />
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label">Corretora</label>
                <input type="text" id="editTxBroker" name="broker" class="form-control" />
              </div>
              <div class="mb-3">
                <label class="form-label">Notas</label>
                <textarea id="editTxNotes" name="notes" class="form-control" rows={2} />
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary">
                <i class="bi bi-check-lg" /> Salvar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
