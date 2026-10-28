import type { CdiComparison } from '../../modules/cdi/cdi.schema.js'
import type { AssetPosition, PortfolioSummary } from '../../modules/portfolio/portfolio.schema.js'
import {
  decimal,
  date as fmtDate,
  money,
  percent,
  quantity,
  signClass,
} from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { AssetBadge } from '../components/badge.js'
import { RecalculateEvolutionButton } from '../components/recalculate-button.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/dashboard.html. */

export type ChartData = {
  labels: string[]
  datasets: Array<{ label: string; data: number[] }>
  invested: number[]
  /** Aporte líquido acumulado mês a mês — o mesmo número do card, ao longo do tempo. */
  netContribution: number[]
  ibov: Array<number | null>
  /** Saldo da carteira-sombra no CDI, mês a mês. */
  cdi: Array<number | null>
}

/** Proventos por mês, uma série por tipo de ativo — barras empilhadas + média móvel. */
export type DividendChartData = {
  labels: string[]
  datasets: Array<{ label: string; data: number[] }>
  movingAverage: number[]
}

/** As posições de uma classe de alocação e o consolidado que fecha o grupo na tabela. */
export type ClassGroup = {
  /** Valor de `data-class` e do filtro: id da classe, ou `none` no balde "Sem classe". */
  key: string
  name: string
  /** Ordenadas por tipo e ticker. */
  positions: AssetPosition[]
  summary: PortfolioSummary
}

export type DashboardPageProps = {
  /** Classes em ordem alfabética, "Sem classe" por último. */
  groups: ClassGroup[]
  netContribution: number
  totalInvested: number
  realizedPnl: number
  currentValue: number | null
  unrealizedPnl: number | null
  dividendPnl: number
  irrAnnual: number | null
  irrMonthly: number | null
  hasUsd: boolean
  usdRate: number | null
  /** Data da cotação mais recente; null quando não há cotação gravada. */
  quotesAsOf: IsoDate | null
  /** Cotação anterior ao último dia útil — o job das 18:30 não rodou. */
  quotesStale: boolean
  cdi: CdiComparison | null
  chart: ChartData | null
  dividendChart: DividendChartData | null
}

