import { Layout } from '../layout.js'

/**
 * Página de erro com o menu de sempre e um caminho de volta.
 *
 * Antes o handler devolvia a mensagem em texto puro: sem layout, sem link, e no caso do
 * Zod um array JSON em inglês. Quem errava um campo ficava numa página branca com o botão
 * "voltar" do navegador como única saída.
 */

export type ErrorPageProps = {
  status: number
  title: string
  message: string
  /** Uma linha por campo inválido, já em português — só o 400 de validação preenche. */
  details: readonly string[]
  /** Complemento curto, ex.: "Nada foi gravado." */
  hint: string | null
  /** Caminho da requisição, para o menu; e para onde "Voltar" aponta. */
  path: string
  backHref: string
}

export function ErrorPage({
  status,
  title,
  message,
  details,
  hint,
  path,
  backHref,
}: ErrorPageProps) {
  const serverSide = status >= 500

  return (
    <Layout title={`${title} — Carteira`} path={path}>
      <div class="container py-5" style="max-width: 640px">
        <div class="card border-0 shadow-sm">
          <div class="card-body p-4 text-center">
            <i
              class={`bi ${serverSide ? 'bi-bug' : 'bi-exclamation-triangle'} fs-1 ${
                serverSide ? 'text-danger' : 'text-warning'
              }`}
            />
            <div class="text-muted small mt-2">Erro {status}</div>
            <h1 class="h4 fw-bold mt-1 mb-3">{title}</h1>
            <p class="mb-0">{message}</p>
            {details.length > 0 && (
              <ul class="list-unstyled text-start d-inline-block mt-3 mb-0">
                {details.map((line) => (
                  <li>
                    <i class="bi bi-dot" /> {line}
                  </li>
                ))}
              </ul>
            )}
            {hint !== null && <p class="text-muted small mt-3 mb-0">{hint}</p>}
            <div class="d-flex justify-content-center gap-2 mt-4">
              <a href={backHref} class="btn btn-primary">
                <i class="bi bi-arrow-left" /> Voltar
              </a>
              <a href="/portfolio/" class="btn btn-outline-secondary">
                <i class="bi bi-speedometer2" /> Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
