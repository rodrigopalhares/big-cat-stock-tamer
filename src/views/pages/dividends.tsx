import { DIVIDEND_TYPES } from '../../domain/constants.js'
import type { DividendView } from '../../modules/dividend/dividend.schema.js'
import { assetTypeLabel } from '../../shared/asset-type-labels.js'
import { date as fmtDate, money } from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { DividendBadge } from '../components/badge.js'
import { LoadMoreRow } from '../components/load-more-row.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/dividends.html. */

/** Três linhas com tab de verdade — o placeholder não dá para copiar. */
const CSV_EXAMPLE = [
  'PETR4\t01/03/2026\tDIVIDENDO\t150,00\t0,00\tBRL\tXP\t\t',
  'PETR4\t15/03/2026\tJCP\t80,00\t12,00\tBRL\tXP\t\tIR retido na fonte',
  'MXRF11\t14/03/2026\tRENDIMENTO\t42,10\t0,00\tBRL\tXP\t\t',
].join('\n')

export type DividendsPageProps = {
  /** Primeira página do histórico — o resto chega pela rolagem infinita. */
  dividends: DividendView[]
  /** Quantos proventos os filtros atuais pegam, no total. */
  total: number
  /** Líquido em reais de tudo que o filtro pegou, não só da página. */
  netTotalBrl: number
  /** URL da próxima página; null quando tudo já está na tela. */
  nextUrl: string | null
  assets: Array<{ ticker: string; name: string }>
  /** Tipos de ativo que aparecem no histórico — só eles entram no filtro. */
  assetTypes: string[]
  selectedTicker: string | null
  selectedType: string
  selectedAssetType: string
  /** Trecho de ticker da caixa de busca. */
  search: string
  years: number[]
  selectedYear: number | null
  today: IsoDate
}

