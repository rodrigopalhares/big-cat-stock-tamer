import type { IsoDate } from '../../shared/iso-date.js'

/** O que a comparação com o CDI entrega para a tela. */
export type CdiComparison = {
  /** Saldo hoje da conta hipotética que recebeu os mesmos aportes rendendo CDI. */
  cdiValue: number
  /** Valor de mercado da carteira, repetido aqui para a view não precisar cruzar dados. */
  portfolioValue: number
  /** Carteira menos sombra. Positivo é a carteira à frente do CDI. */
  difference: number
  /** 1.21 = a carteira vale 121% do que valeria no CDI. Null quando a sombra é zero. */
  ratioOfCdi: number | null
  /** TIR anual da sombra, sobre exatamente o mesmo cronograma de fluxos da carteira. */
  cdiIrrAnnual: number | null
  /** A mesma TIR ao mês, derivada da anual como a da carteira. */
  cdiIrrMonthly: number | null
  /**
   * Último dia com taxa gravada. Série defasada rende menos e favorece a carteira, então
   * a tela mostra até onde a conta foi de fato.
   */
  lastRateDate: IsoDate | null
}
