-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assets" (
    "ticker" TEXT NOT NULL PRIMARY KEY,
    "yf_ticker" TEXT,
    "name" TEXT,
    "type" TEXT NOT NULL DEFAULT 'STOCK',
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
INSERT INTO "new_assets" ("avg_price", "avg_price_brl", "created_at", "currency", "delisted", "has_position", "name", "quantity", "realized_pnl", "realized_pnl_brl", "ticker", "total_cost", "total_cost_brl", "type", "yf_ticker") SELECT "avg_price", "avg_price_brl", "created_at", "currency", "delisted", "has_position", "name", "quantity", "realized_pnl", "realized_pnl_brl", "ticker", "total_cost", "total_cost_brl", coalesce("type", 'STOCK') AS "type", "yf_ticker" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
