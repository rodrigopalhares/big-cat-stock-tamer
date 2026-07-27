/**
 * Formulário de transação e fluxo de importação de CSV em duas etapas.
 * Porte de static/js/transactions.js.
 *
 * Os handlers inline do Thymeleaf viraram delegação por atributo `data-*` — o conteúdo das
 * duas etapas chega via HTMX depois do load, e delegar é o que faz isso continuar funcionando.
 */

import { transactionTypeMetaOrNull } from '../shared/transaction-types.js'

type AssetDraft = {
  ticker: string
  name: string
  type: string
  yfTicker: string
  currency: string
}

let pendingNewAssets: AssetDraft[] = []
let ignoredTickers = new Set<string>()
/** Distingue preço digitado de preço derivado do total — muda o que o total recalcula. */
let priceIsUserSet = false

const byId = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null
const numberValue = (id: string): number =>
  Number.parseFloat(byId<HTMLInputElement>(id)?.value ?? '') || 0
const setValue = (id: string, value: string): void => {
  const el = byId<HTMLInputElement>(id)
  if (el !== null) el.value = value
}

// --- formulário: campos que cada tipo admite ---

/**
 * Mostra ou esconde preço, valor total e taxas conforme o tipo escolhido.
 *
 * Desdobramento e agrupamento não têm preço; bonificação tem só o custo atribuído. Esconder
 * é conveniência — quem garante o valor gravado é `normalizePriceFees` no servidor, que
 * também cobre a API e o CSV. Os campos ficam apenas ocultos, nunca `disabled`: o valor
 * ainda é enviado e descartado lá.
 */
function applyTypeVisibility(prefix: string): void {
  const select = byId<HTMLSelectElement>(`${prefix}Type`)
  if (select === null) return

  const meta = transactionTypeMetaOrNull(select.value)
  const showPrice = meta === null || meta.priceFieldLabel !== null
  // Valor total e taxas só fazem sentido onde dinheiro se move.
  const showCashFields = meta === null || meta.cashFlow

  toggleGroup(`${prefix}PriceCol`, showPrice)
  toggleGroup(`${prefix}FeesCol`, showCashFields)
  toggleGroup(`${prefix}MarketExtrasRow`, showCashFields)
  toggleGroup(`${prefix}MarketRow`, showPrice || showCashFields)

  const priceLabel = byId(`${prefix}PriceLabel`)
  if (priceLabel !== null) priceLabel.textContent = meta?.priceFieldLabel ?? 'Preço Unit.'

  // Campo obrigatório e escondido trava o submit sem dizer por quê.
  const priceInput = byId<HTMLInputElement>(`${prefix}Price`)
  if (priceInput !== null && priceInput.dataset['requiredWhenVisible'] === 'true') {
    priceInput.required = showPrice
  }

  const hint = byId(`${prefix}TypeHint`)
  if (hint !== null) hint.textContent = TYPE_HINTS[select.value] ?? ''
}

/** Texto de apoio: a regra de "quantidade é o delta" não é óbvia sem dizer. */
const TYPE_HINTS: Record<string, string> = {
  BONIFICACAO: 'Quantidade de ações recebidas. O custo atribuído entra no preço médio.',
  DESDOBRAMENTO: 'Quantidade de ações ganhas no desdobramento, não a posição final.',
  AGRUPAMENTO: 'Quantidade de ações reduzidas no agrupamento, não a posição final.',
  REDUCAO_CAPITAL:
    'Quantidade de ações que receberam a devolução — a posição não muda. ' +
    'O valor recebido abate o preço médio.',
}

function toggleGroup(id: string, show: boolean): void {
  byId(id)?.classList.toggle('d-none', !show)
}

document.addEventListener('change', (event) => {
  const target = event.target
  if (target instanceof HTMLSelectElement && target.matches('[data-tx-type-select]')) {
    applyTypeVisibility(target.id.replace(/Type$/, ''))
  }
})

document.addEventListener('DOMContentLoaded', () => applyTypeVisibility('tx'))

