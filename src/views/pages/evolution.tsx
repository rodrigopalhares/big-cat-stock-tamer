import type {
  MonthlyEvolutionRow,
  MonthlySnapshotView,
} from '../../modules/evolution/evolution.schema.js'
import { money, monthLabel, quantity } from '../../shared/format.js'
import { LoadMoreRow } from '../components/load-more-row.js'
import { Layout } from '../layout.js'
import type { ChartData } from './dashboard.js'

/**
 * Porte de src/main/resources/templates/evolution.html.
 *
 * Do mês mais recente para o mais antigo, em páginas de rolagem infinita: a tabela tinha 18
 * anos de linhas em ordem crescente, e o mês atual ficava 200 linhas abaixo. As colunas são
 * só dos ativos com posição hoje — papel vendido há anos continua nos totais, mas não ganha
 * uma coluna de traços. O gráfico é o mesmo do dashboard, em cima da tabela.
 */

export type EvolutionPageProps = {
  /** Primeira página, do mês mais recente para o mais antigo. */
  months: MonthlyEvolutionRow[]
  /** Ativos com posição no último mês — as colunas da tabela. */
  tickers: string[]
  /** Quantos meses existem no total. */
  total: number
  /** URL da próxima página; null quando tudo já está na tela. */
  nextUrl: string | null
  chart: ChartData | null
}

export function EvolutionPage({ months, tickers, total, nextUrl, chart }: EvolutionPageProps) {
  return (
    <Layout title="Evolução — Carteira" path="/evolution/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-graph-up" /> Evolução Patrimonial
          </h2>
          <form method="post" action="/evolution/recalculate" class="d-inline">
            <button type="submit" class="btn btn-outline-secondary btn-sm">
              <i class="bi bi-arrow-clockwise me-1" /> Recalcular
            </button>
          </form>
        </div>

        {chart !== null && (
          <div class="card border-0 shadow-sm mb-4">
            <div class="card-body">
              <canvas id="evolutionChart" height={100} />
            </div>
          </div>
        )}

        {total === 0 ? (
          <div class="card border-0 shadow-sm">
            <div class="card-body text-center py-5 text-muted">
              <i class="bi bi-inbox fs-1" />
              <p class="mt-2">Nenhum dado de evolução encontrado.</p>
              <p class="small">Clique em "Recalcular" para gerar os snapshots mensais.</p>
            </div>
          </div>
        ) : (
          <div class="card border-0 shadow-sm">
            <div class="card-header bg-white">
              <span class="fw-semibold">
                Mês a mês <span class="badge bg-secondary ms-1">{total}</span>
              </span>
            </div>
            <div class="card-body p-0">
              <div class="table-responsive">
                <table class="table table-hover table-sm mb-0 align-middle">
                  <thead class="table-light">
                    <tr>
                      <th>Mês</th>
                      <th class="text-end">Total Investido</th>
                      <th class="text-end">Valor de Mercado</th>
                      <th class="text-end">Resultado</th>
                      <th class="text-end">Dividendos no Mês</th>
                      <th class="text-end">Dividendos Acumulados</th>
                      {tickers.map((ticker) => (
                        <th class="text-end">{ticker}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <EvolutionRows months={months} tickers={tickers} nextUrl={nextUrl} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
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
      {/* O mesmo script do dashboard: ele só desenha o que encontra na página. */}
      <script src="/js/dashboard.js" defer />
    </Layout>
  )
}

/** As linhas de uma página mais a sentinela da seguinte — o que `/evolution/rows` devolve. */
export function EvolutionRows({
  months,
  tickers,
  nextUrl,
}: {
  months: MonthlyEvolutionRow[]
  tickers: string[]
  nextUrl: string | null
}) {
  return (
    <>
      {months.map((row) => (
        <MonthRow row={row} tickers={tickers} />
      ))}
      {nextUrl !== null && <LoadMoreRow href={nextUrl} colSpan={6 + tickers.length} />}
    </>
  )
}

function MonthRow({ row, tickers }: { row: MonthlyEvolutionRow; tickers: string[] }) {
  const result = row.totalMarketValue - row.totalInvested
  const byTicker = new Map<string, MonthlySnapshotView>(
    row.snapshots.map((snapshot) => [snapshot.assetId, snapshot]),
  )

  return (
    <tr>
      <td>{monthLabel(row.month)}</td>
      <td class="text-end">{money(row.totalInvested)}</td>
      <td class="text-end">{money(row.totalMarketValue)}</td>
      <td class={`text-end ${result >= 0 ? 'text-success' : 'text-danger'}`}>{money(result)}</td>
      <td class="text-end">{money(row.totalMonthlyNetDividends)}</td>
      <td class="text-end">{money(row.totalAccumulatedNetDividends)}</td>
      {tickers.map((ticker) => {
        const snapshot = byTicker.get(ticker)
        return (
          <td class="text-end">
            {snapshot === undefined ? (
              <span class="text-muted">—</span>
            ) : (
              <>
                <span class="num">{money(snapshot.marketValue)}</span>
                <br />
                <small class="text-muted">
                  <span class="num">
                    {quantity(snapshot.quantity)} × {money(snapshot.marketPrice)}
                  </span>
                </small>
              </>
            )}
          </td>
        )
      })}
    </tr>
  )
}
