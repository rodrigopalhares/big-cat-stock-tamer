---
name: dividends
description: >
  Guide for modifying the dividends (proventos) feature — CRUD operations, portfolio
  integration, UI, CSV import, and tests. Use this skill whenever the user asks to change,
  fix, or extend dividends/proventos — adding new dividend types, changing the form, table
  or edit modal, modifying how dividends affect the portfolio/XIRR calculation, adding
  filters, changing validation, fixing bugs in the dividend flow, or touching the dividend
  CSV import. Trigger on mentions of: dividendos, proventos, JCP, rendimento, bonificacao,
  BTC, IR retido, dividend pnl, cash flows de proventos, pagina de proventos, /dividends/.
---

# Dividends (Proventos) Feature

This skill describes the architecture and file locations for the dividends feature
so you can make targeted changes without exploring the codebase.

## Domain Concepts

- **Dividend types**: DIVIDENDO, JCP, RENDIMENTO, BONIFICACAO, BTC (`DIVIDEND_TYPES` in
  `src/domain/constants.ts`). `DIVIDEND_TYPE_ALIASES` maps broker spellings (DIVIDENDOS,
  JSCP, "JUROS SOBRE CAPITAL PROPRIO", BONIFICAÇÃO…) onto those five for CSV import.
- **Net amount**: `totalAmount - taxWithheld` — what the investor actually receives.
- **BRL conversion**: dividends store both the original values (`totalAmount`, `taxWithheld`)
  and the converted ones (`totalAmountBrl`, `taxWithheldBrl`). For BRL assets they are equal.
  For USD assets, `DividendService.convertToBrl()` calls `ExchangeRateService.getRate()` with
  the dividend's own date, at create and update time — never at read time.
- **Dividend PnL**: `sum(totalAmountBrl - taxWithheldBrl)` per asset, always in BRL.
- **XIRR integration**: dividend cash flows (date + net BRL amount) are merged with transaction
  cash flows so the XIRR reflects total return including income.

## File Map

### Core Files

| File | Role |
|------|------|
| `prisma/schema.prisma` (`model Dividend`) | Prisma model, mapped to table `dividends` |
| `prisma/migrations/20260724224426_init/migration.sql` | The only migration that touches `dividends` |
| `src/domain/constants.ts` | `DIVIDEND_TYPES`, `DividendType`, `DIVIDEND_TYPE_ALIASES`, `isDividendType()` |
| `src/modules/dividend/dividend.service.ts` | Business logic — CRUD, PnL and cash-flow aggregation |
| `src/modules/dividend/dividend.schema.ts` | Zod forms/requests + `DividendView` + mappers |
| `src/modules/dividend/dividend.routes.ts` | HTML, HTMX and JSON routes |
| `src/container.ts` | Wires `DividendService(db, transactions, exchangeRates)` |

### View Files

| File | Role |
|------|------|
| `src/views/pages/dividends.tsx` | Main page — form, filters, table, CSV modal, edit modal |
| `src/views/partials/dividend-csv-preview.tsx` | HTMX fragment with the parsed CSV rows |
| `src/views/components/badge.tsx` | `DividendBadge` component + `DIVIDEND_BADGE_CLASSES` map |
| `src/views/layout.tsx` | Navbar entry "Proventos" (`bi-cash-coin`) |
| `src/client/dividends.ts` | Browser TS — edit modal + CSV batch submit (bundled to `public/js/`) |

### Integration Points

| File | Role |
|------|------|
| `src/modules/portfolio/portfolio.schema.ts` | `dividendPnl` on `AssetPosition` and `PortfolioSummary` |
| `src/modules/portfolio/portfolio.service.ts` | Merges PnL and cash flows into positions and XIRR |
| `src/views/pages/dashboard.tsx` | "Proventos Recebidos" card + "Proventos" column |
| `src/modules/asset/asset.routes.ts` | Asset detail page lists the asset's dividends |
| `src/views/pages/asset-detail.tsx` | `DividendsTable` on the asset page |
| `src/modules/evolution/evolution.service.ts` | Queries `dividend` directly for accumulated net income |
| `src/domain/csv/dividend-csv.ts` | Pure parser — `parseDividendCsvRows()`, `DividendCsvRow` |
| `src/modules/csv-import/csv-import.service.ts` | `parseDividendCsv()` + `batchImportDividends()` |

### Test Files

