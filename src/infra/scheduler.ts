import { Cron } from 'croner'
import type { Logger } from '../integrations/http.js'
import { silentLogger } from '../integrations/http.js'
import type { CdiService } from '../modules/cdi/cdi.service.js'
import type { ExchangeRateService } from '../modules/exchange-rate/exchange-rate.service.js'
import type { PriceHistoryService } from '../modules/price-history/price-history.service.js'
import type { BackupService } from './backup.js'

/**
 * Jobs agendados.
 * Porte de src/main/kotlin/com/stocks/config/SchedulerConfig.kt.
 *
 * Fuso fixo em America/Sao_Paulo: os horários existem em função do pregão brasileiro,
 * então precisam acompanhar o horário local mesmo se o servidor estiver em UTC.
 */

const TIMEZONE = 'America/Sao_Paulo'

export type SchedulerDeps = {
  priceHistory: PriceHistoryService
  exchangeRates: ExchangeRateService
  cdi: CdiService
  backup: BackupService
  logger?: Logger
}

export type Scheduler = {
  /** Encerra os jobs — usado no shutdown e nos testes. */
  stop: () => void
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const logger = deps.logger ?? silentLogger

  /** Um job que falha não pode derrubar o processo nem impedir o próximo disparo. */
  const guard = (label: string, run: () => Promise<void>) => async () => {
    logger.info(`Iniciando: ${label}`)
    try {
      await run()
    } catch (error) {
      logger.error(`Erro em ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const jobs = [
    // Depois do fechamento do pregão.
    new Cron(
      '0 30 18 * * *',
      { timezone: TIMEZONE },
      guard('atualização diária de preços', async () => {
        await deps.priceHistory.runDailyUpdate()
        await deps.exchangeRates.getRate('USD')
        // O CDI do dia sai à noite e às 18:30 às vezes ainda não existe. Não precisa de
        // tratamento: o backfill retoma do último dia gravado e o pega amanhã.
        await deps.cdi.runBackfill()
      }),
    ),
    // Logo depois da meia-noite, com folga para o dia virar no fuso configurado.
    new Cron(
      '0 5 0 * * *',
      { timezone: TIMEZONE },
      guard('backup diário', () => deps.backup.ensureBackups()),
    ),
  ]

  // Backup no boot: reiniciar sempre deixa um snapshot recente para trás.
  void guard('backup de inicialização', () => deps.backup.ensureBackups())()

  return {
    stop: () => {
      for (const job of jobs) job.stop()
    },
  }
}
