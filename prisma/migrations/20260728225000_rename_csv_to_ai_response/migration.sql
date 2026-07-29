-- Renomeia broker_notes.csv para ai_response, preservando o conteúdo das notas já
-- importadas. Escrita à mão porque o `migrate dev` trataria a troca como coluna nova e
-- descartaria o que estava gravado.
--
-- Nas linhas anteriores a esta migração o campo guarda o CSV derivado, não a resposta do
-- modelo — a resposta crua só passa a ser arquivada daqui para frente.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_broker_notes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "broker" TEXT,
    "note_number" TEXT,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "total_amount" REAL NOT NULL,
    "total_fees" REAL NOT NULL DEFAULT 0,
    "ai_response" TEXT NOT NULL,
    "warning" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_broker_notes" ("id", "date", "broker", "note_number", "file_name", "original_name", "total_amount", "total_fees", "ai_response", "warning", "created_at") SELECT "id", "date", "broker", "note_number", "file_name", "original_name", "total_amount", "total_fees", "csv", "warning", "created_at" FROM "broker_notes";
DROP TABLE "broker_notes";
ALTER TABLE "new_broker_notes" RENAME TO "broker_notes";
CREATE INDEX "broker_notes_date_idx" ON "broker_notes"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