// --- formulário: quantidade, preço, total e taxas se completam ---

function currentValues() {
  return {
    qty: numberValue('txQty'),
    price: numberValue('txPrice'),
    total: numberValue('txTotal'),
    fees: numberValue('txFees'),
  }
}

function recalculateTotal(): void {
  const v = currentValues()
  if (v.qty > 0 && v.price > 0) setValue('txTotal', (v.qty * v.price + v.fees).toFixed(2))
}

document.addEventListener('input', (event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return

  switch (target.id) {
    case 'txQty':
    case 'txFees':
      recalculateTotal()
      break
    case 'txPrice':
      priceIsUserSet = target.value !== ''
      recalculateTotal()
      break
    case 'txTotal': {
      const v = currentValues()
      if (v.total > 0 && v.qty > 0) {
        if (priceIsUserSet && v.price > 0) {
          // Preço veio do usuário: o total define as taxas.
          setValue('txFees', (v.total - v.qty * v.price).toFixed(2))
        } else {
          // Preço vazio ou derivado: o total define o preço.
          setValue('txPrice', ((v.total - v.fees) / v.qty).toFixed(4))
        }
      }
      break
    }
  }
})

// --- modal de edição de transação ---

declare const bootstrap: { Modal: new (el: Element) => { show: () => void } }

document.addEventListener('click', (event) => {
  const trigger = (event.target as Element | null)?.closest<HTMLElement>('[data-edit-tx]')
  if (trigger === null || trigger === undefined) return

  const d = trigger.dataset
  const form = byId<HTMLFormElement>('editTxForm')
  if (form === null) return

  form.action = `/transactions/${d['txId']}/edit`
  setValue('editTxType', d['txType'] || 'BUY')
  setValue('editTxCurrency', d['txCurrency'] || 'BRL')
  setValue('editTxQty', d['txQuantity'] ?? '')
  setValue('editTxPrice', d['txPrice'] ?? '')
  setValue('editTxFees', d['txFees'] ?? '')
  setValue('editTxDate', d['txDate'] ?? '')
  setValue('editTxBroker', d['txBroker'] ?? '')
  setValue('editTxNotes', d['txNotes'] ?? '')
  applyTypeVisibility('editTx')

  const returnTo = trigger.dataset['returnTo']
  byId('editTxReturnTo')?.remove()
  if (returnTo !== undefined && returnTo !== '') {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = 'returnTo'
    input.id = 'editTxReturnTo'
    input.value = returnTo
    form.appendChild(input)
  }

  const modal = byId('editTxModal')
  if (modal !== null) new bootstrap.Modal(modal).show()
})

// --- importação de CSV ---

document.addEventListener('DOMContentLoaded', () => {
  // Reabrir o modal recomeça do zero; senão a segunda importação herdaria o estado da primeira.
  byId('csvImportModal')?.addEventListener('show.bs.modal', () => {
    setValue('csvTextarea', '')
    const preview = byId('csv-preview-area')
    if (preview !== null) preview.innerHTML = ''
    pendingNewAssets = []
    ignoredTickers = new Set()
  })
})

document.addEventListener('change', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  if (target.matches('[data-ticker-lookup]')) void lookupAsset(target as HTMLInputElement, true)
  else if (target.matches('[data-yf-ticker-lookup]'))
    void lookupAsset(target as HTMLInputElement, false)
  else if (target.matches('.asset-ignore-check')) toggleIgnored(target as HTMLInputElement, false)
  else if (target.matches('.csv-ignore-check')) toggleIgnored(target as HTMLInputElement, true)
  else if (target.matches('[data-csv-errors-only]')) {
    showOnlyErrors((target as HTMLInputElement).checked)
  }
})

document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  if (target?.closest('[data-csv-next-step]') !== null) void goToPreviewStep()
  else if (target?.closest('[data-csv-batch-submit]') !== null) void submitBatch()
})

