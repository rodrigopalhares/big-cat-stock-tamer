-- CreateTable
CREATE TABLE "broker_notes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "broker" TEXT,
    "note_number" TEXT,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "total_amount" REAL NOT NULL,
    "total_fees" REAL NOT NULL DEFAULT 0,
    "csv" TEXT NOT NULL,
    "warning" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transactions" (
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
    "broker_note_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transactions_broker_note_id_fkey" FOREIGN KEY ("broker_note_id") REFERENCES "broker_notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("asset_id", "broker", "created_at", "currency", "date", "fees", "fees_brl", "id", "notes", "price", "price_brl", "quantity", "type") SELECT "asset_id", "broker", "created_at", "currency", "date", "fees", "fees_brl", "id", "notes", "price", "price_brl", "quantity", "type" FROM "transactions";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
CREATE INDEX "transactions_asset_id_idx" ON "transactions"("asset_id");
CREATE INDEX "transactions_broker_note_id_idx" ON "transactions"("broker_note_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "broker_notes_date_idx" ON "broker_notes"("date");
