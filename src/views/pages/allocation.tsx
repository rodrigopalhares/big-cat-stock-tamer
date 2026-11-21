import type { Allocation, AllocationAsset, AllocationClass } from '../../domain/allocation.js'
import type { AssetClassView, UnpricedAsset } from '../../modules/allocation/allocation.schema.js'
import { hexTextColor } from '../../shared/asset-colors.js'
import { decimal, money } from '../../shared/format.js'
import { AssetBadge } from '../components/badge.js'
import { Layout } from '../layout.js'

/**
 * Alocação por classe: o quanto cada classe pesa hoje, o quanto deveria pesar e o que
 * fazer a respeito. As classes vêm ordenadas do domínio — quem está mais abaixo da meta
 * primeiro, que é a ordem em que o próximo aporte deve entrar.
 */

export type AllocationPageProps = {
  allocation: Allocation
  classes: AssetClassView[]
  unpriced: UnpricedAsset[]
}

export function AllocationPage({ allocation, classes, unpriced }: AllocationPageProps) {
  return (
    <Layout title="Alocação — Carteira" path="/allocation/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-pie-chart" /> Alocação
          </h2>
          <button type="button" class="btn btn-primary" data-new-class>
            <i class="bi bi-plus-lg" /> Nova classe
          </button>
        </div>

        {/* Fica fora do bloco trocado pelo HTMX: é o alvo do HX-Retarget dos erros. */}
        <div id="error-banner" class="text-danger fw-semibold mb-3" />

        <AllocationBody allocation={allocation} classes={classes} unpriced={unpriced} />

        <AssetClassModal />
      </div>
    </Layout>
  )
}

/**
 * O bloco inteiro que o HTMX troca.
 *
 * Trocar a classe de um ativo, ou a meta de uma classe, muda percentual, distância e a
 * ordem dos cards — atualizar só a linha mexida deixaria o resto da tela mentindo.
 */
export function AllocationBody({ allocation, classes, unpriced }: AllocationPageProps) {
  const { totalValue, totalTarget, classes: buckets } = allocation

  return (
    <div id="allocation-body">
      <Summary totalValue={totalValue} totalTarget={totalTarget} />
      <UnpricedWarning unpriced={unpriced} />
      <ClassSummary buckets={buckets} />

      {buckets.length === 0 ? (
        <div class="card border-0 shadow-sm">
          <div class="card-body text-center py-5 text-muted">
            <i class="bi bi-pie-chart fs-1" />
            <p class="mt-2 mb-0">Nenhuma classe cadastrada e nenhuma posição em carteira.</p>
          </div>
        </div>
      ) : (
        buckets.map((bucket) => (
          <ClassCard bucket={bucket} classes={classes} totalValue={totalValue} />
        ))
      )}
    </div>
  )
}

