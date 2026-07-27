---
name: csv-import
description: >
  Guide for modifying the CSV batch import flow for transactions.
  Use this skill whenever the user asks to change, fix, or extend the CSV import
  of transactions — adding/removing columns, changing validations, adjusting the
  UI of the import modal, modifying how assets are reviewed or transactions are
  previewed, changing the batch submit logic, or fixing bugs in the import flow.
  Trigger on mentions of: CSV import, importacao CSV, batch import, parse CSV,
  colar transacoes, importar planilha, etapa 1/2 do CSV, asset review, preview
  de transacoes.
---

# CSV Transaction Import Flow

This skill describes the architecture and file locations for the CSV batch import
feature so you can make targeted changes without exploring the codebase.

## Flow Overview

```
User pastes CSV -> Step 1: Asset Review -> Step 2: Transaction Preview -> Batch Submit
```

1. User pastes tab-separated text into a modal textarea
2. **Step 1** extracts distinct tickers, classifies them (EXISTS / WILL_CREATE / UNKNOWN),
   and shows an editable asset table where the user can rename tickers, change types, or
   ignore entire assets
3. **Step 2** parses every CSV line into transaction rows with validation. Error rows are
   editable and pre-marked as ignored. Ignored assets from step 1 carry over.
4. **Submit** sends valid, non-ignored rows + new assets as JSON to the backend, which
   persists everything in a single batch

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
| POST | `/transactions/batch` | JSON `{ inserted: N }` |
| GET | `/transactions/asset-info?ticker=X` | JSON `{ name, type, yfTicker, currency }` |
| GET | `/transactions/ticker-info?ticker=X` | HTML snippet with ticker status |

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
