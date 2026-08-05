import type { PositionFilter, RiskMetricsResult } from '../../modules/risk/risk-metrics.service.js'
import { decimal, date as fmtDate, percent } from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { AssetBadge } from '../components/badge.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/risk-metrics.html. */

const BETA_HELP =
  'Beta mede a sensibilidade do ativo em relação ao IBOVESPA. Beta = 1.0 significa que o ativo ' +
  'se move igual ao mercado. Beta > 1.0 indica maior volatilidade (ex: small caps). Beta < 1.0 ' +
  'indica menor volatilidade (ex: utilities). Beta negativo indica movimento contrário ao mercado.'

const ALPHA_HELP =
  'Alpha de Jensen mede o retorno anualizado acima (ou abaixo) do que o modelo CAPM prevê dado o ' +
  'risco (beta) do ativo. Alpha > 0% significa que o ativo superou o mercado ajustado ao risco. ' +
  'É calculado como o intercepto da regressão dos retornos excedentes (acima do CDI) do ativo ' +
  'contra os do IBOVESPA.'

const R2_HELP =
  'R² (coeficiente de determinação) indica quanto da variação dos retornos do ativo é explicada ' +
  'pelo movimento do IBOVESPA. R² = 1.0 significa correlação perfeita com o mercado. Valores ' +
  'acima de 0.5 indicam boa aderência ao modelo; abaixo disso, o beta e alpha podem ser pouco ' +
  'confiáveis.'

const UNRELIABLE_HELP = 'Menos de 12 meses de dados — resultado pode não ser confiável'

const TYPE_SHARE_HELP =
  'Quanto o valor atual da posição representa dentro do próprio tipo de ativo — o denominador ' +
  'é a soma de todos os ativos do tipo, inclusive os que o filtro esconde. Ativo sem posição ' +
  'fica com 0%.'

export type RiskMetricsPageProps = {
  metrics: RiskMetricsResult[]
  portfolioBeta: number | null
  cdiAnnual: number | null
  calculatedAt: IsoDate | null
  selectedPosition: PositionFilter
}