/** Preenche nome, tipo e moeda a partir do Yahoo; falha marca o ativo como desconhecido. */
async function lookupAsset(input: HTMLInputElement, isTicker: boolean): Promise<void> {
  const value = isTicker ? input.value.trim().toUpperCase() : input.value.trim()
  if (isTicker) input.value = value
  if (value.length < 2) return

  const row = input.closest('tr')
  if (row === null) return
  const spinner = row.querySelector('.ticker-spinner')
  spinner?.classList.remove('d-none')

  const field = (name: string) =>
    row.querySelector<HTMLInputElement | HTMLSelectElement>(`.asset-field[data-field="${name}"]`)
  const badge = row.querySelector('.badge')

  try {
    const response = await fetch(`/transactions/asset-info?ticker=${encodeURIComponent(value)}`)
    if (!response.ok) throw new Error('não encontrado')
    const data = (await response.json()) as Record<string, string>

    const fields = isTicker
      ? ['name', 'type', 'yfTicker', 'currency']
      : ['name', 'type', 'currency']
    for (const name of fields) {
      const el = field(name)
      if (el !== null && data[name] !== undefined) el.value = data[name]
    }

    if (isTicker) {
      const status = field('status')
      if (status !== null) status.value = 'WILL_CREATE'
      if (badge !== null) {
        badge.className = 'badge bg-info'
        badge.textContent = 'Novo'
      }
    }
  } catch {
    if (isTicker) {
      const status = field('status')
      if (status !== null) status.value = 'UNKNOWN'
      if (badge !== null) {
        badge.className = 'badge bg-warning text-dark'
        badge.textContent = 'Desconhecido'
      }
    }
  } finally {
    spinner?.classList.add('d-none')
  }
}

function toggleIgnored(checkbox: HTMLInputElement, isCsvRow: boolean): void {
  const row = checkbox.closest('tr')
  if (row === null) return

  row.classList.toggle('text-decoration-line-through', checkbox.checked)
  row.classList.toggle('text-muted', checkbox.checked)
  if (isCsvRow) {
    if (row.dataset['hasError'] === 'true') row.classList.toggle('table-danger', checkbox.checked)
    updateBatchCount()
  }
}

function updateBatchCount(): void {
  const table = byId<HTMLTableElement>('csvPreviewTable')
  if (table === null) return

  const total = Array.from(table.tBodies[0]?.rows ?? []).filter(
    (tr) => tr.querySelector<HTMLInputElement>('.csv-ignore-check')?.checked !== true,
  ).length

  const count = byId('csvBatchCount')
  if (count !== null) count.textContent = String(total)
  const button = byId<HTMLButtonElement>('csvBatchSubmitBtn')
  if (button !== null) button.disabled = total === 0
}

function showOnlyErrors(only: boolean): void {
  const table = byId<HTMLTableElement>('csvPreviewTable')
  if (table === null) return
  for (const tr of Array.from(table.tBodies[0]?.rows ?? [])) {
    tr.style.display = only && tr.dataset['hasError'] !== 'true' ? 'none' : ''
  }
}

