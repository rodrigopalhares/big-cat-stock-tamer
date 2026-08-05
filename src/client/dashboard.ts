/**
 * Gráficos do dashboard (evolução patrimonial e proventos por mês) e ordenação/filtro da
 * tabela de posições. Porte de static/js/dashboard.js e static/js/dashboard-table.js.
 *
 * O Chart.js vem da CDN como global; só o que este arquivo usa é declarado.
 */

import { assetTypeColor, assetTypeFill } from '../shared/asset-colors.js'

type ChartDataset = Record<string, unknown>
declare const Chart: new (el: Element, config: Record<string, unknown>) => unknown

/** Lê um `data-*` que a view entrega como JSON. */
function parse<T>(raw: string | undefined, fallback: T): T {
  return raw === undefined || raw === '' ? fallback : (JSON.parse(raw) as T)
}

/**
 * Eixo das linhas de referência, separado do das áreas.
 *
 * Existe para elas não entrarem no empilhamento, e é o mesmo critério que tira essas linhas
 * do total do tooltip: o que empilha é o que soma.
 */
const REFERENCE_AXIS = 'yReference'

/** Linha tracejada sobreposta às áreas — referência, não composição do patrimônio. */
function referenceLine(label: string, data: Array<number | null>, color: string): ChartDataset {
  return {
    label,
    data,
    fill: false,
    backgroundColor: 'transparent',
    borderColor: color,
    borderWidth: 2,
    borderDash: [6, 3],
    pointRadius: 0,
    pointHitRadius: 10,
    order: 1,
    yAxisID: REFERENCE_AXIS,
  }
}

/**
 * Menor e maior valor entre as linhas de referência, ignorando os buracos (`null`).
 *
 * Null quando não há nenhuma — aí o eixo fica com o dimensionamento natural das áreas.
 * Lê do próprio `datasets` em vez das séries soltas para uma linha nova entrar na conta
 * sozinha, sem depender de alguém lembrar de somá-la aqui.
 */
function boundsOf(datasets: readonly ChartDataset[]): { min: number; max: number } | null {
  const values = datasets
    .filter((ds) => ds['yAxisID'] === REFERENCE_AXIS)
    .flatMap((ds) => (ds['data'] as Array<number | null>) ?? [])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

  return values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values) }
}

const brl = (value: number, digits = 0) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

document.addEventListener('DOMContentLoaded', () => {
  buildChart()
  buildDividendsChart()
  wireTable()
})

