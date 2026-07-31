/**
 * Comportamentos de página, por delegação de evento.
 *
 * Substitui os handlers inline (`onclick="..."`, `onchange="this.form.submit()"`) dos
 * templates Thymeleaf. Delegar tem três vantagens sobre o inline: funciona em conteúdo
 * inserido pelo HTMX depois do carregamento, não exige `unsafe-inline` no CSP, e os
 * tipos do JSX não precisam aceitar string onde esperam função.
 */

declare const bootstrap: { Modal: new (el: Element) => { show: () => void } }

document.addEventListener('input', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.dataset['uppercase'] !== undefined) {
    target.value = target.value.toUpperCase()
  }
})

document.addEventListener('change', (event) => {
  const target = event.target
  if (target instanceof HTMLSelectElement && target.dataset['autosubmit'] !== undefined) {
    target.form?.submit()
  }
})

document.addEventListener('submit', (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  const message = form.dataset['confirm']
  if (message !== undefined && !confirm(message)) event.preventDefault()
})

document.addEventListener('click', (event) => {
  const target = event.target as Element | null

  const editTrigger = target?.closest<HTMLElement>('[data-edit-asset]')
  if (editTrigger !== null && editTrigger !== undefined) {
    openEditAssetModal(editTrigger)
    return
  }

  const newClassTrigger = target?.closest<HTMLElement>('[data-new-class]')
  if (newClassTrigger !== null && newClassTrigger !== undefined) {
    openAssetClassModal(null)
    return
  }

  const editClassTrigger = target?.closest<HTMLElement>('[data-edit-class]')
  if (editClassTrigger !== null && editClassTrigger !== undefined) {
    openAssetClassModal(editClassTrigger)
    return
  }

  if (target?.closest('[data-theme-toggle]') !== null) toggleTheme()
})

// --- tema (era static/js/theme.js, que dependia de um `toggleTheme` global) ---

function toggleTheme(): void {
  const next = document.documentElement.dataset['bsTheme'] === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset['bsTheme'] = next
  localStorage.setItem('theme', next)
  updateThemeIcon(next)
}

function updateThemeIcon(theme: string | undefined): void {
  const icon = document.querySelector('#themeToggle i')
  if (icon !== null) {
    icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill'
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeIcon(document.documentElement.dataset['bsTheme'])
})

function openEditAssetModal(trigger: HTMLElement): void {
  const d = trigger.dataset
  const ticker = d['assetTicker'] ?? ''

  setText('editModalTicker', ticker)
  setAction('editAssetForm', `/assets/${ticker}/edit`)
  setValue('editName', d['assetName'] ?? '')
  setValue('editYfTicker', d['assetYfTicker'] ?? '')
  selectOption('editType', d['assetType'] || 'STOCK')
  selectOption('editCurrency', d['assetCurrency'] || 'BRL')
  setChecked('editDelisted', d['assetDelisted'] === 'true')

  const modal = document.getElementById('editAssetModal')
  if (modal !== null) new bootstrap.Modal(modal).show()
}

/**
 * Um modal só para criar e editar classe de alocação — sem trigger é "nova".
 * Dois modais quase iguais na mesma página é o que gera id duplicado e campo que não
 * limpa entre uma abertura e outra.
 */
function openAssetClassModal(trigger: HTMLElement | null): void {
  const d = trigger?.dataset
  const id = d?.['classId'] ?? ''

  setText('assetClassModalTitle', id === '' ? 'Nova classe' : 'Editar classe')
  setAction(
    'assetClassForm',
    id === '' ? '/allocation/classes/new' : `/allocation/classes/${id}/edit`,
  )
  setValue('className', d?.['className'] ?? '')
  setValue('classTarget', d?.['classTarget'] ?? '0')
  setValue('classColor', d?.['classColor'] ?? '#6c757d')

  const modal = document.getElementById('assetClassModal')
  if (modal !== null) new bootstrap.Modal(modal).show()
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id)
  if (el !== null) el.textContent = value
}

function setValue(id: string, value: string): void {
  const el = document.getElementById(id)
  if (el instanceof HTMLInputElement) el.value = value
}

function setChecked(id: string, checked: boolean): void {
  const el = document.getElementById(id)
  if (el instanceof HTMLInputElement) el.checked = checked
}

function setAction(id: string, action: string): void {
  const el = document.getElementById(id)
  if (el instanceof HTMLFormElement) el.action = action
}

function selectOption(id: string, value: string): void {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLSelectElement)) return
  for (const option of Array.from(el.options)) option.selected = option.value === value
}

// --- tooltips do Bootstrap (era um <script> inline em risk-metrics.html) ---

document.addEventListener('DOMContentLoaded', () => {
  const bs = (globalThis as { bootstrap?: { Tooltip: new (el: Element) => unknown } }).bootstrap
  if (bs === undefined) return
  for (const el of Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]'))) {
    new bs.Tooltip(el)
  }
})

// --- botão que dispara HTMX e recarrega a página (era hx-on::before/after-request) ---

document.addEventListener('htmx:beforeRequest', (event) => {
  const el = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-busy-label]')
  if (el === null || el === undefined) return
  el.dataset['idleHtml'] = el.innerHTML
  el.disabled = true
  el.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> ${el.dataset['busyLabel']}`
})

document.addEventListener('htmx:afterRequest', (event) => {
  const el = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-busy-label]')
  if (el === null || el === undefined) return
  el.disabled = false
  el.innerHTML = el.dataset['idleHtml'] ?? el.innerHTML

  const successful = (event as CustomEvent<{ successful?: boolean }>).detail?.successful
  if (successful === true && el.dataset['reloadOnSuccess'] !== undefined) location.reload()
})
