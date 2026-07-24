-- CreateTable
CREATE TABLE "assets" (
    "ticker" TEXT NOT NULL PRIMARY KEY,
    "yf_ticker" TEXT,
    "name" TEXT,
    "type" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "delisted" BOOLEAN NOT NULL DEFAULT false,
    "has_position" BOOLEAN NOT NULL DEFAULT false,
    "quantity" REAL NOT NULL DEFAULT 0,
    "avg_price" REAL NOT NULL DEFAULT 0,
    "avg_price_brl" REAL NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,
    "total_cost_brl" REAL NOT NULL DEFAULT 0,
    "realized_pnl" REAL NOT NULL DEFAULT 0,
    "realized_pnl_brl" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "fees" REAL NOT NULL DEFAULT 0,
    "price_brl" REAL NOT NULL DEFAULT 0,
    "fees_brl" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "date" TEXT NOT NULL,
    "broker" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dividends" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "total_amount" REAL NOT NULL,
    "tax_withheld" REAL NOT NULL DEFAULT 0,
    "total_amount_brl" REAL NOT NULL DEFAULT 0,
    "tax_withheld_brl" REAL NOT NULL DEFAULT 0,
    "broker" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dividends_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "close" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "monthly_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "avg_price" REAL NOT NULL,
    "market_price" REAL NOT NULL,
    "total_cost" REAL NOT NULL,
    "market_value" REAL NOT NULL,
    "accumulated_net_dividends" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "monthly_snapshots_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "buy_rate" REAL NOT NULL,
    "sell_rate" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "benchmark_prices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "close" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "risk_metrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "calculated_at" TEXT NOT NULL,
    "beta" REAL,
    "alpha" REAL,
    "r_squared" REAL,
    "data_points" INTEGER NOT NULL,
    "cdi_annual" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "transactions_asset_id_idx" ON "transactions"("asset_id");

-- CreateIndex
CREATE INDEX "dividends_asset_id_idx" ON "dividends"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_price_history_asset_date" ON "price_history"("asset_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_monthly_snapshot_asset_month" ON "monthly_snapshots"("asset_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "uq_exchange_rate_date_pair" ON "exchange_rates"("date", "from_currency", "to_currency");

-- CreateIndex
CREATE UNIQUE INDEX "uq_benchmark_ticker_month" ON "benchmark_prices"("ticker", "month");

-- CreateIndex
CREATE UNIQUE INDEX "uq_risk_metrics_ticker_date" ON "risk_metrics"("ticker", "calculated_at");
