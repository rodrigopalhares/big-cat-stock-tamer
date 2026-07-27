/**
 * Cor por tipo de ativo — fonte única para os gráficos do dashboard e para os badges.
 *
 * Antes eram duas paletas independentes: o gráfico de evolução tinha um mapa rgb em
 * `client/dashboard.ts` e o badge usava classes utilitárias do Bootstrap em
 * `views/components/badge.tsx`. O mesmo REIT saía roxo no gráfico e verde na tabela, e
 * quatro tipos sem entrada caíam todos no mesmo cinza. Um mapa só resolve os dois.
 */

type Rgb = readonly [number, number, number]

const ASSET_TYPE_RGB: Readonly<Record<string, Rgb>> = {
  BDR: [255, 159, 64],
  CRYPTO: [255, 99, 132],
  ETF: [75, 192, 192],
  INTERNATIONAL: [102, 187, 106],
  OUTROS: [201, 203, 207],
  REIT: [153, 102, 255],
  RENDA_FIXA: [121, 85, 72],
  STOCK: [54, 162, 235],
  TESOURO_DIRETO: [255, 205, 86],
}

/** Tipo desconhecido cai no mesmo cinza de OUTROS. */
const FALLBACK: Rgb = [201, 203, 207]

function rgbOf(type: string): Rgb {
  return ASSET_TYPE_RGB[type] ?? FALLBACK
}

/** Cor sólida — borda de série e fundo de badge. */
export function assetTypeColor(type: string): string {
  const [r, g, b] = rgbOf(type)
  return `rgb(${r}, ${g}, ${b})`
}

/** A mesma cor translúcida, para o preenchimento de área e de barra. */
export function assetTypeFill(type: string, alpha = 0.6): string {
  const [r, g, b] = rgbOf(type)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Preto ou branco sobre a cor do tipo, o que tiver mais contraste.
 * Luminância percebida (ITU-R BT.601) — é o que impede texto branco no amarelo do Tesouro.
 */
export function assetTypeTextColor(type: string): string {
  const [r, g, b] = rgbOf(type)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#212529' : '#fff'
}
