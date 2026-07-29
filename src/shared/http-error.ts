/**
 * Substitui o ResponseStatusException do Spring.
 *
 * Lançado pelos services; traduzido para resposta HTML ou JSON num único
 * lugar (src/plugins/errors.ts), que decide o formato pelo Accept/HX-Request.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }

  static notFound(message: string): HttpError {
    return new HttpError(404, message)
  }

  static conflict(message: string): HttpError {
    return new HttpError(409, message)
  }

  static badRequest(message: string): HttpError {
    return new HttpError(400, message)
  }

  /** Falha de um serviço externo — a requisição estava certa, o de fora que não respondeu. */
  static badGateway(message: string): HttpError {
    return new HttpError(502, message)
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}
