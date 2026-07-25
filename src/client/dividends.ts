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

  const edit = target?.closest<HTMLElement>('[data-edit-div]')
  if (edit !== null && edit !== undefined) {
    openEditModal(edit)
    return
  }

  if (target?.closest('[data-div-csv-batch-submit]') !== null) void submitBatch()
})

function openEditModal(trigger: HTMLElement): void {
  const d = trigger.dataset
  const form = byId<HTMLFormElement>('editDivForm')
  if (form === null) return

  form.action = `/dividends/${d['divId']}/edit`
  setValue('editDivType', d['divType'] ?? '')
  setValue('editDivCurrency', d['divCurrency'] || 'BRL')
  setValue('editDivTotalAmount', d['divTotalAmount'] ?? '')
  setValue('editDivTaxWithheld', d['divTaxWithheld'] ?? '')
  setValue('editDivDate', d['divDate'] ?? '')
  setValue('editDivNotes', d['divNotes'] ?? '')

  const modal = byId('editDivModal')
  if (modal !== null) new bootstrap.Modal(modal).show()
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
    area.textContent = ''
    const alert = document.createElement('div')
    alert.className = 'alert alert-danger'
    alert.textContent = error instanceof Error ? error.message : String(error)
    area.appendChild(alert)
  }
}
