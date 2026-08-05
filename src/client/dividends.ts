/**
 * Modal de edição e importação de CSV de proventos.
 * Porte de static/js/dividends.js.
 */

declare const bootstrap: { Modal: new (el: Element) => { show: () => void } }

const byId = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null
const setValue = (id: string, value: string): void => {
  const el = byId<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id)
  if (el !== null) el.value = value
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null

  const trigger = target?.closest<HTMLElement>('[data-edit-div], [data-new-div]')
  if (trigger !== null && trigger !== undefined) {
    openDivModal(trigger, trigger.dataset['newDiv'] !== undefined)
    return
  }

  if (target?.closest('[data-div-csv-batch-submit]') !== null) void submitBatch()
  else if (target?.closest('[data-div-xlsx-parse]') !== null) void parseXlsx()
})

/** Envia o extrato da B3 e joga o preview na mesma área que o CSV colado usa. */
async function parseXlsx(): Promise<void> {
  const file = byId<HTMLInputElement>('divXlsxFile')?.files?.[0]
  const area = byId('div-csv-preview-area')
  if (area === null) return
  if (file === undefined) {
    showError(area, 'Selecione o arquivo do extrato.')
    return
  }

  const spinner = byId('divXlsxSpinner')
  const button = document.querySelector<HTMLButtonElement>('[data-div-xlsx-parse]')
  if (button !== null) button.disabled = true
  spinner?.classList.remove('d-none')
  area.innerHTML = ''

  const body = new FormData()
  body.append('file', file)

  try {
    const response = await fetch('/dividends/parse-xlsx', { method: 'POST', body })
    const text = await response.text()
    if (!response.ok) throw new Error(text === '' ? `Erro ${response.status}` : text)
    area.innerHTML = text
  } catch (error) {
    showError(area, error instanceof Error ? error.message : String(error))
  } finally {
    if (button !== null) button.disabled = false
    spinner?.classList.add('d-none')
  }
}

function showError(area: HTMLElement, message: string): void {
  area.textContent = ''
  const alert = document.createElement('div')
  alert.className = 'alert alert-danger'
  alert.textContent = message
  area.appendChild(alert)
}

/**
 * O mesmo modal serve para criar e para editar. Quem cria é a tela do ativo, onde o ticker
 * já está decidido — ele vai num campo escondido, junto com o `returnTo` que traz de volta
 * para a mesma tela. Os valores iniciais saem dos `data-div-*` do próprio botão.
 */
function openDivModal(trigger: HTMLElement, isNew: boolean): void {
  const d = trigger.dataset
  const form = byId<HTMLFormElement>('editDivForm')
  if (form === null) return

  form.action = isNew ? '/dividends/new' : `/dividends/${d['divId']}/edit`
  setValue('editDivType', d['divType'] ?? '')
  setValue('editDivCurrency', d['divCurrency'] || 'BRL')
  setValue('editDivTotalAmount', d['divTotalAmount'] ?? '')
  setValue('editDivTaxWithheld', d['divTaxWithheld'] ?? '')
  setValue('editDivDate', d['divDate'] ?? '')
  setValue('editDivNotes', d['divNotes'] ?? '')

  setHiddenField(form, 'editDivTicker', 'ticker', isNew ? (d['ticker'] ?? '') : '')
  setHiddenField(form, 'editDivReturnTo', 'returnTo', d['returnTo'] ?? '')

  const title = byId('editDivModalTitle')
  if (title !== null) title.textContent = isNew ? 'Novo Provento' : 'Editar Provento'
  byId('editDivModalIcon')?.setAttribute('class', `bi ${isNew ? 'bi-plus-circle' : 'bi-pencil'}`)

  const modal = byId('editDivModal')
  if (modal !== null) new bootstrap.Modal(modal).show()
}

/**
 * Campo escondido que só existe quando tem valor — enviar `returnTo` vazio redirecionaria
 * para lugar nenhum.
 */
function setHiddenField(form: HTMLFormElement, id: string, name: string, value: string): void {
  byId(id)?.remove()
  if (value === '') return

  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = name
  input.id = id
  input.value = value
  form.appendChild(input)
}

async function submitBatch(): Promise<void> {
  const table = byId<HTMLTableElement>('divCsvPreviewTable')
  const area = byId('div-csv-preview-area')
  if (table === null || area === null) return

  const rows: Array<Record<string, string | number>> = []
  for (const tr of Array.from(table.tBodies[0]?.rows ?? [])) {
    if (tr.querySelector<HTMLInputElement>('.div-csv-ignore-check')?.checked === true) continue

    const row: Record<string, string | number> = {}
    for (const field of Array.from(
      tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.div-csv-field'),
    )) {
      const key = field.dataset['field']
      if (key === undefined) continue
      row[key] =
        key === 'totalAmount' || key === 'taxWithheld'
          ? Number.parseFloat(field.value) || 0
          : field.value
    }
    rows.push(row)
  }

  if (rows.length === 0) {
    area.innerHTML = '<div class="alert alert-warning">Nenhuma linha válida para importar.</div>'
    return
  }

  try {
    const response = await fetch('/dividends/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    if (!response.ok) throw new Error(`Erro ao importar: ${response.status}`)
    location.href = '/dividends/'
  } catch (error) {
    showError(area, error instanceof Error ? error.message : String(error))
  }
}