export function RiskMetricsPage({
  metrics,
  portfolioBeta,
  cdiAnnual,
  calculatedAt,
  selectedPosition,
}: RiskMetricsPageProps) {
  // Lista vazia com cálculo feito é o filtro escondendo tudo, não falta de dados.
  const hasCalculation = calculatedAt !== null
  const hasData = metrics.length > 0

  return (
    <Layout title="Risk Metrics — Carteira" path="/risk-metrics/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-shield-check" /> Risk Metrics
          </h2>
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            hx-post="/risk-metrics/recalculate"
            hx-swap="none"
            data-busy-label="Calculando..."
            data-reload-on-success
          >
            <i class="bi bi-arrow-clockwise me-1" /> Recalcular
          </button>
        </div>

        {hasCalculation && (
          <div class="row g-3 mb-4">
            <SummaryCard
              label="Beta da Carteira (ponderado)"
              value={portfolioBeta === null ? null : decimal(portfolioBeta)}
            />
            <SummaryCard
              label="CDI"
              value={cdiAnnual === null ? null : `${percent(cdiAnnual)} a.a.`}
            />
            <SummaryCard
              label="Ultima Atualização"
              value={calculatedAt === null ? null : fmtDate(calculatedAt)}
            />
          </div>
        )}

        <div class="alert alert-info py-2 px-3 mb-3 small">
          <i class="bi bi-info-circle me-1" />
          Benchmark: <strong>IBOVESPA</strong> · Retornos mensais · Janela de 5 anos · Apenas ativos{' '}
          <strong>STOCK</strong> e <strong>REIT</strong> · Ativos sem série suficiente para a
          regressão ficam de fora da lista
        </div>

        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white d-flex justify-content-between align-items-center">
            <span class="fw-semibold">
              Indicadores por Ativo <span class="badge bg-secondary ms-1">{metrics.length}</span>
            </span>
            {hasCalculation && <PositionFilterForm selectedPosition={selectedPosition} />}
          </div>
          <div class="card-body p-0">
            {hasData ? (
              <MetricsTable metrics={metrics} />
            ) : hasCalculation ? (
              <div class="text-center text-muted py-5">
                <p class="mt-2">Nenhum ativo para exibir.</p>
                <p class="small">
                  {selectedPosition === 'with' ? (
                    <>
                      Selecione <strong>Todos os ativos</strong> para incluir quem não tem posição
                      aberta.
                    </>
                  ) : (
                    'Nenhum ativo tem série mensal suficiente para a regressão.'
                  )}
                </p>
              </div>
            ) : (
              <div class="text-center text-muted py-5">
                <p class="mt-2">Nenhuma métrica calculada.</p>
                <p class="small">
                  Clique em <strong>Recalcular</strong> para gerar os indicadores.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}

function SummaryCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div class="col-sm-6 col-xl-4">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body">
          <div class="text-muted small mb-1">{label}</div>
          <div class={`num fs-4 fw-bold ${value === null ? 'text-muted' : ''}`}>{value ?? '—'}</div>
        </div>
      </div>
    </div>
  )
}

function PositionFilterForm({ selectedPosition }: { selectedPosition: PositionFilter }) {
  return (
    <form method="get" action="/risk-metrics/" class="d-flex align-items-center mb-0">
      <select name="position" class="form-select form-select-sm" style="width:auto" data-autosubmit>
        <option value="with" selected={selectedPosition === 'with'}>
          Apenas com posição
        </option>
        <option value="all" selected={selectedPosition === 'all'}>
          Todos os ativos
        </option>
      </select>
    </form>
  )
}

function MetricsTable({ metrics }: { metrics: RiskMetricsResult[] }) {
  return (
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle">
        <thead class="table-light">
          <tr>
            <th>Ativo</th>
            <th>Tipo</th>
            <HelpHeader label="% do Tipo" help={TYPE_SHARE_HELP} />
            <HelpHeader label="Beta" help={BETA_HELP} />
            <HelpHeader label="Alpha (a.a.)" help={ALPHA_HELP} />
            <HelpHeader label="R²" help={R2_HELP} />
            <th class="text-end">Dados</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr style={m.hasPosition ? '' : 'opacity: 0.55'}>
              <td>
                <a href={`/assets/${m.ticker}`} class="text-decoration-none fw-semibold">
                  {m.ticker}
                </a>
              </td>
              <td>
                {m.type === null ? <span class="text-muted">—</span> : <AssetBadge type={m.type} />}
              </td>
              <td class="text-end">
                {m.typeShare === null ? (
                  <span class="text-muted">—</span>
                ) : (
                  <span class={m.hasPosition ? '' : 'text-muted'}>{percent(m.typeShare)}</span>
                )}
              </td>
              <td class="text-end">
                {m.beta === null ? (
                  <span class="text-muted">—</span>
                ) : (
                  <>
                    <UnreliableMark reliable={m.reliable} />
                    {decimal(m.beta)}
                  </>
                )}
              </td>
              <td class="text-end">
                {m.alphaAnnual === null ? (
                  <span class="text-muted">—</span>
                ) : (
                  <>
                    <UnreliableMark reliable={m.reliable} />
                    <span class={m.alphaAnnual >= 0 ? 'text-success' : 'text-danger'}>
                      {percent(m.alphaAnnual)}
                    </span>
                  </>
                )}
              </td>
              <td class="text-end">
                {m.rSquared === null ? <span class="text-muted">—</span> : decimal(m.rSquared)}
              </td>
              <td class="text-end">{m.dataPoints} meses</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HelpHeader({ label, help }: { label: string; help: string }) {
  return (
    <th
      class="text-end"
      data-bs-toggle="tooltip"
      data-bs-placement="top"
      title={help}
      style="cursor: help;"
    >
      {label} <i class="bi bi-question-circle small text-muted" />
    </th>
  )
}

function UnreliableMark({ reliable }: { reliable: boolean }) {
  if (reliable) return null
  return (
    <span class="me-1" title={UNRELIABLE_HELP} data-bs-toggle="tooltip">
      ⚠️
    </span>
  )
}