function buildChart(): void {
  const dataEl = document.getElementById('evolution-data')
  const canvas = document.getElementById('evolutionChart')
  if (dataEl === null || canvas === null) return

  const labels = parse<string[]>(dataEl.dataset['labels'], [])
  const rawDatasets = parse<Array<{ label: string; data: number[] }>>(
    dataEl.dataset['datasets'],
    [],
  )
  const invested = parse<number[]>(dataEl.dataset['invested'], [])
  const netContribution = parse<number[]>(dataEl.dataset['netContribution'], [])
  const ibov = parse<Array<number | null>>(dataEl.dataset['ibov'], [])
  const cdi = parse<Array<number | null>>(dataEl.dataset['cdi'], [])

  const datasets: ChartDataset[] = rawDatasets.map((ds) => ({
    label: ds.label,
    data: ds.data,
    fill: true,
    backgroundColor: assetTypeFill(ds.label),
    borderColor: assetTypeColor(ds.label),
    borderWidth: 1,
    pointRadius: 0,
    pointHitRadius: 10,
    order: 2,
  }))

  datasets.push(referenceLine('Total Investido', invested, 'rgb(220, 53, 69)'))
  // Carteira que nunca reaplicou nada tem o aporte colado no total investido; a linha só
  // agrega quando as duas se separam, mas escondê-la deixaria a legenda inconstante.
  datasets.push(referenceLine('Aporte Líquido', netContribution, 'rgb(255, 193, 7)'))
  if (ibov.some((v) => v !== null))
    datasets.push(referenceLine('IBOVESPA', ibov, 'rgb(40, 167, 69)'))
  // Mesmos aportes rendendo CDI. Não é a mesma pergunta da linha do IBOVESPA, que projeta
  // o investido inicial pelo índice e portanto supõe aporte único no começo.
  if (cdi.some((v) => v !== null)) datasets.push(referenceLine('CDI', cdi, 'rgb(13, 110, 253)'))

  // O eixo das áreas é dimensionado só pelo patrimônio empilhado, e o das referências
  // copia o dele. Uma linha que passe do topo da carteira sai cortada — o CDI passa
  // quando a carteira está atrás dele, e "Total Investido" passa quando ela está no
  // prejuízo. Daí esticar o eixo para caber a maior das referências.
  const referenceBounds = boundsOf(datasets)

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: {
          stacked: true,
          position: 'right',
          // `suggested*` e não `min`/`max`: só estica o eixo, nunca encolhe abaixo do que
          // as áreas precisam.
          suggestedMax: referenceBounds?.max,
          suggestedMin: referenceBounds === null ? undefined : Math.min(0, referenceBounds.min),
          ticks: { callback: (v: number) => brl(v) },
        },
        // Eixo invisível para as linhas de referência não entrarem no empilhamento,
        // mas ainda compartilharem a escala das áreas.
        [REFERENCE_AXIS]: {
          display: false,
          stacked: false,
          afterBuildTicks: (axis: {
            chart: { scales: { y: { min: number; max: number } } }
            min: number
            max: number
          }) => {
            axis.min = axis.chart.scales.y.min
            axis.max = axis.chart.scales.y.max
          },
        },
      },
      plugins: {
        tooltip: {
          bodyAlign: 'right',
          callbacks: {
            label: (ctx: { dataset: { label: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${brl(ctx.parsed.y)}`,
            // Só as áreas: o total é o valor de mercado da carteira naquele mês. Somar as
            // referências junto dava um número que não existe — investido e benchmark são
            // outra pergunta, não parcela do patrimônio.
            afterBody: (items: Array<{ dataset: { yAxisID?: string }; parsed: { y: number } }>) => [
              `\nTotal: ${brl(
                items
                  .filter((item) => item.dataset.yAxisID !== REFERENCE_AXIS)
                  .reduce((sum, item) => sum + item.parsed.y, 0),
              )}`,
            ],
          },
        },
        legend: { position: 'bottom' },
      },
    },
  })
}

/** Proventos mês a mês, empilhados por tipo de ativo, com a média móvel de 12 meses. */
function buildDividendsChart(): void {
  const dataEl = document.getElementById('dividends-data')
  const canvas = document.getElementById('dividendsChart')
  if (dataEl === null || canvas === null) return

  const labels = parse<string[]>(dataEl.dataset['dividendLabels'], [])
  const rawDatasets = parse<Array<{ label: string; data: number[] }>>(
    dataEl.dataset['dividendDatasets'],
    [],
  )
  const movingAverage = parse<number[]>(dataEl.dataset['dividendMovingAverage'], [])

  const datasets: ChartDataset[] = rawDatasets.map((ds) => ({
    label: ds.label,
    data: ds.data,
    backgroundColor: assetTypeFill(ds.label),
    borderColor: assetTypeColor(ds.label),
    borderWidth: 1,
  }))

  // Média toda zerada é carteira que nunca recebeu nada: a linha não diria nada.
  if (movingAverage.some((value) => value > 0)) {
    datasets.push({
      type: 'line',
      label: 'Média móvel 12 meses',
      data: movingAverage,
      borderColor: 'rgb(220, 53, 69)',
      borderWidth: 2,
      borderDash: [6, 3],
      pointRadius: 0,
      pointHitRadius: 10,
      fill: false,
      yAxisID: 'yAverage',
    })
  }

  new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          position: 'right',
          ticks: { callback: (v: number) => brl(v) },
        },
        // Mesmo truque do gráfico de evolução: eixo invisível para a linha não entrar no
        // empilhamento das barras, mas ainda compartilhar a escala delas.
        yAverage: {
          display: false,
          stacked: false,
          afterBuildTicks: (axis: {
            chart: { scales: { y: { min: number; max: number } } }
            min: number
            max: number
          }) => {
            axis.min = axis.chart.scales.y.min
            axis.max = axis.chart.scales.y.max
          },
        },
      },
      plugins: {
        tooltip: {
          bodyAlign: 'right',
          // A maioria dos meses só tem um ou dois tipos; os zerados só poluiriam.
          filter: (item: { parsed: { y: number } }) => item.parsed.y !== 0,
          callbacks: {
            label: (ctx: { dataset: { label: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${brl(ctx.parsed.y, 2)}`,
            // A média é referência, não parcela: somá-la inflaria o total do mês.
            afterBody: (items: Array<{ dataset: { type?: string }; parsed: { y: number } }>) => [
              `\nTotal: ${brl(
                items
                  .filter((item) => item.dataset.type !== 'line')
                  .reduce((sum, item) => sum + item.parsed.y, 0),
                2,
              )}`,
            ],
          },
        },
        legend: { position: 'bottom' },
      },
    },
  })
}

