-- CreateTable
CREATE TABLE "asset_classes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "target_percent" REAL NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#6c757d',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "asset_class_id" INTEGER,
    "quantity" REAL NOT NULL DEFAULT 0,
    "avg_price" REAL NOT NULL DEFAULT 0,
    "avg_price_brl" REAL NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,
    "total_cost_brl" REAL NOT NULL DEFAULT 0,
    "realized_pnl" REAL NOT NULL DEFAULT 0,
    "realized_pnl_brl" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assets_asset_class_id_fkey" FOREIGN KEY ("asset_class_id") REFERENCES "asset_classes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_assets" ("avg_price", "avg_price_brl", "created_at", "currency", "delisted", "has_position", "name", "quantity", "realized_pnl", "realized_pnl_brl", "ticker", "total_cost", "total_cost_brl", "type", "yf_ticker") SELECT "avg_price", "avg_price_brl", "created_at", "currency", "delisted", "has_position", "name", "quantity", "realized_pnl", "realized_pnl_brl", "ticker", "total_cost", "total_cost_brl", "type", "yf_ticker" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE INDEX "assets_asset_class_id_idx" ON "assets"("asset_class_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "asset_classes_name_key" ON "asset_classes"("name");

-- As 5 classes iniciais, 20% cada. A cor repete a do tipo predominante da classe em
-- src/shared/asset-colors.ts, para o azul de STOCK continuar sendo o azul de "Ações".
INSERT INTO "asset_classes" ("name", "target_percent", "color") VALUES
    ('Ações', 20, '#36a2eb'),
    ('Renda Fixa', 20, '#795548'),
    ('Internacional', 20, '#66bb6a'),
    ('Fii', 20, '#9966ff'),
    ('Crypto', 20, '#ff6384');

-- Classifica o que já está cadastrado pelo tipo. O mesmo mapa vive em
-- src/domain/asset-class.ts e vale para ativo novo — os dois precisam concordar.
-- OUTROS fica sem classe de propósito: o CASE não casa, o subselect devolve NULL e o
-- ativo aparece no balde "Sem classe" da tela, que é onde se decide o que fazer com ele.
UPDATE "assets"
SET "asset_class_id" = (
    SELECT "id" FROM "asset_classes" WHERE "name" = CASE "assets"."type"
        WHEN 'STOCK' THEN 'Ações'
        WHEN 'RENDA_FIXA' THEN 'Renda Fixa'
        WHEN 'TESOURO_DIRETO' THEN 'Renda Fixa'
        WHEN 'ETF' THEN 'Internacional'
        WHEN 'BDR' THEN 'Internacional'
        WHEN 'INTERNATIONAL' THEN 'Internacional'
        WHEN 'CRYPTO' THEN 'Crypto'
        WHEN 'REIT' THEN 'Fii'
    END
);
