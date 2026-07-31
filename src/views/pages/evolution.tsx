import type {
  MonthlyEvolutionRow,
  MonthlySnapshotView,
} from '../../modules/evolution/evolution.schema.js'
import { decimal, money, monthLabel, quantity, signClass } from '../../shared/format.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/evolution.html. */

export type EvolutionPageProps = {
  months: MonthlyEvolutionRow[]
  tickers: string[]
}

export function EvolutionPage({ months, tickers }: EvolutionPageProps) {
  return (
    <Layout title="Evolução — Carteira" path="/evolution/">
      <div class="container-fluid py-4 px-4">
        <h2 class="mb-4">
          <i class="bi bi-graph-up" /> Evolução Patrimonial
        </h2>

        <div class="mb-3">
          <form method="post" action="/evolution/recalculate" class="d-inline">
            <button type="submit" class="btn btn-primary">
              <i class="bi bi-arrow-clockwise" /> Recalcular
            </button>
          </form>
        </div>

        {months.length === 0 ? (
          <div class="card border-0 shadow-sm">
            <div class="card-body text-center py-5 text-muted">
              <i class="bi bi-inbox fs-1" />
              <p class="mt-2">Nenhum dado de evolução encontrado.</p>
              <p class="small">Clique em "Recalcular" para gerar os snapshots mensais.</p>
            </div>
          </div>
        ) : (
          <div class="card border-0 shadow-sm">
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
                    {months.map((row) => (
                      <MonthRow row={row} tickers={tickers} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
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

export { decimal, signClass }
