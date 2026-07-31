import type { ComponentChildren } from 'preact'

/**
 * Estrutura comum das páginas.
 * Porte de src/main/resources/templates/base.html — os fragmentos `head`, `navbar`
 * e `scripts` viram partes deste componente.
 */

const NAV_ITEMS = [
  { href: '/portfolio/', icon: 'bi-speedometer2', label: 'Dashboard' },
  { href: '/assets/', icon: 'bi-building', label: 'Ativos' },
  { href: '/allocation/', icon: 'bi-pie-chart', label: 'Alocação' },
  { href: '/transactions/', icon: 'bi-arrow-left-right', label: 'Transações' },
  { href: '/dividends/', icon: 'bi-cash-coin', label: 'Proventos' },
  { href: '/evolution/', icon: 'bi-graph-up', label: 'Evolução' },
  { href: '/risk-metrics/', icon: 'bi-shield-check', label: 'Risk Metrics' },
] as const

export type LayoutProps = {
  title: string
  /** Caminho da requisição, para marcar o item ativo do menu. */
  path: string
  children: ComponentChildren
}

export function Layout({ title, path, children }: LayoutProps) {
  return (
    <html lang="pt-BR">
      <Head title={title} />
      <body>
        <Navbar path={path} />
        {children}
        <Scripts />
      </body>
    </html>
  )
}

/** Página sem menu — usada só no login. */
export function BareLayout({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <html lang="pt-BR">
      <Head title={title} />
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function Head({ title }: { title: string }) {
  return (
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      {/* Define o tema antes da primeira pintura, para não piscar branco no modo escuro. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.documentElement.dataset.bsTheme=localStorage.getItem('theme')||" +
            "(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')",
        }}
      />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
      />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
      />
      <link rel="stylesheet" href="/css/custom.css" />
      <script src="https://unpkg.com/htmx.org@2.0.3" defer />
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" defer />
    </head>
  )
}

function Navbar({ path }: { path: string }) {
  return (
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand fw-bold" href="/portfolio/">
          <i class="bi bi-graph-up-arrow" /> Carteira
        </a>
        <button
          class="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navMenu"
        >
          <span class="navbar-toggler-icon" />
        </button>
        <div class="collapse navbar-collapse" id="navMenu">
          <ul class="navbar-nav me-auto">
            {NAV_ITEMS.map((item) => (
              <li class="nav-item">
                <a
                  class={`nav-link ${path.startsWith(item.href.slice(0, -1)) ? 'active' : ''}`}
                  href={item.href}
                >
                  <i class={`bi ${item.icon}`} /> {item.label}
                </a>
              </li>
            ))}
          </ul>
          <button
            id="themeToggle"
            class="btn btn-link nav-link px-2 me-2"
            type="button"
            data-theme-toggle
            title="Alternar tema"
          >
            <i class="bi bi-moon-fill" />
          </button>
          <span class="navbar-text text-secondary small me-3">
            <i class="bi bi-circle-fill text-success" style="font-size:0.5rem;" /> Fastify +
            TypeScript
          </span>
          <form method="post" action="/logout" class="d-inline">
            <button type="submit" class="btn btn-link nav-link px-2" title="Sair">
              <i class="bi bi-box-arrow-right" />
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}

function Scripts() {
  return (
    <>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" />
      <script src="/js/ui.js" defer />
    </>
  )
}
