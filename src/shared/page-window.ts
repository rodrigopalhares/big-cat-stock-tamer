/**
 * Janela de uma lista com rolagem infinita: a tela recebe a primeira página no HTML e a
 * linha-sentinela do fim pede as seguintes por `offset`. Sem janela, a consulta traz tudo —
 * é o que a tela do ativo e a API continuam fazendo.
 */
export type PageWindow = {
  limit: number
  offset: number
}