| File | Role |
|------|------|
| `src/modules/dividend/dividend.service.test.ts` | 17 tests — CRUD, filters, USD conversion, PnL, cash flows |
| `src/domain/csv/dividend-csv.test.ts` | Pure parsing of the dividend CSV |
| `src/modules/csv-import/csv-import.service.test.ts` | Batch import into the DB |
| `tests/integration/routes.test.ts` | HTML/JSON routes and portfolio integration |

## Database Schema

Real DDL from the init migration (SQLite — `REAL`, `TEXT`, no `VARCHAR`):

```sql
CREATE TABLE "dividends" (
    "id"               INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset_id"         TEXT     NOT NULL,
    "type"             TEXT     NOT NULL,       -- DIVIDENDO, JCP, RENDIMENTO, BONIFICACAO, BTC
    "date"             TEXT     NOT NULL,       -- ISO YYYY-MM-DD, never a DATE type
    "total_amount"     REAL     NOT NULL,       -- gross, original currency
    "tax_withheld"     REAL     NOT NULL DEFAULT 0,
    "total_amount_brl" REAL     NOT NULL DEFAULT 0,
    "tax_withheld_brl" REAL     NOT NULL DEFAULT 0,
    "broker"           TEXT,
    "currency"         TEXT     NOT NULL DEFAULT 'BRL',
    "notes"            TEXT,
    "created_at"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dividends_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE
);
```

`date` is a `String` in Prisma and an `IsoDate` in TypeScript — see the calendar-date rule in
`CLAUDE.md`. The `ON DELETE CASCADE` only works because `PRAGMA foreign_keys = ON` is applied
at boot and in `tests/db.ts`.

## Service API

```typescript
type DividendInput = {
  type: string
  date: IsoDate
  totalAmount: number
  taxWithheld: number
  notes?: string | null
  broker?: string | null
  currency?: string          // defaults to 'BRL'
}

class DividendService {
  constructor(db: Db, transactions: TransactionService, exchangeRates: ExchangeRateService)

  createDividend(ticker: string, input: DividendInput): Promise<Dividend>
  // Uppercases ticker and type, converts to BRL, and calls transactions.findOrCreateAsset()
  // BEFORE the write — asset creation may hit the network, which must never happen
  // inside a write transaction.

  listDividends(ticker?: string | null, type?: string | null): Promise<Dividend[]>  // date DESC
  updateDividend(id: number, input: DividendInput): Promise<void>   // 404 if missing
  deleteDividend(id: number): Promise<void>                          // 404 if missing
  getDividendPnlByAsset(): Promise<Map<string, number>>              // groupBy + sum, in BRL
  getDividendCashFlowsByAsset(): Promise<Map<string, CashFlow[]>>    // net BRL, for XIRR
}
```

`blankToNull()` turns empty/whitespace `broker` and `notes` into `null` on write.

## Routes

All registered by `dividendRoutes(container)` in `dividend.routes.ts`.

| Method | Path | Type | Behaviour |
|--------|------|------|-----------|
| GET | `/dividends/` | HTML | Page with form, filters (`ticker`, `type`) and table |
| POST | `/dividends/new` | HTML | Creates, redirects 302 to `/dividends/` |
| POST | `/dividends/:id/edit` | HTML | Updates, redirects to `returnTo` or `/dividends/` |
| POST | `/dividends/:id/delete` | HTML | Deletes, redirects to `returnTo` or `/dividends/` |
| GET | `/dividends/ticker-info?ticker=X` | HTMX | Ticker status fragment (empty if under 3 chars) |
| POST | `/dividends/parse-csv` | HTMX | Renders `DividendCsvPreview` from pasted CSV |
| POST | `/dividends/batch` | JSON | Imports the reviewed rows, returns `{ inserted }` |
| GET | `/dividends/api` | JSON | List, filterable by `ticker` and `type` |
| POST | `/dividends/api` | JSON | Creates, returns 201 + response body |
| DELETE | `/dividends/api/:id` | JSON | Returns 204 |

`returnTo` is accepted by the edit and delete routes but no view sends it today — the
dividends page posts without it, and `DividendsTable` on the asset detail page is read-only.
It is the hook to use if dividends ever get edit/delete buttons outside `/dividends/`, the way
transactions already do on the asset page.

## Schemas

Three Zod schemas, because the HTML form and the JSON API have different contracts:

- `DividendForm` — snake_case field names matching the HTML inputs (`total_amount`,
  `tax_withheld`), `z.coerce.number()` since form bodies arrive as strings, loose `type`.
- `DividendEditForm` — `DividendForm.omit({ ticker: true })`; the edit modal cannot move a
  dividend to another asset.
