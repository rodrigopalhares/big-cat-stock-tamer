---
name: dividends
description: >
  Guide for modifying the dividends (proventos) feature — CRUD operations, portfolio
  integration, UI, and tests. Use this skill whenever the user asks to change, fix, or
  extend dividends/proventos — adding new dividend types, changing the form or table,
  modifying how dividends affect the portfolio/XIRR calculation, adding filters, changing
  validation, fixing bugs in the dividend flow, or adding CSV import for dividends.
  Trigger on mentions of: dividendos, proventos, JCP, rendimento, bonificacao, BTC,
  IR retido, dividend pnl, cash flows de proventos, pagina de proventos, /dividends/.
---

# Dividends (Proventos) Feature

This skill describes the architecture and file locations for the dividends feature
so you can make targeted changes without exploring the codebase.

## Domain Concepts

- **Dividend types**: DIVIDENDO, JCP, RENDIMENTO, BONIFICACAO, BTC (defined in `constants.ts`)
- **Net amount**: `totalAmount - taxWithheld` (the effective amount the investor receives)
- **BRL conversion**: Dividends and transactions store converted BRL values (`totalAmountBrl`, `taxWithheldBrl` for dividends; `priceBrl`, `feesBrl` for transactions). For BRL assets, these equal the original values. For USD assets, conversion happens at creation/update time using the exchange rate on the dividend/transaction date.
- **Dividend PnL**: sum of `totalAmountBrl - taxWithheldBrl` per asset (always in BRL), shown as a separate column in the dashboard
- **XIRR integration**: dividend cash flows (date + net amount in BRL) are merged with transaction
  cash flows to compute a combined XIRR that reflects total return including income

## File Map

### Core Files

| File | Role |
|------|------|
| `prisma/migrations/` | DB schema — `dividends` table with FK to `assets(ticker)` |
| `prisma/schema.prisma (model Dividend)` | Prisma model — `Dividends` IntIdTable + `DividendEntity` |
| `prisma/schema.prisma (model Asset)` | Asset model — has `val dividends by DividendEntity referrersOn Dividends.assetId` |
| `src/modules/dividend/dividend.schema.ts` | `DividendRequest` (with validation) + `DividendResponse` (with `netAmount`) |
| `src/domain/constants.ts` | `DIVIDEND_TYPES` list |
| `src/modules/dividend/dividend.service.ts` | Business logic — CRUD + aggregation methods |
| `src/modules/dividend/dividend.routes.ts` | HTML + API routes + template type |

### Template Files

| File | Role |
|------|------|
| `src/views/pages/dividends.tsx` | Main page — form (col-lg-4) + history table (col-lg-8) with filters |
| `src/views/components/badge.tsx` | `dividendBadge(type)` fragment with colored badges per type |
| `src/views/layout.tsx` | Navbar — "Proventos" link between Transacoes and Evolucao |

### Portfolio Integration

| File | Role |
|------|------|
| `src/modules/portfolio/portfolio.schema.ts` | `dividendPnl` field on both `AssetPosition` and `PortfolioSummary` |
| `src/modules/portfolio/portfolio.service.ts` | Calls `DividendService` to get PnL and cash flows per asset, merges into XIRR |
| `src/modules/portfolio/portfolio.routes.ts` | Passes `dividendPnl` to dashboard model |
| `src/views/pages/dashboard.tsx` | "Proventos Recebidos" summary card + "Proventos" column in positions table |

### Test Files

| File | Role |
|------|------|
| `src/modules/dividend/dividend.service.test.ts` | 11 tests — CRUD, filters, PnL aggregation, cash flows |
| `tests/integration/routes.test.ts` | 12 tests — HTML routes, API routes, portfolio integration |

## Database Schema

```sql
CREATE TABLE dividends (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    asset_id          VARCHAR(50) NOT NULL,       -- FK to assets(ticker)
    "type"            VARCHAR(20) NOT NULL,       -- DIVIDENDO, JCP, RENDIMENTO, BONIFICACAO, BTC
    "date"            DATE        NOT NULL,
    total_amount      DOUBLE      NOT NULL,       -- gross amount (original currency)
    tax_withheld      DOUBLE      NOT NULL DEFAULT 0.0,  -- IR retido (original currency)
    total_amount_brl  DOUBLE      NOT NULL DEFAULT 0.0,  -- gross amount in BRL
    tax_withheld_brl  DOUBLE      NOT NULL DEFAULT 0.0,  -- IR retido in BRL
    broker            VARCHAR(100),
    currency          VARCHAR(10) DEFAULT 'BRL',
    notes             CLOB,
    created_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dividend_asset FOREIGN KEY (asset_id) REFERENCES assets(ticker) ON DELETE CASCADE
);
```

## Service Methods

