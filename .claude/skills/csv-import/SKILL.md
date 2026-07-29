---
name: csv-import
description: >
  Guide for modifying the CSV batch import flow for transactions.
  Use this skill whenever the user asks to change, fix, or extend the CSV import
  of transactions — adding/removing columns, changing validations, adjusting the
  UI of the import modal, modifying how assets are reviewed or transactions are
  previewed, changing the batch submit logic, or fixing bugs in the import flow.
  Also covers importing a broker note (nota de negociacao) PDF, which is read by
  the Anthropic API and feeds the same CSV pipeline.
  Trigger on mentions of: CSV import, importacao CSV, batch import, parse CSV,
  colar transacoes, importar planilha, etapa 1/2 do CSV, asset review, preview
  de transacoes, nota de negociacao, nota de corretagem, importar PDF, Anthropic,
  broker note.
---

# CSV Transaction Import Flow

This skill describes the architecture and file locations for the CSV batch import
feature so you can make targeted changes without exploring the codebase.

## Flow Overview

```
User pastes CSV ----------------------┐
                                      ├-> Step 1: Asset Review -> Step 2: Preview -> Batch Submit
User uploads broker note PDF -> CSV --┘
```

1. User pastes tab-separated text into a modal textarea
2. **Step 1** extracts distinct tickers, classifies them (EXISTS / WILL_CREATE / UNKNOWN),
   and shows an editable asset table where the user can rename tickers, change types, or
   ignore entire assets
3. **Step 2** parses every CSV line into transaction rows with validation. Error rows are
   editable and pre-marked as ignored. Ignored assets from step 1 carry over.
4. **Submit** sends valid, non-ignored rows + new assets as JSON to the backend, which
   persists everything in a single batch