- `DividendApiRequest` — camelCase, strict: `z.enum(DIVIDEND_TYPES)`, `z.enum(VALID_CURRENCIES)`,
  `totalAmount` positive, `taxWithheld` non-negative.

Two mappers: `toDividendView(d)` for the JSX tables (adds `netAmount`, `netAmountBrl` and
renames `assetId` to `assetTicker`), and `toDividendResponse(d)` for JSON (keeps `assetId`,
adds `netAmount` and `createdAt`, omits the BRL columns).

## Portfolio Integration

In `PortfolioService.buildPositions()`:

1. `getDividendPnlByAsset()` and `getDividendCashFlowsByAsset()` are pre-loaded once in the
   same `Promise.all` as the transactions — not per asset.
2. Per asset, dividend flows are merged into both `allCashFlows` and `allCashFlowsBrl` and
   re-sorted by date before the XIRR runs. The same flows go into both because they are
   already in BRL.
3. `dividendPnl` is set on the position from the map, defaulting to 0.
4. `aggregatePositions()` sums `dividendPnl` straight across positions — already BRL, no
   second conversion.

## Common Modification Patterns

### Adding a new dividend type
1. Add the string to `DIVIDEND_TYPES` in `src/domain/constants.ts`.
2. Add a colour to `DIVIDEND_BADGE_CLASSES` in `src/views/components/badge.tsx`.
3. Optionally add broker spellings to `DIVIDEND_TYPE_ALIASES` for CSV import.
4. Nothing else — the form select, the filter and `DividendApiRequest` are all driven by
   `DIVIDEND_TYPES`.

### Adding a new field
1. Add the column to `model Dividend` in `prisma/schema.prisma`, then `npm run db:migrate`.
2. Add it to `DividendInput` and both write paths in `dividend.service.ts`.
3. Add it to `DividendForm`, `DividendApiRequest`, `DividendView`, `toDividendView` and
   `toDividendResponse` in `dividend.schema.ts`.
4. Pass it through in `dividend.routes.ts` (create, edit, and the API create).
5. Add the input to the form and the edit modal plus a `<td>` in `src/views/pages/dividends.tsx`;
   if the edit modal needs it, add a `data-div-*` attribute and a `setValue()` call in
   `src/client/dividends.ts`.
6. Update `createDividend` in `tests/factories.ts` if the field is required.
7. Cover it in `dividend.service.test.ts` and, if it shows up in a route, `routes.test.ts`.

### Modifying portfolio integration
- PnL: `DividendService.getDividendPnlByAsset()`
- XIRR flows: `DividendService.getDividendCashFlowsByAsset()`
- Merge point: `PortfolioService.buildPositions()`, around `allCashFlows`
- Totals: `PortfolioService.aggregatePositions()`

### Changing badge colours
Edit `DIVIDEND_BADGE_CLASSES` in `src/views/components/badge.tsx`. Current mapping:
DIVIDENDO → `bg-success`, JCP → `bg-primary`, RENDIMENTO → `bg-info`,
BONIFICACAO → `bg-warning text-dark`, BTC → `bg-secondary`. Unknown types fall back to
`bg-secondary`.

### Touching the dividend CSV import
Parsing is pure and lives in `src/domain/csv/dividend-csv.ts` (no I/O, test it directly).
The I/O half is `parseDividendCsv()` / `batchImportDividends()` in `csv-import.service.ts`.
The two-step modal UI mirrors the transaction importer — see the `csv-import` skill for the
flow, and note the dividend version uses the `div-csv-*` class and id prefixes.

## Test Patterns

Vitest, with an in-memory SQLite built from the migration SQL (`tests/db.ts`):

```typescript
let db: TestDb
let service: DividendService

beforeAll(async () => {
  db = await createTestDb()
  const exchangeRates = new ExchangeRateService(db, new BcbClient())
  service = new DividendService(
    db,
    new TransactionService(db, new YahooClient(), exchangeRates),
    exchangeRates,
  )
})
afterAll(async () => { await db.$disconnect() })
beforeEach(async () => { await clearAllData(db) })
```

- `clearAllData()` already deletes in FK-safe order (dividends before transactions before
  assets) — never hand-roll the deletion order in a test file.
- Build fixtures with `createAsset`, `createDividend`, `createExchangeRate` from
  `tests/factories.ts`.
- External HTTP (Yahoo, BCB) is intercepted by MSW; a test that exercises USD conversion needs
  an exchange rate seeded in the DB or a mocked BCB response, not a live call.