```typescript
class DividendService(transactionService, exchangeRateService) {
    fun createDividend(ticker, type, date, totalAmount, taxWithheld, notes, broker?, currency): DividendEntity
    // Auto-converts to BRL using ExchangeRateService when currency != BRL
    fun updateDividend(id, type, date, totalAmount, taxWithheld, notes, broker?, currency)
    fun listDividends(ticker?, type?): List<DividendEntity>  // filtered, ordered by date DESC
    fun deleteDividend(id)                                    // throws 404 if not found
    fun getDividendPnlByAsset(): Map<String, Double>          // ticker -> sum(totalAmountBrl - taxWithheldBrl)
    fun getDividendCashFlowsByAsset(): Map<String, List<Pair<LocalDate, Double>>>  // BRL values for XIRR
}
```

## Controller Routes

| Method | Path | Type | Returns |
|--------|------|------|---------|
| GET | `/dividends/` | HTML | Dividends page with form + filtered list |
| POST | `/dividends/new` | HTML | Creates dividend, redirects to `/dividends/` |
| POST | `/dividends/{id}/delete` | HTML | Deletes dividend, redirects to `/dividends/` |
| GET | `/dividends/ticker-info?ticker=X` | HTMX | HTML snippet with ticker status |
| GET | `/dividends/api` | JSON | List all dividends (filterable by `ticker` and `type`) |
| POST | `/dividends/api` | JSON | Create dividend, returns 201 + `DividendResponse` |
| DELETE | `/dividends/api/{id}` | JSON | Delete dividend, returns 204 |

## Template Data

The controller uses `DividendTemplateData` for JSX:

```typescript
type DividendTemplateData(
    val id: Int,
    val assetTicker: String,
    val type: String,
    val date: LocalDate,
    val totalAmount: Double,
    val taxWithheld: Double,
    val netAmount: Double,       // computed: totalAmount - taxWithheld
    val totalAmountBrl: Double,  // BRL converted value
    val taxWithheldBrl: Double,  // BRL converted value
    val netAmountBrl: Double,    // computed: totalAmountBrl - taxWithheldBrl
    val broker: String?,
    val currency: String,
    val notes: String?,
)
```

Model attributes passed to `dividends.html`:
- `dividends` — list of DividendTemplateData
- `assets` — list of maps with `ticker` and `name` (for datalist)
- `dividendTypes` — DIVIDEND_TYPES from constants.ts
- `selectedTicker` — current filter
- `selectedType` — current filter
- `today` — today's date for the form default

## Portfolio Integration Details

In `PortfolioService.buildPositions()`:
1. Pre-loads `dividendPnlByAsset` and `dividendCashFlowsByAsset` from `DividendService`
2. For each asset: sets `dividendPnl` on the position and merges dividend cash flows into
   `allCashFlows` (sorted by date) before computing XIRR
3. In `aggregatePositions()`: sums `dividendPnl` directly (already in BRL), uses `totalCostBrl`
   and `realizedPnlBrl` for portfolio totals — no double-conversion needed

## Common Modification Patterns

### Adding a new dividend type
1. Add the type string to `DIVIDEND_TYPES` in `constants.ts`
2. Add a color mapping in `src/views/components/badge.tsx` inside the `DividendBadge` component
3. No other changes needed — the form select and filters are driven by `DIVIDEND_TYPES`

### Adding a new field to the dividend
1. Add the column to the Prisma schema and generate a migration (`npm run db:migrate`)
2. Add the field to `model Dividend` in `prisma/schema.prisma`
3. Add to `DividendForm`, `DividendView` and `toDividendView` in `dividend.schema.ts`
4. Add `@RequestParam` in `DividendController.createDividendForm()`
5. Pass the field in `DividendService.createDividend()`
6. Add form input in `dividends.html` and `<td>` in the table
7. Add test coverage in both `DividendServiceTest` and `DividendControllerTest`

### Modifying portfolio integration
- PnL calculation: `DividendService.getDividendPnlByAsset()`
- Cash flows for XIRR: `DividendService.getDividendCashFlowsByAsset()`
- Merge happens in `PortfolioService.buildPositions()` around the `allCashFlows` variable
- Summary aggregation: `PortfolioService.aggregatePositions()`

### Modifying the dividend badge colors
Edit the `dividendBadge(type)` fragment in `src/views/components/badge.tsx`. Current mapping:
- DIVIDENDO → `bg-success`
- JCP → `bg-primary`
- RENDIMENTO → `bg-info`
- BONIFICACAO → `bg-warning text-dark`
- BTC → `bg-secondary`

## Test Patterns

Tests follow the project convention: Kotest FunSpec + SpringExtension.

Every test file that deletes `AssetEntity` in `beforeEach` must also delete `DividendEntity`
first (FK constraint). This applies to all test files across the project.

```typescript
beforeEach {
    transaction {
        DividendEntity.all().forEach { it.delete() }  // before assets!
        TransactionEntity.all().forEach { it.delete() }
        AssetEntity.all().forEach { it.delete() }
    }
}
```

Service tests use `@SpringBootTest` + `@ActiveProfiles("test")`.
Controller tests add `@AutoConfigureMockMvc` and inject `MockMvc`.
