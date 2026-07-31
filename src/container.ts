import type { Db } from './config/db.js'
import type { Env } from './config/env.js'
import { BackupService } from './infra/backup.js'
import { AnthropicClient } from './integrations/anthropic/anthropic.client.js'
import { AssetInfoClient } from './integrations/asset-info.client.js'
import { BcbClient } from './integrations/bcb/bcb.client.js'
import { BROWSER_USER_AGENT, HttpClient, type Logger, silentLogger } from './integrations/http.js'
import { TesouroClient } from './integrations/tesouro/tesouro.client.js'
import { YahooClient } from './integrations/yahoo/yahoo.client.js'
import { AllocationService } from './modules/allocation/allocation.service.js'
import { AssetClassService } from './modules/allocation/asset-class.service.js'
import { AssetService } from './modules/asset/asset.service.js'
import { AuthService } from './modules/auth/auth.service.js'
import { BrokerNoteService } from './modules/broker-note/broker-note.service.js'
import { CsvImportService } from './modules/csv-import/csv-import.service.js'
import { DividendService } from './modules/dividend/dividend.service.js'
import { EvolutionService } from './modules/evolution/evolution.service.js'
import { ExchangeRateService } from './modules/exchange-rate/exchange-rate.service.js'
import { PortfolioService } from './modules/portfolio/portfolio.service.js'
import { PriceHistoryService } from './modules/price-history/price-history.service.js'
import { BenchmarkService } from './modules/risk/benchmark.service.js'
import { RiskMetricsService } from './modules/risk/risk-metrics.service.js'
import { TransactionService } from './modules/transaction/transaction.service.js'

/**
 * Composition root — o equivalente ao container do Spring, em vinte linhas explícitas.
 *
 * A ordem aqui é a ordem de dependência real. Se der ciclo, o TypeScript acusa na hora,
 * em vez de virar erro de runtime como acontecia com a injeção por anotação.
 */
export function buildContainer(db: Db, env: Env, logger: Logger = silentLogger) {
  const yahooHttp = new HttpClient({ userAgent: BROWSER_USER_AGENT, logger })
  const plainHttp = new HttpClient({ logger })

  const yahoo = new YahooClient({ http: yahooHttp, logger })
  const bcb = new BcbClient({ http: plainHttp, logger })
  const tesouro = new TesouroClient({ http: plainHttp, logger })
  const assetInfo = new AssetInfoClient(yahoo, tesouro)

  const exchangeRates = new ExchangeRateService(db, bcb, logger)
  // Vem antes dos três serviços que criam ativo — é quem diz a classe padrão do tipo.
  const assetClasses = new AssetClassService(db)
  const assets = new AssetService(db, assetClasses)
  const transactions = new TransactionService(db, assetInfo, exchangeRates, assetClasses)
  const dividends = new DividendService(db, transactions, exchangeRates)
  const priceHistory = new PriceHistoryService(db, yahoo, tesouro, logger)
  const portfolio = new PortfolioService(db, yahoo, tesouro, priceHistory, dividends, exchangeRates)
  const allocation = new AllocationService(db, portfolio, assetClasses)
  const evolution = new EvolutionService(db, priceHistory, assets, logger)
  const benchmarks = new BenchmarkService(db, yahoo, bcb, logger)
  const riskMetrics = new RiskMetricsService(db, benchmarks, logger)
  const csvImport = new CsvImportService(db, assetInfo, transactions, dividends, assetClasses)

  const anthropic = new AnthropicClient({ apiKey: env.APP_ANTHROPIC_API_KEY, logger })
  const brokerNotes = new BrokerNoteService(db, anthropic, env.notesDir)

  const auth = new AuthService({
    password: env.APP_AUTH_PASSWORD,
    keyFile: env.authKeyFile,
    sessionDays: env.APP_AUTH_SESSION_DAYS,
    logger,
  })
  const backup = new BackupService(db, {
    enabled: env.APP_BACKUP_ENABLED,
    dir: env.backupDir,
    dailyCopies: env.APP_BACKUP_DAILY_COPIES,
    monthlyCopies: env.APP_BACKUP_MONTHLY_COPIES,
    databaseUrl: env.DATABASE_URL,
    logger,
  })

  return {
    db,
    yahoo,
    bcb,
    tesouro,
    assetInfo,
    assets,
    assetClasses,
    allocation,
    transactions,
    dividends,
    exchangeRates,
    priceHistory,
    portfolio,
    evolution,
    benchmarks,
    riskMetrics,
    csvImport,
    anthropic,
    brokerNotes,
    auth,
    backup,
  } as const
}

export type Container = ReturnType<typeof buildContainer>
