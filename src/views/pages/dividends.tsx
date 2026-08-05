import { DIVIDEND_TYPES } from '../../domain/constants.js'
import type { DividendView } from '../../modules/dividend/dividend.schema.js'
import { date as fmtDate, money } from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { DividendBadge } from '../components/badge.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/dividends.html. */

export type DividendsPageProps = {
  dividends: DividendView[]
  assets: Array<{ ticker: string; name: string }>
  /** Tipos de ativo que aparecem no histórico — só eles entram no filtro. */
  assetTypes: string[]
  selectedTicker: string | null
  selectedType: string
  selectedAssetType: string
  today: IsoDate
}

export function DividendsPage(props: DividendsPageProps) {
  const { dividends } = props

  return (
    <Layout title="Proventos" path="/dividends/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-cash-coin" /> Proventos
          </h2>
          <button
            type="button"
            class="btn btn-outline-primary"
            data-bs-toggle="modal"
            data-bs-target="#csvDivImportModal"
          >
            <i class="bi bi-file-earmark-spreadsheet" /> Importar CSV
          </button>
        </div>

        <div class="row g-4">
          <div class="col-lg-4">
            <NewDividendForm {...props} />
          </div>
          <div class="col-lg-8">
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white d-flex justify-content-between align-items-center">
                <span class="fw-semibold">
                  Histórico <span class="badge bg-secondary ms-1">{dividends.length}</span>
                </span>
                <Filters {...props} />
              </div>
              <div class="card-body p-0">
                {dividends.length > 0 ? (
                  <DividendTable dividends={dividends} />
                ) : (
                  <div class="text-center py-5 text-muted">
                    <i class="bi bi-inbox fs-1" />
                    <p class="mt-2">Nenhum provento registrado.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <CsvImportModal />
      <DividendModal />
      <script src="/js/dividends.js" defer />
    </Layout>
  )
}

function NewDividendForm({ assets, today }: DividendsPageProps) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">
        <i class="bi bi-plus-circle" /> Novo Provento
      </div>
      <div class="card-body">
        <form method="post" action="/dividends/new">
          <div class="mb-3">
            <label class="form-label">
              Ticker <span class="text-danger">*</span>
            </label>
            <input
              type="text"
              name="ticker"
              class="form-control"
              list="ticker-list"
              placeholder="Ex: PETR4, MXRF11"
              autocomplete="off"
              required
              data-uppercase
              hx-get="/dividends/ticker-info"
              hx-trigger="change, keyup changed delay:600ms"
              hx-target="#ticker-preview"
              hx-include="this"
            />
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
            <select name="type" class="form-select" required>
              {DIVIDEND_TYPES.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div class="mb-3">
            <label class="form-label">Moeda</label>
            <select name="currency" id="newDivCurrency" class="form-select">
              <option value="BRL" selected>
                BRL
              </option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label">
                Valor Bruto <span class="text-danger">*</span>
              </label>
              <input
                type="number"
                name="total_amount"
                class="form-control"
                step="0.01"
                min="0.01"
                required
              />
            </div>
            <div class="col-6">
              <label class="form-label">IR Retido</label>
              <input
                type="number"
                name="tax_withheld"
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
 * Os dois selects moram no mesmo `form`: submeter um manda o outro junto, então trocar o
 * tipo de provento não apaga o filtro de ativo. O `ticker` vem escondido pelo mesmo motivo.
 */
function Filters({
  assetTypes,
  selectedTicker,
  selectedType,
  selectedAssetType,
}: DividendsPageProps) {
  const hasFilters = selectedTicker !== null || selectedType !== '' || selectedAssetType !== ''
  return (
    <div class="d-flex align-items-center gap-2">
      <form method="get" action="/dividends/" class="d-flex align-items-center gap-2 mb-0">
        {selectedTicker !== null && <input type="hidden" name="ticker" value={selectedTicker} />}
        <select
          name="assetType"
          class="form-select form-select-sm"
          style="width:auto"
          data-autosubmit
        >
          <option value="">Ativo: Todos</option>
          {assetTypes.map((t) => (
            <option value={t} selected={t === selectedAssetType}>
              {t}
            </option>
          ))}
        </select>
        <select name="type" class="form-select form-select-sm" style="width:auto" data-autosubmit>
          <option value="">Tipo: Todos</option>
          {DIVIDEND_TYPES.map((t) => (
            <option value={t} selected={t === selectedType}>
              {t}
            </option>
          ))}
        </select>
      </form>
      {hasFilters && (
        <a href="/dividends/" class="btn btn-sm btn-outline-secondary">
          <i class="bi bi-x-lg" />
        </a>
      )}
    </div>
  )
}

function DividendTable({ dividends }: { dividends: DividendView[] }) {
  return (
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle small">
        <thead class="table-light">
          <tr>
            <th>Data</th>
            <th>Ativo</th>
            <th>Tipo</th>
            <th class="text-end">Valor Bruto</th>
            <th class="text-end">IR Retido</th>
            <th class="text-end">Valor Líquido</th>
            <th class="text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {dividends.map((d) => (
            <DividendRow dividend={d} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DividendRow({ dividend: d }: { dividend: DividendView }) {
  const foreign = d.currency !== 'BRL'
  const dual = (value: number, valueBrl: number) => (
    <>
      {money(value, d.currency)}
      {foreign && <div class="text-muted small">{money(valueBrl)}</div>}
    </>
  )

  return (
    <tr>
      <td>{fmtDate(d.date)}</td>
      <td class="fw-bold">
        <a href={`/assets/${d.assetTicker}`} class="text-decoration-none">
          {d.assetTicker}
        </a>
      </td>
      <td>
        <DividendBadge type={d.type} />
      </td>
      <td class="text-end">{dual(d.totalAmount, d.totalAmountBrl)}</td>
      <td class="text-end text-muted">{dual(d.taxWithheld, d.taxWithheldBrl)}</td>
      <td class="text-end fw-semibold text-success">{dual(d.netAmount, d.netAmountBrl)}</td>
      <td class="text-center text-nowrap">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary border-0"
          title="Editar"
          data-edit-div
          data-div-id={String(d.id)}
          data-div-type={d.type}
          data-div-total-amount={String(d.totalAmount)}
          data-div-tax-withheld={String(d.taxWithheld)}
          data-div-date={d.date}
          data-div-currency={d.currency}
          data-div-notes={d.notes ?? ''}
        >
          <i class="bi bi-pencil" />
        </button>
        <form
          method="post"
          action={`/dividends/${d.id}/delete`}
          class="d-inline"
          data-confirm="Excluir este provento?"
        >
          <button type="submit" class="btn btn-sm btn-outline-danger border-0">
            <i class="bi bi-trash" />
          </button>
        </form>
      </td>
    </tr>
  )
}

function CsvImportModal() {
  return (
    <div class="modal fade" id="csvDivImportModal" tabindex={-1}>
      <div class="modal-dialog modal-fullscreen">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-file-earmark-spreadsheet" /> Importar Proventos
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" />
          </div>
          <div class="modal-body d-flex flex-column overflow-hidden">
            {/* div em vez de ul/li pelo mesmo motivo do modal de transações: o lint não
                quer papel interativo dentro de lista. */}
            <div class="nav nav-tabs flex-shrink-0 mb-3" role="tablist">
              <button
                type="button"
                class="nav-link active"
                data-bs-toggle="tab"
                data-bs-target="#divCsvTabPane"
                role="tab"
              >
                <i class="bi bi-clipboard" /> CSV
              </button>
              <button
                type="button"
                class="nav-link"
                data-bs-toggle="tab"
                data-bs-target="#divXlsxTabPane"
                role="tab"
              >
                <i class="bi bi-file-earmark-arrow-up" /> Extrato da B3
              </button>
            </div>

            <div class="tab-content flex-shrink-0 mb-3">
              <div class="tab-pane fade show active" id="divCsvTabPane" role="tabpanel">
                <label class="form-label" for="divCsvTextarea">
                  Cole os dados do CSV (separado por tab):
                </label>
                <textarea
                  id="divCsvTextarea"
                  name="csv"
                  class="form-control font-monospace"
                  rows={6}
                  placeholder="PETR4&#9;01/03/2026&#9;DIVIDENDO&#9;1,50&#9;0,00&#9;BRL&#9;XP&#9;&#9;"
                />
                <div class="form-text">
                  Formato: ticker &lt;tab&gt; data &lt;tab&gt; tipo &lt;tab&gt; valor &lt;tab&gt; IR
                  &lt;tab&gt; moeda &lt;tab&gt; corretora &lt;tab&gt; [ignorar] &lt;tab&gt; notas
                </div>
                <div class="mt-3">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    hx-post="/dividends/parse-csv"
                    hx-include="#divCsvTextarea"
                    hx-target="#div-csv-preview-area"
                    hx-indicator="#divCsvSpinner"
                  >
                    <i class="bi bi-arrow-repeat" /> Processar
                  </button>
                  <span id="divCsvSpinner" class="htmx-indicator">
                    <span class="spinner-border spinner-border-sm" role="status" /> Processando...
                  </span>
                </div>
              </div>

              <XlsxImportPane />
            </div>

            <div id="div-csv-preview-area" class="flex-grow-1 overflow-auto min-h-0" />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Aba do extrato da B3. O preview cai na mesma área da aba do CSV — do "Confirmar
 * Importação" em diante os dois caminhos são um só.
 */
function XlsxImportPane() {
  return (
    <div class="tab-pane fade" id="divXlsxTabPane" role="tabpanel">
      <label class="form-label" for="divXlsxFile">
        Envie o extrato de Movimentação da B3 (.xlsx):
      </label>
      <input
        type="file"
        class="form-control"
        id="divXlsxFile"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      />
      <div class="form-text">
        Área do Investidor → Extrato → Movimentação → Baixar em Excel. Rendimento, dividendo, JCP e
        a taxa de aluguel viram provento; transferência e a perna em ações do empréstimo são
        descartadas. O que já está no histórico chega com "Ignorar" marcado, então dá para enviar o
        período inteiro sem recortar.
      </div>
      <div class="mt-3">
        <button type="button" class="btn btn-secondary" data-div-xlsx-parse>
          <i class="bi bi-arrow-repeat" /> Processar
        </button>
        <span id="divXlsxSpinner" class="d-none ms-2">
          <span class="spinner-border spinner-border-sm" role="status" /> Lendo o extrato...
        </span>
      </div>
    </div>
  )
}

/**
 * Serve para editar e para criar: na tela do ativo o ticker já está decidido, então o mesmo
 * formulário vira o de "Novo Provento" com um `ticker` escondido — o cliente troca a ação,
 * o título e o ícone.
 */
export function DividendModal() {
  return (
    <div class="modal fade" id="editDivModal" tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-pencil" id="editDivModalIcon" />{' '}
              <span id="editDivModalTitle">Editar Provento</span>
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" />
          </div>
          <form id="editDivForm" method="post">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Tipo</label>
                <select id="editDivType" name="type" class="form-select" required>
                  {DIVIDEND_TYPES.map((t) => (
                    <option value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Moeda</label>
                <select id="editDivCurrency" name="currency" class="form-select">
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label">Valor Bruto</label>
                  <input
                    type="number"
                    id="editDivTotalAmount"
                    name="total_amount"
                    class="form-control"
                    step="0.01"
                    min="0.01"
                    required
                  />
                </div>
                <div class="col-6">
                  <label class="form-label">IR Retido</label>
                  <input
                    type="number"
                    id="editDivTaxWithheld"
                    name="tax_withheld"
                    class="form-control"
                    step="0.01"
                    min="0"
                    value="0"
                  />
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label">Data</label>
                <input type="date" id="editDivDate" name="date" class="form-control" required />
              </div>
              <div class="mb-3">
                <label class="form-label">Notas</label>
                <textarea id="editDivNotes" name="notes" class="form-control" rows={2} />
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
