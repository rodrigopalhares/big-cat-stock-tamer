import { ASSET_TYPES } from '../../domain/constants.js'
import type { AssetView } from '../../modules/asset/asset.schema.js'
import { AssetBadge } from '../components/badge.js'
import { Layout } from '../layout.js'

/** Porte de src/main/resources/templates/assets.html. */

export type AssetsPageProps = {
  assets: AssetView[]
  selectedType: string
  selectedPosition: string
  selectedDelisted: string
  error?: string | null
}

export function AssetsPage({
  assets,
  selectedType,
  selectedPosition,
  selectedDelisted,
  error = null,
}: AssetsPageProps) {
  const hasFilters = selectedType !== '' || selectedPosition !== '' || selectedDelisted !== ''

  return (
    <Layout title="Ativos" path="/assets/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2 class="mb-0">
            <i class="bi bi-building" /> Ativos
          </h2>
        </div>

        {error !== null && (
          <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <span>{error}</span>
            <button type="button" class="btn-close" data-bs-dismiss="alert" />
          </div>
        )}

        <div class="row g-4">
          <div class="col-lg-4">
            <CreateAssetForm />
          </div>
          <div class="col-lg-8">
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white d-flex justify-content-between align-items-center">
                <span class="fw-semibold">
                  Ativos Cadastrados <span class="badge bg-secondary ms-1">{assets.length}</span>
                </span>
                <div class="d-flex align-items-center gap-2">
                  <Filters
                    selectedType={selectedType}
                    selectedPosition={selectedPosition}
                    selectedDelisted={selectedDelisted}
                  />
                  {hasFilters && (
                    <a href="/assets/" class="btn btn-sm btn-outline-secondary">
                      <i class="bi bi-x-lg" />
                    </a>
                  )}
                </div>
              </div>
              <div class="card-body p-0">
                {assets.length > 0 ? (
                  <AssetTable assets={assets} />
                ) : (
                  <div class="text-center py-5 text-muted">
                    <i class="bi bi-inbox fs-1" />
                    <p class="mt-2">Nenhum ativo cadastrado ainda.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <EditAssetModal />
      </div>
    </Layout>
  )
}

function CreateAssetForm() {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">
        <i class="bi bi-plus-circle" /> Novo Ativo
      </div>
      <div class="card-body">
        <form method="post" action="/assets/new">
          <div class="mb-3">
            <label class="form-label">
              Ticker <span class="text-danger">*</span>
            </label>
            <input
              type="text"
              name="ticker"
              id="assetTicker"
              class="form-control"
              placeholder="Ex: PETR4"
              required
              maxLength={10}
              data-uppercase
              hx-get="/assets/ticker-info"
              hx-trigger="change, keyup changed delay:600ms"
              hx-target="#asset-ticker-preview"
              hx-include="this"
            />
            <div id="asset-ticker-preview" class="mt-2" />
            <input type="hidden" id="assetYfTicker" name="yf_ticker" value="" />
          </div>
          <div class="mb-3">
            <label class="form-label">Nome</label>
            <input
              type="text"
              id="assetName"
              name="name"
              class="form-control"
              placeholder="preenchido automaticamente"
            />
          </div>
          <div class="mb-3">
            <label class="form-label">Tipo</label>
            <select id="assetType" name="type" class="form-select">
              {ASSET_TYPES.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div class="mb-3">
            <label class="form-label">Moeda</label>
            <select id="assetCurrency" name="currency" class="form-select">
              <option value="BRL" selected>
                BRL — Real
              </option>
              <option value="USD">USD — Dólar</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary w-100">
            <i class="bi bi-check-lg" /> Cadastrar
          </button>
        </form>
      </div>
    </div>
  )
}

function Filters({
  selectedType,
  selectedPosition,
  selectedDelisted,
}: {
  selectedType: string
  selectedPosition: string
  selectedDelisted: string
}) {
  return (
    <form method="get" action="/assets/" class="d-flex align-items-center gap-2 mb-0">
      <select name="type" class="form-select form-select-sm" style="width:auto" data-autosubmit>
        <option value="">Tipo: Todos</option>
        {ASSET_TYPES.map((t) => (
          <option value={t} selected={t === selectedType}>
            {t}
          </option>
        ))}
      </select>
      <select name="position" class="form-select form-select-sm" style="width:auto" data-autosubmit>
        <option value="">Posição: Todos</option>
        <option value="with" selected={selectedPosition === 'with'}>
          Com posição
        </option>
        <option value="without" selected={selectedPosition === 'without'}>
          Sem posição
        </option>
      </select>
      <select name="delisted" class="form-select form-select-sm" style="width:auto" data-autosubmit>
        <option value="">Status: Todos</option>
        <option value="active" selected={selectedDelisted === 'active'}>
          Apenas ativos
        </option>
        <option value="delisted" selected={selectedDelisted === 'delisted'}>
          Apenas deslistados
        </option>
      </select>
    </form>
  )
}

function AssetTable({ assets }: { assets: AssetView[] }) {
  return (
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle">
        <thead class="table-light">
          <tr>
            <th>Ticker</th>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Moeda</th>
            <th>YF Ticker</th>
            <th class="text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr style={asset.hasPosition ? '' : 'opacity: 0.55'}>
              <td class="fw-bold">
                <a href={`/assets/${asset.ticker}`} class="text-decoration-none">
                  {asset.ticker}
                </a>
                {asset.delisted && (
                  <i
                    class="bi bi-x-circle text-secondary ms-1"
                    title="Deslistado"
                    style="font-size: 0.8em"
                  />
                )}
              </td>
              <td class="text-muted">{asset.name ?? '—'}</td>
              <td>
                <AssetBadge type={asset.type} />
              </td>
              <td>
                <span class="badge bg-light text-dark border">{asset.currency}</span>
              </td>
              <td class="text-muted small">{asset.yfTicker ?? '—'}</td>
              <td class="text-center">
                <a
                  href={`/transactions/?ticker=${encodeURIComponent(asset.ticker)}`}
                  class="btn btn-sm btn-outline-secondary"
                  title="Ver transações"
                >
                  <i class="bi bi-list-ul" />
                </a>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary"
                  title="Editar"
                  data-asset-ticker={asset.ticker}
                  data-asset-name={asset.name ?? ''}
                  data-asset-type={asset.type ?? 'STOCK'}
                  data-asset-yf-ticker={asset.yfTicker ?? ''}
                  data-asset-currency={asset.currency}
                  data-asset-delisted={String(asset.delisted)}
                  data-edit-asset
                >
                  <i class="bi bi-pencil" />
                </button>
                <form
                  method="post"
                  action={`/assets/${asset.ticker}/delete`}
                  class="d-inline"
                  data-confirm={`Excluir ${asset.ticker}? As transações também serão removidas.`}
                >
                  <button type="submit" class="btn btn-sm btn-outline-danger" title="Excluir">
                    <i class="bi bi-trash" />
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EditAssetModal() {
  return (
    <div class="modal fade" id="editAssetModal" tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-pencil" /> Editar Ativo — <span id="editModalTicker" />
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" />
          </div>
          <form id="editAssetForm" method="post">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Nome</label>
                <input
                  type="text"
                  id="editName"
                  name="name"
                  class="form-control"
                  placeholder="Ex: Petrobras PN"
                />
              </div>
              <div class="mb-3">
                <label class="form-label">Tipo</label>
                <select id="editType" name="type" class="form-select">
                  {ASSET_TYPES.map((t) => (
                    <option value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">
                  YF Ticker <span class="text-muted small">(Yahoo Finance)</span>
                </label>
                <input
                  type="text"
                  id="editYfTicker"
                  name="yf_ticker"
                  class="form-control"
                  placeholder="Ex: PETR4.SA"
                />
              </div>
              <div class="mb-3">
                <label class="form-label">Moeda</label>
                <select id="editCurrency" name="currency" class="form-select">
                  <option value="BRL">BRL — Real</option>
                  <option value="USD">USD — Dólar</option>
                </select>
              </div>
              <div class="form-check mb-3">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="editDelisted"
                  name="delisted"
                  value="on"
                />
                <label class="form-check-label" for="editDelisted">
                  Deslistado
                </label>
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