export function DashboardPage(props: DashboardPageProps) {
  const { groups, hasUsd, usdRate, quotesAsOf, quotesStale, chart, dividendChart } = props

  return (
    <Layout title="Dashboard — Carteira" path="/portfolio/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-speedometer2" /> Dashboard
          </h2>
          <div class="d-flex align-items-center gap-3">
            {quotesAsOf !== null && <QuotesDate asOf={quotesAsOf} stale={quotesStale} />}
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm"
              hx-post="/portfolio/update-prices"
              hx-swap="none"
              data-busy-label="Atualizando..."
              data-reload-on-success
            >
              <i class="bi bi-arrow-clockwise me-1" /> Atualizar Cotações
            </button>
          </div>
        </div>

        {hasUsd && (
          <div class="alert alert-info alert-sm py-2 px-3 mb-3 small">
            <i class="bi bi-currency-exchange me-1" />
            Totais em <strong>BRL</strong>. Ativos em USD convertidos pela última cotação do dólar.
            {usdRate !== null && (
              <span class="ms-2 text-muted">USD/BRL: R$ {decimal(usdRate, 4)}</span>
            )}
          </div>
        )}

        <SummaryCards {...props} />

        <CdiComparisonCards cdi={props.cdi} />

        {chart !== null ? (
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-header bg-white">
              <span class="fw-semibold">
                <i class="bi bi-graph-up" /> Evolução Patrimonial
              </span>
            </div>
            <div class="card-body">
              <canvas id="evolutionChart" height={100} />
            </div>
          </div>
        ) : (
          <EvolutionPlaceholder />
        )}

        {dividendChart !== null && (
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-header bg-white">
              <span class="fw-semibold">
                <i class="bi bi-bar-chart-line" /> Proventos por Mês
              </span>
            </div>
            <div class="card-body">
              <canvas id="dividendsChart" height={100} />
            </div>
          </div>
        )}

        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white">
            <span class="fw-semibold">Posições</span>
          </div>
          <div class="card-body border-bottom py-2">
            <div class="row g-2 align-items-center">
              <div class="col-auto">
                <select id="filterClass" class="form-select form-select-sm">
                  <option value="">Classe: Todas</option>
                  {groups.map((g) => (
                    <option value={g.key}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div class="col-auto">
                <div class="form-check form-check-inline mb-0">
                  <input id="filterPosition" type="checkbox" class="form-check-input" checked />
                  <label class="form-check-label small" for="filterPosition">
                    Apenas com posição
                  </label>
                </div>
              </div>
              <div class="col-auto">
                <div class="form-check form-check-inline mb-0">
                  <input id="toggleColumns" type="checkbox" class="form-check-input" />
                  <label
                    class="form-check-label small"
                    for="toggleColumns"
                    title="Mostra Moeda e TIR/mês"
                  >
                    Colunas extras
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div class="card-body p-0">
            {groups.length > 0 ? (
              <PositionsTable {...props} />
            ) : (
              <div class="text-center py-5 text-muted">
                <i class="bi bi-inbox fs-1" />
                <p class="mt-2">Nenhuma posição encontrada.</p>
                <a href="/assets/" class="btn btn-primary">
                  Cadastrar Ativo
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {chart !== null && (
        <div
          id="evolution-data"
          hidden
          data-labels={JSON.stringify(chart.labels)}
          data-datasets={JSON.stringify(chart.datasets)}
          data-invested={JSON.stringify(chart.invested)}
          data-net-contribution={JSON.stringify(chart.netContribution)}
          data-ibov={JSON.stringify(chart.ibov)}
          data-cdi={JSON.stringify(chart.cdi)}
        />
      )}
      {dividendChart !== null && (
        <div
          id="dividends-data"
          hidden
          data-dividend-labels={JSON.stringify(dividendChart.labels)}
          data-dividend-datasets={JSON.stringify(dividendChart.datasets)}
          data-dividend-moving-average={JSON.stringify(dividendChart.movingAverage)}
        />
      )}
      <script src="/js/dashboard.js" defer />
    </Layout>
  )
}

/**
 * Sem snapshot mensal o gráfico simplesmente não existia, e nada apontava para o botão na
 * tela de Evolução. O card vazio diz o que falta e resolve ali mesmo.
 */
function EvolutionPlaceholder() {
  return (
    <div class="card border-0 shadow-sm mb-4">
      <div class="card-body text-center py-4 text-muted">
        <i class="bi bi-graph-up fs-1" />
        <p class="mt-2 mb-1">O gráfico de evolução aparece depois do primeiro recálculo mensal.</p>
        <p class="small mb-3">Leva cerca de um minuto e a página recarrega sozinha.</p>
        <RecalculateEvolutionButton class="btn btn-primary btn-sm" />
      </div>
    </div>
  )
}

function SummaryCards({
  hasUsd,
  netContribution,
  totalInvested,
  realizedPnl,
  currentValue,
  unrealizedPnl,
  dividendPnl,
}: DashboardPageProps) {
  const brlSuffix = hasUsd ? <span class="text-info"> (BRL)</span> : null

  return (
    <div class="row g-3 mb-4">
      <Card
        label={
          <>
            Aporte Líquido{brlSuffix}
            <i
              class="bi bi-info-circle ms-1"
              title="Dinheiro novo que saiu do bolso. Proventos e vendas reaplicados na carteira não contam como aporte."
            />
          </>
        }
        value={money(netContribution)}
      />
      <Card label={<>Total Investido{brlSuffix}</>} value={money(totalInvested)} />
      <Card
        label={<>Lucro Realizado{brlSuffix}</>}
        value={money(realizedPnl)}
        valueClass={realizedPnl >= 0 ? 'text-success' : 'text-danger'}
      />
      <Card
        label={<>Valor de Mercado{brlSuffix}</>}
        value={currentValue === null ? null : money(currentValue)}
      />
      <Card
        label={<>Lucro Não Realizado{brlSuffix}</>}
        value={unrealizedPnl === null ? null : money(unrealizedPnl)}
        valueClass={
          unrealizedPnl === null ? '' : unrealizedPnl >= 0 ? 'text-success' : 'text-danger'
        }
      />
      <Card
        label={
          <>
            <i class="bi bi-cash-coin me-1" />
            Proventos Recebidos
          </>
        }
        value={money(dividendPnl)}
        valueClass="text-success"
      />
    </div>
  )
}

const CDI_HELP =
  'Os mesmos aportes, nas mesmas datas, rendendo CDI. Comparar assim — e não a TIR contra ' +
  'o CDI nominal do período — é o que neutraliza a irregularidade dos aportes: o cronograma ' +
  'é idêntico dos dois lados, então a diferença que sobra é escolha de ativo, não de timing.'

/**
 * A carteira contra a sombra no CDI, em dinheiro. As duas TIR ficam no rodapé da tabela,
 * lado a lado — repeti-las aqui só dividiria a atenção.
 *
 * Some inteira sem série gravada ou sem valor de mercado — meio número aqui seria pior que
 * nenhum. A data da última taxa fica visível de propósito: série defasada rende menos e
 * faz a carteira parecer melhor do que é.
 */
function CdiComparisonCards({ cdi }: { cdi: CdiComparison | null }) {
  if (cdi === null) return null

  const ahead = cdi.difference >= 0

  return (
    <div class="row g-3 mb-4">
      <Card
        label={
          <>
            Se fosse CDI
            <i class="bi bi-info-circle ms-1" title={CDI_HELP} />
          </>
        }
        value={money(cdi.cdiValue)}
      />
      <Card
        label={ahead ? 'Acima do CDI' : 'Abaixo do CDI'}
        value={money(Math.abs(cdi.difference))}
        valueClass={ahead ? 'text-success' : 'text-danger'}
      />
      <Card
        label={<>% do CDI</>}
        value={cdi.ratioOfCdi === null ? null : percent(cdi.ratioOfCdi)}
        valueClass={ahead ? 'text-success' : 'text-danger'}
      />
      {cdi.lastRateDate !== null && (
        <div class="col-12">
          <div class="text-muted small">
            <i class="bi bi-info-circle me-1" />
            Série do CDI até <strong>{fmtDate(cdi.lastRateDate)}</strong> — depois dessa data a
            simulação não rende.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * De quando são as cotações da tela. A tela não busca nada: a de ontem é o normal, e o
 * vermelho só aparece quando a atualização das 18:30 deixou de rodar.
 */
function QuotesDate({ asOf, stale }: { asOf: IsoDate; stale: boolean }) {
  if (!stale) {
    return <span class="text-muted small">Cotações de {fmtDate(asOf)}</span>
  }
  return (
    <span
      class="text-danger fw-semibold small"
      title="A cotação mais recente é anterior ao último dia útil. Clique em Atualizar Cotações."
    >
      <i class="bi bi-exclamation-triangle-fill me-1" />
      Cotações de {fmtDate(asOf)}
    </span>
  )
}

function Card({
  label,
  value,
  valueClass = '',
}: {
  label: preact.ComponentChildren
  value: string | null
  valueClass?: string
}) {
  return (
    <div class="col-6 col-xl">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body">
          <div class="text-muted small mb-1">{label}</div>
          <div class={`num fs-4 fw-bold ${value === null ? 'text-muted' : valueClass}`}>
            {value ?? '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

/** `secondary` começa escondida — ver `.col-secondary` em custom.css. */
const COLUMNS = [
  { label: 'Ticker', sort: 'text', align: '' },
  { label: 'Tipo', sort: 'text', align: '' },
  { label: 'Moeda', sort: 'text', align: 'col-secondary' },
  { label: 'Qtd', sort: 'num', align: 'text-end' },
  { label: 'Preço Médio', sort: 'num', align: 'text-end' },
  { label: 'Cotação', sort: 'num', align: 'text-end' },
  { label: 'Custo Total', sort: 'num', align: 'text-end' },
  { label: 'Valor Atual', sort: 'num', align: 'text-end' },
  { label: 'Lucro Não Real.', sort: 'num', align: 'text-end' },
  { label: 'Proventos', sort: 'num', align: 'text-end' },
  { label: 'Lucro Realizado', sort: 'num', align: 'text-end' },
  { label: 'TIR/mês', sort: 'num', align: 'text-end col-secondary' },
  { label: 'TIR/ano', sort: 'num', align: 'text-end' },
] as const

function PositionsTable(props: DashboardPageProps) {
  return (
    <div class="table-responsive table-sticky-wrap">
      <table
        id="positionsTable"
        class="table table-hover mb-0 align-middle positions-table table-sticky"
      >
        <thead class="table-light">
          <tr>
            {COLUMNS.map((col) => (
              <th class={col.align} data-sort={col.sort}>
                {col.label}
                <span class="sort-arrow" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.groups.map((group) => (
            <>
              {group.positions.map((p) => (
                <PositionRow position={p} classKey={group.key} />
              ))}
              <SubtotalRow group={group} />
            </>
          ))}
        </tbody>
        <TotalsRow {...props} />
      </table>
    </div>
  )
}

/**
 * Subtotal de uma classe: o que a carteira tem em renda variável, em renda fixa, lá fora. É
 * a pergunta que a tabela agrupada por classe já sugere e obrigava a somar de cabeça.
 *
 * `data-class` deixa o filtro de classe esconder e mostrar a linha junto com o grupo, e
 * `data-subtotal` deixa a ordenação por coluna tirá-la do caminho — subtotal no meio de
 * uma lista ordenada por TIR não faz sentido.
 */
function SubtotalRow({ group }: { group: ClassGroup }) {
  const { summary: s, key, name } = group
  const count = group.positions.length
  return (
    <tr data-subtotal data-class={key} class="small">
      <td colSpan={2}>
        Subtotal {name}{' '}
        <span class="text-muted fw-normal">
          · {count} {count === 1 ? 'ativo' : 'ativos'}
        </span>
      </td>
      <td class="col-secondary" />
      <td colSpan={3} />
      <td class="text-end">{money(s.totalInvested)}</td>
      <td class="text-end">{s.currentValue === null ? '—' : money(s.currentValue)}</td>
      <td class={`text-end ${s.unrealizedPnl === null ? '' : signClass(s.unrealizedPnl)}`}>
        {s.unrealizedPnl === null ? (
          '—'
        ) : (
          <>
            {money(s.unrealizedPnl)}
            {s.totalInvested !== 0 && (
              <small class="ms-1">({percent(s.unrealizedPnl / s.totalInvested, 0)})</small>
            )}
          </>
        )}
      </td>
      <td class="text-end text-success">{s.dividendPnl > 0 ? money(s.dividendPnl) : '—'}</td>
      <td class={`text-end ${signClass(s.realizedPnl)}`}>{money(s.realizedPnl)}</td>
      <td class={`text-end col-secondary ${s.irrMonthly === null ? '' : signClass(s.irrMonthly)}`}>
        {s.irrMonthly === null ? '—' : percent(s.irrMonthly)}
      </td>
      <td class={`text-end ${s.irrAnnual === null ? '' : signClass(s.irrAnnual)}`}>
        {s.irrAnnual === null ? '—' : percent(s.irrAnnual)}
      </td>
    </tr>
  )
}

function PositionRow({ position: p, classKey }: { position: AssetPosition; classKey: string }) {
  const hasQuantity = p.quantity > 0
  const converted = p.exchangeRate !== null

  /** Valor na moeda do ativo, com o equivalente em reais embaixo quando houver conversão. */
  const dual = (value: number | null, valueBrl: number | null) =>
    value === null ? (
      '—'
    ) : (
      <>
        {money(value, p.currency)}
        {converted && valueBrl !== null && (
          <>
            <br />
            <small class="text-muted">≈ {money(valueBrl)}</small>
          </>
        )}
      </>
    )

  return (
    <tr data-class={classKey} data-quantity={String(p.quantity)}>
      <td>
        {/* O nome vai no title, não no corpo da célula: além de encher a tabela, ele entrava
            no `textContent` que a ordenação lê, e "PETR4" comparava como "PETR4Petrobras PN". */}
        <a
          href={`/assets/${p.ticker}`}
          class="fw-bold text-decoration-none"
          title={p.name ?? undefined}
        >
          {p.ticker}
        </a>
        {p.delisted && (
          <i
            class="bi bi-x-circle text-secondary ms-1"
            title="Deslistado"
            style="font-size: 0.8em"
          />
        )}
      </td>
      <td>
        <AssetBadge type={p.type} />
      </td>
      <td class="col-secondary">
        <span class="badge bg-light text-dark border">{p.currency}</span>
      </td>
      <td class="text-end">{hasQuantity ? quantity(p.quantity) : '—'}</td>
      <td class="text-end">{hasQuantity ? dual(p.avgPrice, p.avgPriceBrl) : '—'}</td>
      <td class="text-end">
        {hasQuantity && p.currentPrice !== null ? dual(p.currentPrice, p.currentPriceBrl) : '—'}
      </td>
      <td class="text-end">{hasQuantity ? dual(p.totalCost, p.totalCostBrl) : '—'}</td>
      <td class="text-end">
        {hasQuantity && p.currentValue !== null ? dual(p.currentValue, p.currentValueBrl) : '—'}
      </td>
      <td class={`text-end ${p.unrealizedPnl === null ? '' : signClass(p.unrealizedPnl)}`}>
        {p.unrealizedPnl !== null && hasQuantity ? (
          <>
            {money(p.unrealizedPnl, p.currency)}
            {p.totalCost !== 0 && (
              <small class="ms-1">({percent(p.unrealizedPnl / p.totalCost, 0)})</small>
            )}
            {converted && p.unrealizedPnlBrl !== null && (
              <>
                <br />
                <small class="text-muted">≈ {money(p.unrealizedPnlBrl)}</small>
              </>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
      <td class="text-end text-success">{p.dividendPnl > 0 ? money(p.dividendPnl) : '—'}</td>
      <td class={`text-end ${signClass(p.realizedPnl)}`}>
        {money(p.realizedPnl, p.currency)}
        {converted && (
          <>
            <br />
            <small class={`text-muted ${signClass(p.realizedPnlBrl)}`}>
              ≈ {money(p.realizedPnlBrl)}
            </small>
          </>
        )}
      </td>
      <td class={`text-end col-secondary ${p.irrMonthly === null ? '' : signClass(p.irrMonthly)}`}>
        {p.irrMonthly === null ? '—' : percent(p.irrMonthly)}
      </td>
      <td class={`text-end ${p.irrAnnual === null ? '' : signClass(p.irrAnnual)}`}>
        {p.irrAnnual === null ? '—' : percent(p.irrAnnual)}
      </td>
    </tr>
  )
}

function TotalsRow({
  totalInvested,
  currentValue,
  unrealizedPnl,
  dividendPnl,
  realizedPnl,
  irrMonthly,
  irrAnnual,
  cdi,
}: DashboardPageProps) {
  return (
    <tfoot class="table-light fw-bold">
      <tr>
        {/* Célula própria para a Moeda: `colSpan={6}` desalinharia tudo com a coluna oculta. */}
        <td colSpan={2}>Total</td>
        <td class="col-secondary" />
        <td colSpan={3} />
        <td class="text-end">{money(totalInvested)}</td>
        <td class="text-end">{currentValue === null ? '—' : money(currentValue)}</td>
        <td class={`text-end ${unrealizedPnl === null ? '' : signClass(unrealizedPnl)}`}>
          {unrealizedPnl === null ? (
            '—'
          ) : (
            <>
              {money(unrealizedPnl)}
              {totalInvested !== 0 && (
                <small class="ms-1">({percent(unrealizedPnl / totalInvested, 0)})</small>
              )}
            </>
          )}
        </td>
        <td class="text-end text-success">{dividendPnl > 0 ? money(dividendPnl) : '—'}</td>
        <td class={`text-end ${signClass(realizedPnl)}`}>{money(realizedPnl)}</td>
        <td class={`text-end col-secondary ${irrMonthly === null ? '' : signClass(irrMonthly)}`}>
          {irrMonthly === null ? '—' : percent(irrMonthly)}
        </td>
        <td class={`text-end ${irrAnnual === null ? '' : signClass(irrAnnual)}`}>
          {irrAnnual === null ? '—' : percent(irrAnnual)}
        </td>
      </tr>
      <CdiTotalsRow cdi={cdi} />
    </tfoot>
  )
}

/**
 * A sombra do CDI logo abaixo do total, para a TIR das duas ficar lado a lado.
 *
 * Só valor e TIR: custo, provento e lucro realizado não têm equivalente numa conta que só
 * rende juro, e preencher essas células com o número da carteira sugeriria uma equivalência
 * que não existe.
 */
function CdiTotalsRow({ cdi }: { cdi: CdiComparison | null }) {
  if (cdi === null) return null

  return (
    <tr class="fw-normal text-muted">
      <td colSpan={2}>
        <i class="bi bi-arrow-return-right me-1" />
        Se fosse CDI
      </td>
      <td class="col-secondary" />
      <td colSpan={4} />
      <td class="text-end">{money(cdi.cdiValue)}</td>
      <td colSpan={3} />
      <td class="text-end col-secondary">
        {cdi.cdiIrrMonthly === null ? '—' : percent(cdi.cdiIrrMonthly)}
      </td>
      <td class="text-end">{cdi.cdiIrrAnnual === null ? '—' : percent(cdi.cdiIrrAnnual)}</td>
    </tr>
  )
}