function Summary({ totalValue, totalTarget }: { totalValue: number; totalTarget: number }) {
  // Meta fora dos 100% é aviso, não erro: dá para editar uma classe de cada vez sem que
  // a tela reclame no meio do caminho.
  const offTarget = Math.abs(totalTarget - 100) > 0.005

  return (
    <div class="card border-0 shadow-sm mb-4">
      <div class="card-body py-2 d-flex flex-wrap align-items-baseline column-gap-4">
        <div>
          <span class="text-muted small me-2">Patrimônio total</span>
          <span class="num fs-5 fw-semibold">{money(totalValue)}</span>
        </div>
        <div>
          <span class="text-muted small me-2">Soma das metas</span>
          <span class={`num fs-5 fw-semibold ${offTarget ? 'text-warning' : ''}`}>
            {decimal(totalTarget, 2)}%
          </span>
        </div>
        {offTarget && (
          <div class="text-warning small">
            <i class="bi bi-exclamation-triangle" /> As metas somam {decimal(totalTarget, 2)}%, não
            100%.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Uma linha por classe, para ver de relance onde falta e onde sobra sem rolar os cards.
 *
 * A barra mede o quanto da *meta* da classe já foi atingido, não o quanto ela pesa: meta de
 * 30% com 15% na carteira é meia barra, e com 30% é a barra cheia. Assim todas as linhas
 * têm a meta no mesmo lugar — e a classe de meta pequena não parece vazia ao lado da grande.
 * A régua vai de 0 a max(120%, maior barra + 5%) e a linha vermelha marca os 100%; o que
 * passou da meta ultrapassa a linha, e o número ao lado diz quanto.
 */
function ClassSummary({ buckets }: { buckets: AllocationClass[] }) {
  if (buckets.length === 0) return null

  const scale = summaryScale(buckets)

  return (
    <div class="card border-0 shadow-sm mb-4" id="class-summary">
      <div class="card-header bg-white fw-semibold">Resumo por classe</div>
      {/* Uma grade só para as cinco linhas: as colunas se alinham sozinhas e o conjunto
          nome · barra · distância fica centralizado no card. */}
      <div
        class="card-body"
        style="display: grid; grid-template-columns: max-content minmax(10rem, 36rem) max-content; justify-content: center; align-items: center; column-gap: 1rem; row-gap: 0.75rem"
      >
        {buckets.map((bucket) => (
          <>
            <div class="text-end">
              <span
                class="badge"
                style={`background-color: ${bucket.color}; color: ${hexTextColor(bucket.color)}`}
              >
                {bucket.name}
              </span>
            </div>
            <ScaleBar bucket={bucket} scale={scale} />
            <div class="small">
              <GapLabel bucket={bucket} />
            </div>
          </>
        ))}
      </div>
    </div>
  )
}

/** Fim da régua em % da meta: 120, ou a maior barra mais 5 se ela passar disso. */
const MIN_SCALE = 120
const SCALE_MARGIN = 5

/**
 * A mesma régua para todas as linhas, senão a barra de uma classe não se compara com a
 * da outra. O piso de 120% deixa a linha da meta sempre com folga à direita; a margem de
 * 5 pontos evita que a classe mais acima da meta encoste na borda.
 */
function summaryScale(buckets: AllocationClass[]): number {
  const highest = Math.max(0, ...buckets.map((bucket) => reachedPercent(bucket) ?? 0))
  return Math.max(MIN_SCALE, highest + SCALE_MARGIN)
}

/** Quanto da meta já foi atingido, em %; null sem meta (balde "Sem classe"). */
function reachedPercent(bucket: AllocationClass): number | null {
  if (bucket.id === null) return null
  // Meta zero com posição é "já passou de tudo".
  if (bucket.targetPercent <= 0) return 100
  return (bucket.currentPercent / bucket.targetPercent) * 100
}

function ScaleBar({ bucket, scale }: { bucket: AllocationClass; scale: number }) {
  const reached = reachedPercent(bucket)
  const width = ((reached ?? 0) / scale) * 100
  const targetAt = (100 / scale) * 100
  // O valor da barra só aparece ao passar o mouse: a distância ao lado já diz o que importa.
  const title =
    reached === null
      ? `Sem meta · atual ${decimal(bucket.currentPercent, 2)}%`
      : `${decimal(reached, 0)}% da meta · atual ${decimal(bucket.currentPercent, 2)}% · meta ${decimal(bucket.targetPercent, 2)}%`

  return (
    <div class="position-relative" title={title}>
      <div class="progress" style="height: 12px">
        <div
          class="progress-bar"
          style={`width: ${width.toFixed(2)}%; background-color: ${bucket.color}`}
          role="progressbar"
          aria-label={`Meta atingida de ${bucket.name}`}
          aria-valuenow={Math.round(reached ?? 0)}
          aria-valuemin={0}
          aria-valuemax={Math.round(scale)}
        />
      </div>
      {/* Fora do .progress, que corta o que passa da borda: o traço é a meta (100%). */}
      <div
        class="position-absolute border-start border-2 border-danger"
        style={`left: ${targetAt.toFixed(2)}%; top: -3px; height: 18px; border-left-style: dashed !important`}
        data-target-line
      />
    </div>
  )
}

/** "↓ 4,20 p.p. · R$ 1.234,00 para a meta" — a distância nas duas unidades. */
function GapLabel({ bucket }: { bucket: AllocationClass }) {
  if (bucket.id === null) {
    return (
      <span class="text-muted">
        <span class="num">{decimal(bucket.currentPercent, 2)}%</span> · sem meta
      </span>
    )
  }
  if (bucket.distance < 0.005) {
    return (
      <span class="text-success">
        <i class="bi bi-check-lg" /> na meta
      </span>
    )
  }
  const below = bucket.deviation < 0
  return (
    <span>
      <span class={`fw-semibold ${below ? 'text-warning-emphasis' : 'text-info-emphasis'}`}>
        {below ? '↓' : '↑'} <span class="num">{decimal(bucket.distance, 2)}</span> p.p.
      </span>{' '}
      <span class="text-muted">
        · <span class="num">{money(Math.abs(bucket.rebalanceAmount))}</span>{' '}
        {below ? 'para a meta' : 'acima da meta'}
      </span>
    </span>
  )
}

/**
 * Posição sem cotação não entra em percentual nenhum — e sem este aviso a classe dela
 * apareceria menor do que é, sem nada na tela explicando o buraco.
 */
function UnpricedWarning({ unpriced }: { unpriced: UnpricedAsset[] }) {
  if (unpriced.length === 0) return null

  return (
    <div class="alert alert-warning d-flex align-items-start gap-2" role="alert">
      <i class="bi bi-exclamation-triangle mt-1" />
      <div>
        <strong>
          {unpriced.length === 1
            ? '1 ativo com posição ficou de fora por falta de cotação'
            : `${unpriced.length} ativos com posição ficaram de fora por falta de cotação`}
        </strong>
        <div class="small">
          {unpriced.map((asset) => asset.ticker).join(', ')} — o patrimônio e os percentuais acima
          não os incluem. Atualize as cotações no dashboard e recarregue.
        </div>
      </div>
    </div>
  )
}

function ClassCard({
  bucket,
  classes,
  totalValue,
}: {
  bucket: AllocationClass
  classes: AssetClassView[]
  totalValue: number
}) {
  const unclassified = bucket.id === null

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white d-flex flex-wrap align-items-center gap-3">
        <span
          class="badge fs-6"
          style={`background-color: ${bucket.color}; color: ${hexTextColor(bucket.color)}`}
        >
          {bucket.name}
        </span>

        <div class="text-muted small">
          <span class="num fw-semibold text-body">{money(bucket.currentValue)}</span> ·{' '}
          <span class="num">{decimal(bucket.currentPercent, 2)}%</span> da carteira
        </div>

        <div class="d-flex align-items-center gap-1 small text-muted">
          Meta
          {unclassified ? (
            <span class="ms-1">—</span>
          ) : (
            <div class="input-group input-group-sm" style="width: 7rem">
              <input
                type="number"
                class="num form-control form-control-sm text-end"
                name="target_percent"
                value={decimalInput(bucket.targetPercent)}
                min="0"
                max="100"
                step="0.5"
                aria-label={`Meta de ${bucket.name}`}
                hx-post={`/allocation/classes/${bucket.id}/target`}
                hx-trigger="change"
                hx-target="#allocation-body"
                hx-swap="outerHTML"
              />
              <span class="input-group-text">%</span>
            </div>
          )}
        </div>

        <DeviationBadge bucket={bucket} />

        <div class="ms-auto d-flex align-items-center gap-2">
          {/*
            "Excesso", não "Reduzir": a carteira é rebalanceada só com aporte novo, nunca
            com venda. O número acima da meta diz o quanto o resto precisa crescer, não uma
            ordem de venda — e é por isso que a classe também não vai para o topo da fila.
          */}
          <span class="small text-muted">
            {bucket.rebalanceAmount >= 0 ? 'Aportar' : 'Excesso'}{' '}
            <span class="num fw-semibold text-body">{money(Math.abs(bucket.rebalanceAmount))}</span>
          </span>
          {!unclassified && (
            <>
              <button
                type="button"
                class="btn btn-sm btn-outline-primary"
                title="Editar classe"
                aria-label={`Editar classe ${bucket.name}`}
                data-edit-class
                data-class-id={String(bucket.id)}
                data-class-name={bucket.name}
                data-class-target={decimalInput(bucket.targetPercent)}
                data-class-color={bucket.color}
              >
                <i class="bi bi-pencil" />
              </button>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                title="Excluir classe"
                aria-label={`Excluir classe ${bucket.name}`}
                hx-delete={`/allocation/classes/${bucket.id}`}
                hx-target="#allocation-body"
                hx-swap="outerHTML"
                hx-confirm={`Excluir a classe '${bucket.name}'?`}
              >
                <i class="bi bi-trash" />
              </button>
            </>
          )}
        </div>
      </div>

      <TargetBar bucket={bucket} />

      <div class="card-body p-0">
        {bucket.assets.length === 0 ? (
          <p class="text-muted small text-center my-3">Nenhum ativo nesta classe.</p>
        ) : (
          <AssetTable assets={bucket.assets} classId={bucket.id} classes={classes} />
        )}
      </div>

      {unclassified && totalValue > 0 && (
        <div class="card-footer bg-white text-muted small">
          <i class="bi bi-info-circle" /> Estes ativos não entram em nenhuma meta. Escolha a classe
          de cada um na última coluna.
        </div>
      )}
    </div>
  )
}

/** Distância da meta em pontos percentuais, com o sinal explícito. */
function DeviationBadge({ bucket }: { bucket: AllocationClass }) {
  if (bucket.id === null) {
    return <span class="badge bg-secondary">sem meta</span>
  }
  if (bucket.distance < 0.005) {
    return (
      <span class="badge bg-success">
        <i class="bi bi-check-lg" /> na meta
      </span>
    )
  }
  const below = bucket.deviation < 0
  return (
    <span class={`badge ${below ? 'bg-warning text-dark' : 'bg-info text-dark'}`}>
      {below ? '↓' : '↑'} <span class="num">{decimal(Math.abs(bucket.deviation), 2)}</span> p.p.{' '}
      {below ? 'abaixo' : 'acima'}
    </span>
  )
}

/**
 * Barra do peso atual com um traço na posição da meta.
 * A escala vai até o maior entre atual e meta, senão a classe com 60% de meta e 5% de
 * peso desenharia duas barras cheias e indistinguíveis.
 */
function TargetBar({ bucket }: { bucket: AllocationClass }) {
  const scale = Math.max(bucket.currentPercent, bucket.targetPercent, 1)
  const width = (bucket.currentPercent / scale) * 100
  const markerAt = (bucket.targetPercent / scale) * 100

  return (
    <div class="px-3 pb-2">
      <div class="position-relative">
        <div class="progress" style="height: 8px">
          <div
            class="progress-bar"
            style={`width: ${width.toFixed(2)}%; background-color: ${bucket.color}`}
            role="progressbar"
            aria-label={`Peso de ${bucket.name}`}
            aria-valuenow={Math.round(bucket.currentPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        {bucket.id !== null && bucket.targetPercent > 0 && (
          <div
            class="position-absolute top-0 border-start border-2 border-dark"
            style={`left: ${markerAt.toFixed(2)}%; height: 8px`}
            title={`Meta: ${decimal(bucket.targetPercent, 2)}%`}
          />
        )}
      </div>
    </div>
  )
}

function AssetTable({
  assets,
  classId,
  classes,
}: {
  assets: AllocationAsset[]
  classId: number | null
  classes: AssetClassView[]
}) {
  return (
    <div class="table-responsive">
      <table class="table table-hover table-sm mb-0 align-middle">
        <thead class="table-light">
          <tr>
            <th>Ticker</th>
            <th>Nome</th>
            <th>Tipo</th>
            <th class="text-end">Valor de mercado</th>
            <th class="text-end">% da classe</th>
            <th class="text-end">% do patrimônio</th>
            <th style="width: 12rem">Classe</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr>
              <td class="fw-bold">
                <a href={`/assets/${asset.ticker}`} class="text-decoration-none">
                  {asset.ticker}
                </a>
              </td>
              <td class="text-muted">{asset.name ?? '—'}</td>
              <td>
                <AssetBadge type={asset.type} />
              </td>
              <td class="text-end">{money(asset.marketValue)}</td>
              <td class="text-end">{decimal(asset.percentOfClass, 2)}%</td>
              <td class="text-end text-muted">{decimal(asset.percentOfTotal, 2)}%</td>
              <td>
                <select
                  class="form-select form-select-sm"
                  name="class_id"
                  aria-label={`Classe de ${asset.ticker}`}
                  hx-post={`/allocation/assets/${encodeURIComponent(asset.ticker)}/class`}
                  hx-trigger="change"
                  hx-target="#allocation-body"
                  hx-swap="outerHTML"
                >
                  <option value="" selected={classId === null}>
                    — sem classe —
                  </option>
                  {classes.map((c) => (
                    <option value={String(c.id)} selected={c.id === classId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Um modal só para criar e editar — o JS de `client/ui.ts` troca action e valores. */
function AssetClassModal() {
  return (
    <div class="modal fade" id="assetClassModal" tabIndex={-1}>
      <div class="modal-dialog">
        <div class="modal-content">
          <form id="assetClassForm" method="post" action="/allocation/classes/new">
            <div class="modal-header">
              <h5 class="modal-title" id="assetClassModalTitle">
                Nova classe
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar" />
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label" for="className">
                  Nome <span class="text-danger">*</span>
                </label>
                <input
                  type="text"
                  id="className"
                  name="name"
                  class="form-control"
                  required
                  maxLength={40}
                  placeholder="Ex: Internacional"
                />
              </div>
              <div class="mb-3">
                <label class="form-label" for="classTarget">
                  Meta (% do patrimônio)
                </label>
                <input
                  type="number"
                  id="classTarget"
                  name="target_percent"
                  class="form-control"
                  min="0"
                  max="100"
                  step="0.5"
                  value="0"
                />
              </div>
              <div class="mb-3">
                <label class="form-label" for="classColor">
                  Cor
                </label>
                <input
                  type="color"
                  id="classColor"
                  name="color"
                  class="form-control form-control-color"
                  value="#6c757d"
                />
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

/** `20` → `20`, `12.5` → `12.5`: o input number quer ponto, não a vírgula do pt-BR. */
function decimalInput(value: number): string {
  return String(Math.round(value * 100) / 100)
}