export function DividendsPage(props: DividendsPageProps) {
  const { dividends } = props

  return (
    <Layout title="Proventos — Carteira" path="/dividends/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-cash-coin" /> Proventos
          </h2>
          <div class="d-flex gap-2">
            <button
              type="button"
              class="btn btn-primary d-lg-none"
              data-bs-toggle="collapse"
              data-bs-target="#newDividendForm"
              aria-expanded="false"
              aria-controls="newDividendForm"
            >
              <i class="bi bi-plus-lg" /> Novo
            </button>
            <button
              type="button"
              class="btn btn-outline-primary"
              data-bs-toggle="modal"
              data-bs-target="#csvDivImportModal"
            >
              <i class="bi bi-file-earmark-spreadsheet" /> Importar CSV
            </button>
          </div>
        </div>

        <div class="row g-4">
          <div class="col-lg-4">
            <div id="newDividendForm" class="collapse d-lg-block">
              <NewDividendForm {...props} />
            </div>
          </div>
          <div class="col-lg-8">
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white d-flex justify-content-between align-items-center">
                <span class="fw-semibold">
                  Histórico <span class="badge bg-secondary ms-1">{props.total}</span>
                  {props.total > 0 && (
                    <span
                      class="num text-success small fw-normal ms-2"
                      title="Líquido de IR, em reais, de tudo que o filtro pegou"
                    >
                      {money(props.netTotalBrl)} líquidos
                    </span>
                  )}
                </span>
                <Filters {...props} />
              </div>
              <div class="card-body p-0">
                {props.total > 0 ? (
                  <DividendTable dividends={dividends} nextUrl={props.nextUrl} />
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
            <label class="form-label" for="newDivTicker">
              Ticker <span class="text-danger">*</span>
            </label>
            <input
              id="newDivTicker"
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
            <label class="form-label" for="newDivType">
              Tipo <span class="text-danger">*</span>
            </label>
            <select id="newDivType" name="type" class="form-select" required>
              {DIVIDEND_TYPES.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div class="mb-3">
            <label class="form-label" for="newDivCurrency">
              Moeda
            </label>
            <select name="currency" id="newDivCurrency" class="form-select">
              <option value="BRL" selected>
                BRL
              </option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label" for="newDivTotalAmount">
                Valor Bruto <span class="text-danger">*</span>
              </label>
              <input
                id="newDivTotalAmount"
                type="number"
                name="total_amount"
                class="form-control"
                step="0.01"
                min="0.01"
                required
              />
            </div>
            <div class="col-6">
              <label class="form-label" for="newDivTaxWithheld">
                IR Retido
              </label>
              <input
                id="newDivTaxWithheld"
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
            <label class="form-label" for="newDivDate">
              Data <span class="text-danger">*</span>
            </label>
            <input
              id="newDivDate"
              type="date"
              name="date"
              class="form-control"
              value={today}
              required
            />
          </div>
          <div class="mb-3">
            <label class="form-label" for="newDivNotes">
              Notas
            </label>
            <textarea
              id="newDivNotes"
              name="notes"
              class="form-control"
              rows={2}
              placeholder="Opcional"
            />
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
 * Tudo mora no mesmo `form`: submeter um select manda os outros junto, então trocar o tipo de
 * provento não apaga a busca nem o ano.
 */
function Filters({
  assetTypes,
  selectedTicker,
  selectedType,
  selectedAssetType,
  search,
  years,
  selectedYear,
}: DividendsPageProps) {
  const hasFilters =
    selectedTicker !== null ||
    search !== '' ||
    selectedType !== '' ||
    selectedAssetType !== '' ||
    selectedYear !== null
  return (
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <form
        method="get"
        action="/dividends/"
        class="d-flex align-items-center gap-2 mb-0 flex-wrap"
      >
        <div class="input-group input-group-sm" style="width: 11rem">
          <input
            type="search"
            name="q"
            class="form-control"
            placeholder="Ticker"
            list="ticker-list"
            value={search !== '' ? search : (selectedTicker ?? '')}
            data-uppercase
            aria-label="Buscar por ticker"
          />
          <button type="submit" class="btn btn-outline-secondary" aria-label="Buscar">
            <i class="bi bi-search" />
          </button>
        </div>
        <select name="year" class="form-select form-select-sm" style="width:auto" data-autosubmit>
          <option value="">Ano: Todos</option>
          {years.map((year) => (
            <option value={String(year)} selected={year === selectedYear}>
              {year}
            </option>
          ))}
        </select>
        <select
          name="assetType"
          class="form-select form-select-sm"
          style="width:auto"
          data-autosubmit
        >
          <option value="">Tipo de ativo: Todos</option>
          {assetTypes.map((t) => (
            <option value={t} selected={t === selectedAssetType}>
              {assetTypeLabel(t)}
            </option>
          ))}
        </select>
        <select name="type" class="form-select form-select-sm" style="width:auto" data-autosubmit>
          <option value="">Provento: Todos</option>
          {DIVIDEND_TYPES.map((t) => (
            <option value={t} selected={t === selectedType}>
              {t}
            </option>
          ))}
        </select>
      </form>
      {hasFilters && (
        <a
          href="/dividends/"
          class="btn btn-sm btn-outline-secondary"
          title="Limpar filtros"
          aria-label="Limpar filtros"
        >
          <i class="bi bi-x-lg" />
        </a>
      )}
    </div>
  )
}

function DividendTable({
  dividends,
  nextUrl,
}: {
  dividends: DividendView[]
  nextUrl: string | null
}) {
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
          <DividendRows dividends={dividends} nextUrl={nextUrl} />
        </tbody>
      </table>
    </div>
  )
}

/** As linhas de uma página mais a sentinela da seguinte — o que `/dividends/rows` devolve. */
export function DividendRows({
  dividends,
  nextUrl,
}: {
  dividends: DividendView[]
  nextUrl: string | null
}) {
  return (
    <>
      {dividends.map((d) => (
        <DividendRow dividend={d} />
      ))}
      {nextUrl !== null && <LoadMoreRow href={nextUrl} colSpan={7} />}
    </>
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
          aria-label="Editar provento"
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
          <button
            type="submit"
            class="btn btn-sm btn-outline-danger border-0"
            title="Excluir"
            aria-label="Excluir provento"
          >
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
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar" />
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
                <div class="form-text">
                  <button
                    type="button"
                    class="btn btn-link btn-sm p-0 align-baseline"
                    data-csv-example="divCsvTextarea"
                    data-csv-example-source="divCsvExampleText"
                  >
                    Preencher com um exemplo
                  </button>
                  {' · '}
                  <a href="/modelos/proventos.tsv" download>
                    Baixar modelo (.tsv)
                  </a>
                </div>
                <textarea id="divCsvExampleText" hidden readOnly>
                  {CSV_EXAMPLE}
                </textarea>
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
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar" />
          </div>
          <form id="editDivForm" method="post">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label" for="editDivType">
                  Tipo
                </label>
                <select id="editDivType" name="type" class="form-select" required>
                  {DIVIDEND_TYPES.map((t) => (
                    <option value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label" for="editDivCurrency">
                  Moeda
                </label>
                <select id="editDivCurrency" name="currency" class="form-select">
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label" for="editDivTotalAmount">
                    Valor Bruto
                  </label>
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
                  <label class="form-label" for="editDivTaxWithheld">
                    IR Retido
                  </label>
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
                <label class="form-label" for="editDivDate">
                  Data
                </label>
                <input type="date" id="editDivDate" name="date" class="form-control" required />
              </div>
              <div class="mb-3">
                <label class="form-label" for="editDivNotes">
                  Notas
                </label>
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
