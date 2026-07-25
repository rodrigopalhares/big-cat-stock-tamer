import { BareLayout } from '../layout.js'

/** Porte de src/main/resources/templates/login.html. */
export function LoginPage({ error = false }: { error?: boolean }) {
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

            {error && (
              <div class="alert alert-danger py-2 small" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-1" /> Senha incorreta.
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