/** Etapa 1 → 2: junta os ativos revisados e pede o preview das transações. */
async function goToPreviewStep(): Promise<void> {
  const table = byId<HTMLTableElement>('csvAssetTable')
  const rawCsv = byId<HTMLTextAreaElement>('csvRawHidden')
  if (table === null || rawCsv === null) return

  const rows = Array.from(table.tBodies[0]?.rows ?? [])
  const assets: AssetDraft[] = []
  ignoredTickers = new Set()

  for (const tr of rows) {
    const values: Record<string, string> = {}
    for (const field of Array.from(
      tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.asset-field'),
    )) {
      const key = field.dataset['field']
      if (key !== undefined) values[key] = field.value
    }

    if (tr.querySelector<HTMLInputElement>('.asset-ignore-check')?.checked === true) {
      ignoredTickers.add((values['ticker'] ?? '').toUpperCase())
      continue
    }
    if (values['status'] !== undefined && values['status'] !== 'EXISTS') {
      assets.push({
        ticker: values['ticker'] ?? '',
        name: values['name'] ?? '',
        type: values['type'] || 'STOCK',
        yfTicker: values['yfTicker'] ?? '',
        currency: values['currency'] || 'BRL',
      })
    }
  }
  pendingNewAssets = assets

  // Ticker corrigido na etapa 1 tem que valer também no CSV que vai para a etapa 2.
  rawCsv.value = applyTickerRenames(rawCsv.value, rows)

  const spinner = byId('csv-step2-spinner')
  const button = document.querySelector<HTMLButtonElement>('[data-csv-next-step]')
  if (button !== null) button.disabled = true
  spinner?.classList.remove('d-none')

  // urlencoded, não FormData: o app só registra o @fastify/formbody — multipart daria 415.
  const body = new URLSearchParams({ csv: rawCsv.value })

  try {
    const response = await fetch('/transactions/parse-csv-step2', { method: 'POST', body })
    if (!response.ok) throw new Error(`Erro ao processar: ${response.status}`)
    setPreview(await response.text())

    for (const tr of Array.from(
      document.querySelectorAll<HTMLTableRowElement>('#csvPreviewTable tbody tr'),
    )) {
      const check = tr.querySelector<HTMLInputElement>('.csv-ignore-check')
      if (check === null) continue
      if (ignoredTickers.has((check.dataset['ticker'] ?? '').toUpperCase())) check.checked = true
      if (check.checked) tr.classList.add('text-decoration-line-through', 'text-muted')
    }
    updateBatchCount()
  } catch (error) {
    setPreviewError(error)
  } finally {
    if (button !== null) button.disabled = false
    spinner?.classList.add('d-none')
  }
}

function applyTickerRenames(csv: string, rows: readonly HTMLTableRowElement[]): string {
  let text = csv
  for (const tr of rows) {
    const field = tr.querySelector<HTMLInputElement>('.asset-field[data-field="ticker"]')
    if (field === null) continue
    const original = (field.dataset['originalTicker'] ?? '').toUpperCase()
    const current = field.value.trim().toUpperCase()
    if (original === '' || current === '' || original === current) continue

    text = text
      .split('\n')
      .map((line) => {
        const cols = line.split('\t')
        if (cols[0]?.trim().toUpperCase() === original) {
          cols[0] = current
          return cols.join('\t')
        }
        return line
      })
      .join('\n')
  }
  return text
}

/** Etapa 2 → importa. Linhas marcadas para ignorar ficam de fora. */
async function submitBatch(): Promise<void> {
  const table = byId<HTMLTableElement>('csvPreviewTable')
  if (table === null) return

  const rows: Array<Record<string, string | number>> = []
  for (const tr of Array.from(table.tBodies[0]?.rows ?? [])) {
    if (tr.querySelector<HTMLInputElement>('.csv-ignore-check')?.checked === true) continue

    const fields = Array.from(
      tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.csv-field'),
    )
    if (fields.length === 0) continue

    const row: Record<string, string | number> = {}
    for (const field of fields) {
      const key = field.dataset['field']
      if (key === undefined) continue
      row[key] =
        key === 'quantity' || key === 'price' || key === 'fees'
          ? Number.parseFloat(field.value) || 0
          : field.value
    }
    rows.push(row)
  }

  if (rows.length === 0) {
    setPreview('<div class="alert alert-warning">Nenhuma linha válida para importar.</div>')
    return
  }

  const payload: Record<string, unknown> = { rows }
  if (pendingNewAssets.length > 0) payload['assets'] = pendingNewAssets

  try {
    const response = await fetch('/transactions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`Erro ao importar: ${response.status}`)
    location.href = '/transactions/'
  } catch (error) {
    setPreviewError(error)
  }
}

function setPreview(html: string): void {
  const area = byId('csv-preview-area')
  if (area !== null) area.innerHTML = html
}

function setPreviewError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const area = byId('csv-preview-area')
  if (area !== null) {
    area.textContent = ''
    const alert = document.createElement('div')
    alert.className = 'alert alert-danger'
    alert.textContent = message
    area.appendChild(alert)
  }
}