function wireTable(): void {
  const table = document.getElementById('positionsTable')
  const filterType = document.getElementById('filterType')
  const filterPosition = document.getElementById('filterPosition')
  if (
    !(table instanceof HTMLTableElement) ||
    !(filterType instanceof HTMLSelectElement) ||
    !(filterPosition instanceof HTMLInputElement)
  ) {
    return
  }

  const tbody = table.tBodies[0]
  const thead = table.tHead
  if (tbody === undefined || thead === null) return

  const applyFilter = (): void => {
    for (const row of Array.from(tbody.rows)) {
      const matchesType = filterType.value === '' || row.dataset['type'] === filterType.value
      const hasPosition = Number(row.dataset['quantity'] ?? '0') > 0
      row.style.display = matchesType && (!filterPosition.checked || hasPosition) ? '' : 'none'
    }
  }

  filterType.addEventListener('change', applyFilter)
  filterPosition.addEventListener('change', applyFilter)
  applyFilter()

  const headers = Array.from(thead.querySelectorAll<HTMLTableCellElement>('th[data-sort]'))
  let currentSort = { column: -1, ascending: true }

  for (const th of headers) {
    th.style.cursor = 'pointer'
    th.style.userSelect = 'none'
    th.addEventListener('click', () => {
      const column = th.cellIndex
      const ascending = currentSort.column === column ? !currentSort.ascending : true
      currentSort = { column, ascending }

      for (const header of headers) {
        const arrow = header.querySelector('.sort-arrow')
        if (arrow !== null) arrow.textContent = ''
      }
      const arrow = th.querySelector('.sort-arrow')
      if (arrow !== null) arrow.textContent = ascending ? ' ↑' : ' ↓'

      const numeric = th.dataset['sort'] === 'num'
      const rows = Array.from(tbody.rows).sort((a, b) => {
        const aValue = cellValue(a, column, numeric)
        const bValue = cellValue(b, column, numeric)
        if (numeric) {
          return ascending
            ? (aValue as number) - (bValue as number)
            : (bValue as number) - (aValue as number)
        }
        return ascending
          ? String(aValue).localeCompare(String(bValue))
          : String(bValue).localeCompare(String(aValue))
      })
      for (const row of rows) tbody.appendChild(row)
    })
  }
}

/** Lê o valor da célula para ordenação, desfazendo a formatação pt-BR. */
function cellValue(row: HTMLTableRowElement, column: number, numeric: boolean): number | string {
  const cell = row.cells[column]
  if (cell === undefined) return numeric ? 0 : ''

  const text = cell.textContent?.trim() ?? ''
  if (!numeric) return text

  const cleaned = text
    .replace(/[R$US$%\s≈—]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const value = Number.parseFloat(cleaned)
  // Célula sem número vai para o fim na ordem crescente.
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}
