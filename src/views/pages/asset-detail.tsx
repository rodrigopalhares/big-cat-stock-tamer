import type { AssetView } from '../../modules/asset/asset.schema.js'
import type { DividendView } from '../../modules/dividend/dividend.schema.js'
import type { AssetPosition } from '../../modules/portfolio/portfolio.schema.js'
import type { TransactionView } from '../../modules/transaction/transaction.schema.js'
import { date as fmtDate, money, percent, quantity, signClass } from '../../shared/format.js'
import type { IsoDate } from '../../shared/iso-date.js'
import { AssetBadge, DividendBadge, TransactionBadge } from '../components/badge.js'
import { Layout } from '../layout.js'
import { DividendModal } from './dividends.js'
import { TransactionModal } from './transactions.js'

/** Porte de src/main/resources/templates/asset-detail.html. */

export type AssetDetailPageProps = {
  asset: AssetView
  position: AssetPosition | null
  transactions: TransactionView[]
  dividends: DividendView[]
  /** Data que o formulário de lançamento já vem preenchida — do servidor, não do navegador. */
  today: IsoDate
}

export function AssetDetailPage({
  asset,
  position,
  transactions,
  dividends,
  today,
}: AssetDetailPageProps) {
  const returnTo = `/assets/${asset.ticker}`

  return (
    <Layout title={`${asset.ticker} — Carteira`} path="/assets/">
      <div class="container-fluid py-4 px-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 class="mb-1">
              {asset.ticker} <AssetBadge type={asset.type} />
              {asset.delisted && (
                <span class="badge bg-secondary ms-1" title="Deslistado">
                  deslistado
                </span>
              )}
            </h2>
            <div class="text-muted">{asset.name ?? '—'}</div>
          </div>
          <a href="/assets/" class="btn btn-outline-secondary btn-sm">
            <i class="bi bi-arrow-left" /> Voltar
          </a>
        </div>

        {position !== null && <PositionCards position={position} />}

        <div class="card border-0 shadow-sm mb-4">
          <div class="card-header bg-white d-flex justify-content-between align-items-center">
            <span class="fw-semibold">
              <i class="bi bi-arrow-left-right" /> Transações{' '}
              <span class="badge bg-secondary ms-1">{transactions.length}</span>
            </span>
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              data-new-tx
              data-ticker={asset.ticker}
              data-return-to={returnTo}
              data-tx-date={today}
              data-tx-currency={asset.currency}
              data-tx-fees="0"
            >
              <i class="bi bi-plus-lg" /> Nova Transação
            </button>
          </div>
          <div class="card-body p-0">
            {transactions.length > 0 ? (
              <TransactionsTable transactions={transactions} returnTo={returnTo} />
            ) : (
              <EmptyState message="Nenhuma transação registrada para este ativo." />
            )}
          </div>
        </div>

        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white d-flex justify-content-between align-items-center">
            <span class="fw-semibold">
              <i class="bi bi-cash-coin" /> Proventos{' '}
              <span class="badge bg-secondary ms-1">{dividends.length}</span>
            </span>
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              data-new-div
              data-ticker={asset.ticker}
              data-return-to={returnTo}
              data-div-date={today}
              data-div-currency={asset.currency}
              data-div-tax-withheld="0"
            >
              <i class="bi bi-plus-lg" /> Novo Provento
            </button>
          </div>
          <div class="card-body p-0">
            {dividends.length > 0 ? (
              <DividendsTable dividends={dividends} returnTo={returnTo} />
            ) : (
              <EmptyState message="Nenhum provento registrado para este ativo." />
            )}
          </div>
        </div>
      </div>

      <TransactionModal />
      <DividendModal />
      <script src="/js/transactions.js" defer />
      <script src="/js/dividends.js" defer />
    </Layout>
  )
}

