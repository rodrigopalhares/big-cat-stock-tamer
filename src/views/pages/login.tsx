import { BareLayout } from '../layout.js'

/** Porte de src/main/resources/templates/login.html. */

export type LoginError = 'invalid' | 'blocked'

export type LoginPageProps = {
  error?: LoginError
  /** Quanto falta do bloqueio, em segundos. Só usado quando `error` é 'blocked'. */
  retryAfterSeconds?: number
}

export function LoginPage({ error, retryAfterSeconds = 0 }: LoginPageProps) {
  return (
    <BareLayout title="Entrar — Carteira">
      <div class="d-flex align-items-center justify-content-center" style="min-height: 100vh;">
        <div class="card shadow-sm" style="width: 100%; max-width: 380px;">
          <div class="card-body p-4">
            <div class="text-center mb-4">
              <i class="bi bi-graph-up-arrow fs-1 text-primary" />
              <h1 class="h4 mt-2 mb-0 fw-bold">Carteira de Ações</h1>
              <p class="text-secondary small mb-0">Acesso restrito</p>
            </div>

            {error === 'invalid' && (
              <div class="alert alert-danger py-2 small" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-1" /> Senha incorreta.
              </div>
            )}

            {error === 'blocked' && (
              <div class="alert alert-warning py-2 small" role="alert">
                <i class="bi bi-shield-lock-fill me-1" /> Muitas tentativas erradas. Tente de novo
                em {waitLabel(retryAfterSeconds)}.
              </div>
            )}

            <form method="post" action="/login">
              <div class="mb-3">
                <label for="password" class="form-label">
                  Senha
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  class="form-control"
                  autofocus
                  required
                  autocomplete="current-password"
                />
              </div>
              <button type="submit" class="btn btn-primary w-100">
                <i class="bi bi-box-arrow-in-right me-1" /> Entrar
              </button>
            </form>
          </div>
        </div>
      </div>
    </BareLayout>
  )
}

/** Arredonda para cima: "em 0 minutos" mandaria tentar de novo antes da hora. */
function waitLabel(seconds: number): string {
  if (seconds <= 60) return 'um minuto'
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minutos`
}
