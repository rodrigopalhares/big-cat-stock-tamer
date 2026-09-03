/**
 * Destino de redirect vindo do usuário.
 *
 * Os formulários mandam `returnTo` para o service voltar à tela de origem — a tela do ativo
 * manda `/assets/PETR4`, a lista manda vazio. O campo é do usuário, e ia direto para o
 * `reply.redirect()`: `returnTo=https://...` mandava o navegador para fora do domínio *depois*
 * de uma operação bem-sucedida, que é o contexto de maior confiança para pedir a senha de novo.
 *
 * Destino inválido cai no padrão em silêncio. Não é erro do usuário digitando: ou o valor veio
 * da própria interface e é interno, ou veio de um link preparado e não deve ser obedecido.
 *
 * Vazio conta como ausente, não como destino — `redirect('')` seria resolvido pelo navegador
 * relativo à URL do POST, parando em `/assets/PETR4/edit`, que só aceita POST.
 */

/**
 * `//host` e `/\host` parecem caminho relativo e o navegador os lê como URL absoluta — é a
 * forma que passa despercebida numa revisão. Uma barra, seguida de coisa que não seja barra
 * nem contrabarra.
 */
const INTERNAL_PATH = /^\/(?![/\\])\S*$/

/**
 * O `\S` da expressão acima já barra espaço e quebra de linha, mas não os outros caracteres
 * de controle — e escrevê-los na regex esbarra no `noControlCharactersInRegex` do Biome.
 * Fora da regex, a checagem fica explícita e testável.
 */
function hasControlChar(value: string): boolean {
  return [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
  })
}

export function internalPath(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return fallback
  return INTERNAL_PATH.test(trimmed) && !hasControlChar(trimmed) ? trimmed : fallback
}