function PositionCards({ position: p }: { position: AssetPosition }) {
  return (
    <div class="row g-3 mb-4">
      <Card label="Quantidade" value={p.quantity > 0 ? quantity(p.quantity) : '—'} />
      <Card label="Preço Médio" value={money(p.avgPrice, p.currency)} />
      <Card
        label="Cotação"
        value={p.currentPrice === null ? null : money(p.currentPrice, p.currency)}
      />
      <Card
        label="Valor Atual"
        value={p.currentValue === null ? null : money(p.currentValue, p.currency)}
      />
      <Card
        label="Lucro Não Realizado"
        value={p.unrealizedPnl === null ? null : money(p.unrealizedPnl, p.currency)}
        valueClass={signClass(p.unrealizedPnl)}
      />
      <Card
        label="Lucro Realizado"
        value={money(p.realizedPnl, p.currency)}
        valueClass={signClass(p.realizedPnl)}
      />
      <Card
        label="Proventos"
        value={p.dividendPnl > 0 ? money(p.dividendPnl) : '—'}
        valueClass="text-success"
      />
      <Card
        label="TIR/ano"
        value={p.irrAnnual === null ? null : percent(p.irrAnnual)}
        valueClass={signClass(p.irrAnnual)}
      />
    </div>
  )
}

function Card({
  label,
  value,
  valueClass = '',
}: {
  label: string
  value: string | null
  valueClass?: string
}) {
  return (
    <div class="col-6 col-lg-3">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body">
          <div class="text-muted small mb-1">{label}</div>
          <div class={`fs-5 fw-bold ${value === null ? 'text-muted' : valueClass}`}>
            {value ?? '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

function TransactionsTable({
  transactions,
  returnTo,
}: {
  transactions: TransactionView[]
  returnTo: string
}) {
  return (
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle small">
        <thead class="table-light">
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th class="text-end">Qtd</th>
            <th class="text-end">Preço</th>
            <th class="text-end">Taxas</th>
            <th class="text-end">Total</th>
            <th>Corretora</th>
            <th class="text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr>
              <td>{fmtDate(t.date)}</td>
              <td>
                <TransactionBadge type={t.type} />
              </td>
              <td class="text-end">{quantity(t.quantity)}</td>
              <td class="text-end">{money(t.price, t.currency)}</td>
              <td class="text-end text-muted">{money(t.fees, t.currency)}</td>
              <td class="text-end fw-semibold">{money(t.total, t.currency)}</td>
              <td class="text-muted">{t.broker ?? '—'}</td>
              <td class="text-center text-nowrap">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary border-0"
                  title="Editar"
                  data-edit-tx
                  data-return-to={returnTo}
                  data-tx-id={String(t.id)}
                  data-tx-type={t.type}
                  data-tx-quantity={String(t.quantity)}
                  data-tx-price={String(t.price)}
                  data-tx-fees={String(t.fees)}
                  data-tx-date={t.date}
                  data-tx-currency={t.currency}
                  data-tx-broker={t.broker ?? ''}
                  data-tx-notes={t.notes ?? ''}
                >
                  <i class="bi bi-pencil" />
                </button>
                <form
                  method="post"
                  action={`/transactions/${t.id}/delete`}
                  class="d-inline"
                  data-confirm="Excluir esta transação?"
                >
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" class="btn btn-sm btn-outline-danger border-0">
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

function DividendsTable({ dividends, returnTo }: { dividends: DividendView[]; returnTo: string }) {
  return (
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle small">
        <thead class="table-light">
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th class="text-end">Valor Bruto</th>
            <th class="text-end">IR Retido</th>
            <th class="text-end">Valor Líquido</th>
            <th class="text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {dividends.map((d) => (
            <tr>
              <td>{fmtDate(d.date)}</td>
              <td>
                <DividendBadge type={d.type} />
              </td>
              <td class="text-end">{money(d.totalAmount, d.currency)}</td>
              <td class="text-end text-muted">{money(d.taxWithheld, d.currency)}</td>
              <td class="text-end fw-semibold text-success">{money(d.netAmount, d.currency)}</td>
              <td class="text-center text-nowrap">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary border-0"
                  title="Editar"
                  data-edit-div
                  data-return-to={returnTo}
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
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" class="btn btn-sm btn-outline-danger border-0">
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

function EmptyState({ message }: { message: string }) {
  return (
    <div class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-1" />
      <p class="mt-2">{message}</p>
    </div>
  )
}
