import { ASSET_TYPES } from '../../domain/constants.js'
import type { AssetClassView } from '../../modules/allocation/allocation.schema.js'

/**
 * Modal de edição do ativo, compartilhado pela lista (`/assets/`) e pelo detalhe
 * (`/assets/:ticker`).
 *
 * Era função privada de `assets.tsx`. Duplicá-lo para o detalhe daria dois formulários
 * com os mesmos `id` e o risco de um ganhar campo que o outro não tem — e o `openEditAssetModal`
 * de `client/ui.ts` procura os ids, então a divergência apareceria como campo que não preenche.
 */
export function EditAssetModal({ classes }: { classes: AssetClassView[] }) {
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
            {/* Preenchido pelo gatilho: a lista volta para /assets/, o detalhe para si mesmo. */}
            <input type="hidden" id="editReturnTo" name="returnTo" value="" />
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
                  Classe <span class="text-muted small">(alocação)</span>
                </label>
                <select id="editAssetClass" name="asset_class_id" class="form-select">
                  <option value="">— sem classe —</option>
                  {classes.map((c) => (
                    <option value={String(c.id)}>{c.name}</option>
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

/**
 * Atributos que o `openEditAssetModal` lê para preencher o formulário.
 * Um objeto só, para o botão da lista e o do detalhe não saírem de sincronia.
 */
export function editAssetAttrs(asset: {
  ticker: string
  name: string | null
  type: string
  yfTicker: string | null
  currency: string
  delisted: boolean
  assetClassId: number | null
}) {
  return {
    'data-edit-asset': true,
    'data-asset-ticker': asset.ticker,
    'data-asset-name': asset.name ?? '',
    'data-asset-type': asset.type,
    'data-asset-yf-ticker': asset.yfTicker ?? '',
    'data-asset-currency': asset.currency,
    'data-asset-delisted': String(asset.delisted),
    'data-asset-class-id': asset.assetClassId === null ? '' : String(asset.assetClassId),
  }
}
