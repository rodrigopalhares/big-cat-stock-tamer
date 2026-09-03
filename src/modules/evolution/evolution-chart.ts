import type { Container } from '../../container.js'
import { buildCdiChartLine } from '../../domain/cdi.js'
import { buildIbovChartLine, buildNetContributionChartLine } from '../../domain/chart.js'
import { monthLabel } from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import type { ChartData } from '../../views/pages/dashboard.js'
import type { AssetPosition } from '../portfolio/portfolio.schema.js'
import type { MonthlyEvolutionSummary } from './evolution.schema.js'

/**
 * Dados do gráfico de evolução: uma série por tipo de ativo, mais as linhas de referência.
 * Null quando não há snapshot nenhum — aí a página nem desenha o gráfico.
 *
 * Era função privada da rota do dashboard. Saiu de lá quando a página de Evolução passou a
 * mostrar o mesmo gráfico em cima da tabela — dois gráficos com a mesma pergunta têm que
 * sair da mesma conta.
 */
export async function buildEvolutionChart(
  c: Container,
  positions: readonly AssetPosition[],
  evolution: MonthlyEvolutionSummary,
): Promise<ChartData | null> {
  if (evolution.months.length === 0) return null

  const assets = await c.db.asset.findMany({ select: { ticker: true, type: true } })
  const typeByTicker = new Map(assets.map((a) => [a.ticker, a.type ?? 'STOCK']))
  const types = [...new Set(typeByTicker.values())].sort()

  const invested = evolution.months.map((row) => row.totalInvested)
  const months = evolution.months.map((row) => row.month)

  const ibovPrices = await c.benchmarks.getMonthlyPricesMap()

  return {
    labels: months.map((month) => monthLabel(month)),
    datasets: types.map((type) => ({
      label: type,
      data: evolution.months.map((row) =>
        row.snapshots
          .filter((s) => typeByTicker.get(s.assetId) === type)
          .reduce((total, s) => total + s.marketValue, 0),
      ),
    })),
    invested,
    // Os fluxos da carteira inteira em ordem, como no card: provento de um papel pagando a
    // compra de outro só aparece com eles juntos.
    netContribution: buildNetContributionChartLine(
      months as IsoDate[],
      positions.flatMap((p) => p.allCashFlowsBrl),
    ),
    ibov: buildIbovChartLine(months as IsoDate[], invested, ibovPrices),
    cdi: buildCdiChartLine(
      months as IsoDate[],
      positions.flatMap((p) => p.allCashFlowsBrl),
      await c.cdi.getRates(),
    ),
  }
}