The modal has two tabs. The **Nota de negociação** tab (hidden when `APP_ANTHROPIC_API_KEY`
is blank) uploads a broker note PDF, shows a preview, and the **Usar no CSV** button drops
the extracted CSV into the same textarea — from there the flow above is unchanged. See
[Broker Note Import](#broker-note-import-pdf) below.

## File Map

| File | Role |
|------|------|
| `src/modules/transaction/transaction.routes.ts` | Routes: `parse-csv`, `parse-csv-step2`, `batch` |
| `src/modules/transaction/transaction.service.ts` | `extractDistinctAssets()`, `parseCsvWithAssetLookup()`, `batchImport()` |
| `src/domain/csv/transaction-csv.ts` | DTOs: `CsvRow`, `CsvAssetRow`, `BatchRowRequest`, `AssetBatchRow`, `parseCsvRows()`, `parseBrazilianNumber()` |
| `src/integrations/yahoo/yahoo.client.ts` | `fetchAssetInfo()` — Yahoo Finance lookup for unknown tickers |
| `src/domain/ticker-classification.ts` | `classifyTicker()` — detects asset type from ticker pattern |
| `src/views/partials/csv-asset-review.tsx` | Step 1 UI — asset review table (JSX fragment) |
| `src/views/partials/csv-preview.tsx` | Step 2 UI — transaction preview table (JSX fragment) |
| `src/client/transactions.ts` | Client-side logic: `csvNextStep()`, `batchSubmit()`, ignore toggles, ticker change handlers |
| `src/domain/broker-note.ts` | Broker note: `groupTrades()`, `allocateFees()`, `checkTotal()`, `toCsv()` — pure |
| `src/integrations/anthropic/anthropic.client.ts` | Reads the note PDF with `claude-haiku-4-5` + structured output |
| `src/integrations/anthropic/anthropic.schema.ts` | Zod schema of the extraction; also the JSON Schema sent to the API |
| `src/modules/broker-note/broker-note.service.ts` | Saves the file, persists `BrokerNote`, serves the downloads |
| `src/views/partials/broker-note-preview.tsx` | Note preview fragment (grouped table + total check) |

## CSV Input Format

Tab-separated, one transaction per line. Columns by index:

| Index | Field | Example | Notes |
|-------|-------|---------|-------|
| 0 | Ticker | `PETR4` | Uppercased automatically |
| 1 | Date | `15/03/2025` | Brazilian format dd/MM/yyyy, converted to ISO |
| 2 | Type | `C`, `V`, `B`, `D`, `A`, `R.CAP` | Resolved through `TRANSACTION_TYPE_ALIASES` |
| 3 | Quantity | `1.000,50` | Brazilian number format |
| 4 | Unit Price | `28,45` | Brazilian number format |
| 5 | Taxes | `4,50` | Brazilian number format |
| 6 | Broker | `XP` | Free text |
| 7 | IRRF | `0,10` | Optional, added to fees |
| 8 | Currency | `BRL` | Defaults to BRL if missing |
| 9 | Notes | `Split` | Optional free text |

Parsing lives in `parseCsvRows()` and `parseSingleRow()` inside `transaction-csv.ts`.

### Transaction types in column 2

`normalizeType()` is a lookup into `TRANSACTION_TYPE_ALIASES` (`src/domain/constants.ts`) — add a
spelling there, not in the parser. What each type does with quantity, cost and cash flow lives in
the `TRANSACTION_TYPE_META` table in `src/shared/transaction-types.ts` — that map is the single
source of truth, read by the calculation, the views and the browser bundle alike.

| Column value | Type | Quantity column means | Price column means |
|---|---|---|---|
| `C`, `COMPRA`, `BUY` | BUY | shares bought | unit price paid |
| `V`, `VENDA`, `SELL` | SELL | shares sold | unit price received |
| `B`, `BN`, `BONIFICACAO` | BONIFICACAO | shares received | attributed unit cost (0 if blank) |
| `D`, `DESDOBRAMENTO`, `SPLIT` | DESDOBRAMENTO | shares **gained** (delta, not the new total) | ignored, forced to 0 |
| `A`, `AGRUPAMENTO`, `GRUPAMENTO`, `INPLIT` | AGRUPAMENTO | shares **lost** (delta) | ignored, forced to 0 |
| `R.CAP`, `RCAP`, `REDUCAO DE CAPITAL` | REDUCAO_CAPITAL | share base that received the payout (position is unchanged) | amount returned per share |

Two traps worth knowing:

- **The parser signs the quantity for preview only.** `AGRUPAMENTO` comes out negative there, but
  `batchImport()` passes `Math.abs()` and `insert()` re-derives the sign from the final type — so
  changing the type in the step-2 dropdown always yields the right sign.
- **Price and taxes are normalized server-side**, in `normalizePriceFees()` inside
  `transaction.service.ts`, not in the parser. A stray price on a `D`/`A` row is discarded, and
  taxes are zeroed for every type except BUY, SELL and R.CAP. This is the one enforcement point
  shared by the HTML form, the CSV batch and the JSON API.

## Key DTOs

```typescript
// Step 1 — asset review
type CsvAssetRow(ticker, name, type, yfTicker, currency, assetStatus: AssetStatus)

// Step 2 — transaction preview
type CsvRow(rowIndex, ticker, date, type, quantity, price, fees, broker, notes, currency, assetStatus, error?)

// Batch submit payload
type BatchRowRequest(ticker, date, type, quantity, price, fees, broker, notes, currency)
type AssetBatchRow(ticker, name, type, yfTicker, currency)
```

`AssetStatus` enum: `EXISTS`, `WILL_CREATE`, `UNKNOWN`.

## JavaScript Functions (transactions.js)

| Function | Purpose |
|----------|---------|
| `csvNextStep()` | Collects asset data from step 1 table, stores `pendingNewAssets` and `ignoredTickers`, replaces edited tickers in raw CSV, POSTs to `/parse-csv-step2`, then applies ignore styling to step 2 |
| `batchSubmit()` | Collects non-ignored rows from step 2 table, sends JSON `{ rows, assets }` to `/transactions/batch` |
| `onTickerChange(input)` | Called when user edits a ticker in step 1; fetches `/transactions/asset-info` and updates row fields |
| `onYfTickerChange(input)` | Called when user edits YF ticker; re-fetches asset info |
| `onAssetIgnoreToggle(checkbox)` | Toggles strikethrough styling on asset row |
| `onCsvRowIgnoreToggle(checkbox)` | Toggles strikethrough on transaction row, updates batch count |
| `updateBatchCount()` | Recounts non-ignored rows and updates the submit button label |

## Controller Endpoints

| Method | Path | Returns |
|--------|------|---------|
| POST | `/transactions/parse-csv` | Fragment `csv-asset-review :: csvAssetReview` |
| POST | `/transactions/parse-csv-step2` | Fragment `csv-preview :: csvPreview` |
| POST | `/transactions/batch` | JSON `{ inserted: N }` — optional `brokerNoteId` links the rows to a note |
| POST | `/transactions/parse-note` | multipart `file` → fragment `broker-note-preview` |
| GET | `/transactions/notes/:id` | The original PDF/image, as a download |
| GET | `/transactions/notes/:id/csv` | The extracted CSV, as a download |
| GET | `/transactions/asset-info?ticker=X` | JSON `{ name, type, yfTicker, currency }` |
| GET | `/transactions/ticker-info?ticker=X` | HTML snippet with ticker status |

## Broker Note Import (PDF)

A nota de negociação lists every execution separately — a single 329-share purchase can span
19 lines across 2 pages. The import turns that into one transaction per ticker.

```
upload -> AnthropicClient.extractBrokerNote() -> groupTrades() -> allocateFees()
       -> checkTotal() -> toCsv() -> persist BrokerNote + file -> preview fragment
```

Rules that matter when changing this:

- **Grouping key is ticker + side.** Day trade lists a buy and a sell of the same paper;
  merging them would produce a meaningless average price.
- **Fees are allocated by traded value** (`price × quantity` per ticker), never by quantity.
  The rounding residue goes to the largest ticker so the allocated fees sum exactly to the
  note's total.
- **The average price keeps 8 decimals in the CSV** (`91,64726444`). Two decimals would throw
  real money out of the position cost.
- **The total check is advisory.** `checkTotal()` compares `Σ value ± fees` against the
  declared net (plus on a buy note, minus on a sell note). A mismatch shows a warning, is
  stored in `broker_notes.warning`, and still lets the user import — the preview is editable.
- **Network before writes.** The Anthropic call happens before any DB write; SQLite has a
  single writer and holding the lock across an HTTP call would freeze the app.
- **The file name needs the row id**, so the row is inserted first and the file written
  after, at `${APP_NOTES_DIR}/<year>/<yyyyMMdd>_<id>.<ext>` (default `./data/notas`). If the
  write fails the row is deleted — a note without a file is a permanently broken download.

The extraction prompt lives in `SYSTEM_PROMPT` (`anthropic.client.ts`) and the field
descriptions in `anthropic.schema.ts` — those descriptions go into the JSON Schema and are
what actually steer the extraction, so changing them changes the result.

`Transaction.brokerNoteId` is what puts the download icon next to the broker in the history
table; it flows from the client's `pendingBrokerNoteId` through `/transactions/batch`.

## Common Modification Patterns

### Adding a new CSV column
1. Add the column index parsing in `parseSingleRow()` (`transaction-csv.ts`)
2. Add the field to `CsvRow` and `BatchRowRequest`
3. Add `<th>` + `<td>` with input in `csv-preview.tsx`
4. Include the field in `batchSubmit()` row collection (JS)
5. Handle the new field in `TransactionService.batchImport()`

### Adding a new field to asset review
1. Add the field to `CsvAssetRow` and `AssetBatchRow`
2. Add `<th>` + `<td>` in `csv-asset-review.tsx` with `class="asset-field" data-field="fieldName"`
3. Include it in `csvNextStep()` asset collection (JS)
4. Handle it in `TransactionService.batchImport()` when creating assets

### Changing validation rules
- Validation logic is in `parseSingleRow()` inside `transaction-csv.ts`
- Return `errorRow("message")` for invalid data — the row will appear in step 2 as editable + pre-ignored

### Modifying the ignore behavior
- Step 1 ignore: checkbox with class `asset-ignore-check`, handler `onAssetIgnoreToggle()`
- Step 2 ignore: checkbox with class `csv-ignore-check`, handler `onCsvRowIgnoreToggle()`
- Ignored tickers propagate from step 1 to step 2 via the `ignoredTickers` Set in JS
- Error rows come pre-checked via `th:checked="${row.error != null}"` in the template
