import { isTesouroTicker } from '../domain/tesouro-ticker.js'
import type { TesouroClient } from './tesouro/tesouro.client.js'
import type { AssetInfo, YahooClient } from './yahoo/yahoo.client.js'

/**
 * Decide onde identificar um ticker: Tesouro Transparente para os títulos públicos,
 * Yahoo para o resto.
 *
 * Existe para não espalhar esse `if` pelos seis lugares que precisam identificar um ativo
 * (cadastro, transação, importação de CSV) e para manter os dois clientes ignorantes um do
 * outro — foi justamente a mistura dos dois num arquivo só que a migração desfez.
 */

/** O mínimo que um service precisa para identificar um ticker. */
export type AssetInfoLookup = {
  fetchAssetInfo(ticker: string): Promise<AssetInfo>
}

/**
 * `AssetInfo` com o que só o Tesouro tem a dizer: os outros vencimentos do mesmo título no
 * ano pedido. Vazio no caso normal — títulos antigos, que venciam mais de uma vez por ano,
 * são os únicos que precisam do aviso.
 */
export type ResolvedAssetInfo = AssetInfo & { readonly alternatives: readonly string[] }

export class AssetInfoClient implements AssetInfoLookup {
  constructor(
    private readonly yahoo: YahooClient,
    private readonly tesouro: TesouroClient,
  ) {}

  async fetchAssetInfo(ticker: string): Promise<ResolvedAssetInfo> {
    if (!isTesouroTicker(ticker)) {
      return { ...(await this.yahoo.fetchAssetInfo(ticker)), alternatives: [] }
    }

    const info = await this.tesouro.fetchAssetInfo(ticker)
    if (info !== null) return info

    // Não achou no CSV. Perguntar ao Yahoo seria pior que não responder — ele não tem título
    // público e devolveria lixo. `name === ticker` é o contrato de "não encontrado".
    return { name: ticker, type: 'TESOURO_DIRETO', yfTicker: '', currency: 'BRL', alternatives: [] }
  }
}
