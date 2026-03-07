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
| `src/main/kotlin/com/stocks/controller/TransactionController.kt` | Routes: `parse-csv`, `parse-csv-step2`, `batch` |
| `src/main/kotlin/com/stocks/service/TransactionService.kt` | `extractDistinctAssets()`, `parseCsvWithAssetLookup()`, `batchImport()` |
| `src/main/kotlin/com/stocks/dto/CsvBatchDtos.kt` | DTOs: `CsvRow`, `CsvAssetRow`, `BatchRowRequest`, `AssetBatchRow`, `parseCsvRows()`, `parseBrazilianNumber()` |
| `src/main/kotlin/com/stocks/service/QuoteService.kt` | `fetchAssetInfo()` — Yahoo Finance lookup for unknown tickers |
| `src/main/kotlin/com/stocks/service/TickerClassification.kt` | `classifyTicker()` — detects asset type from ticker pattern |
| `src/main/resources/templates/fragments/csv-asset-review.html` | Step 1 UI — asset review table (Thymeleaf fragment) |
| `src/main/resources/templates/fragments/csv-preview.html` | Step 2 UI — transaction preview table (Thymeleaf fragment) |
| `src/main/resources/static/js/transactions.js` | Client-side logic: `csvNextStep()`, `batchSubmit()`, ignore toggles, ticker change handlers |

## CSV Input Format

Tab-separated, one transaction per line. Columns by index:

| Index | Field | Example | Notes |
|-------|-------|---------|-------|
| 0 | Ticker | `PETR4` | Uppercased automatically |
| 1 | Date | `15/03/2025` | Brazilian format dd/MM/yyyy, converted to ISO |
| 2 | Type | `C` or `V` | Mapped to BUY / SELL |
| 3 | Quantity | `1.000,50` | Brazilian number format |
| 4 | Unit Price | `28,45` | Brazilian number format |
| 5 | Taxes | `4,50` | Brazilian number format |
| 6 | Broker | `XP` | Free text |
| 7 | IRRF | `0,10` | Optional, added to fees |
| 8 | Currency | `BRL` | Defaults to BRL if missing |
| 9 | Notes | `Split` | Optional free text |

Parsing lives in `parseCsvRows()` and `parseSingleRow()` inside `CsvBatchDtos.kt`.

## Key DTOs

```kotlin
// Step 1 — asset review
data class CsvAssetRow(ticker, name, type, yfTicker, currency, assetStatus: AssetStatus)

// Step 2 — transaction preview
data class CsvRow(rowIndex, ticker, date, type, quantity, price, fees, broker, notes, currency, assetStatus, error?)

// Batch submit payload
data class BatchRowRequest(ticker, date, type, quantity, price, fees, broker, notes, currency)
data class AssetBatchRow(ticker, name, type, yfTicker, currency)
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
1. Add the column index parsing in `parseSingleRow()` (`CsvBatchDtos.kt`)
2. Add the field to `CsvRow` and `BatchRowRequest`
3. Add `<th>` + `<td>` with input in `csv-preview.html`
4. Include the field in `batchSubmit()` row collection (JS)
5. Handle the new field in `TransactionService.batchImport()`

### Adding a new field to asset review
1. Add the field to `CsvAssetRow` and `AssetBatchRow`
2. Add `<th>` + `<td>` in `csv-asset-review.html` with `class="asset-field" data-field="fieldName"`
3. Include it in `csvNextStep()` asset collection (JS)
4. Handle it in `TransactionService.batchImport()` when creating assets

### Changing validation rules
- Validation logic is in `parseSingleRow()` inside `CsvBatchDtos.kt`
- Return `errorRow("message")` for invalid data — the row will appear in step 2 as editable + pre-ignored

### Modifying the ignore behavior
- Step 1 ignore: checkbox with class `asset-ignore-check`, handler `onAssetIgnoreToggle()`
- Step 2 ignore: checkbox with class `csv-ignore-check`, handler `onCsvRowIgnoreToggle()`
- Ignored tickers propagate from step 1 to step 2 via the `ignoredTickers` Set in JS
- Error rows come pre-checked via `th:checked="${row.error != null}"` in the template
