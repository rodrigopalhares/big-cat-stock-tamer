---
name: h2-database
description: >
  Guide for connecting to and querying the H2 database used by the stocks application.
  Use this skill whenever the user asks to query the database, check data, run SQL,
  inspect tables, connect to H2, look at database contents, debug data issues,
  or verify records in the database. Also use this skill when the user asks to clean up
  or reset test data (cleanup, limpar dados, resetar banco, apagar registros de teste).
  Trigger on mentions of: H2, database, SQL, query, banco de dados, consulta, tabela,
  SELECT, dados do banco, h2-console, verificar dados, cleanup, limpar dados, resetar.
---

# H2 Database Access

This skill explains how to connect to the application's H2 database from the terminal
and documents the full schema of all tables.

## Connection

The application uses an H2 file-based database. To run SQL queries from the terminal,
use the H2 Shell tool via the cached Gradle dependency:

```bash
java -cp "C:\Users\super\.gradle\caches\modules-2\files-2.1\com.h2database\h2\2.3.232\4fcc05d966ccdb2812ae8b9a718f69226c0cf4e2\h2-2.3.232.jar" \
  org.h2.tools.Shell \
  -url "jdbc:h2:file:C:/ws/stocks/data/stocks;AUTO_SERVER=TRUE" \
  -user sa \
  -password "" \
  -sql "YOUR SQL HERE;"
```

### Connection Parameters

| Parameter | Value |
|-----------|-------|
| JDBC URL | `jdbc:h2:file:C:/ws/stocks/data/stocks;AUTO_SERVER=TRUE` |
| Driver | `org.h2.Driver` |
| Username | `sa` |
| Password | *(empty)* |
| H2 JAR | `C:\Users\super\.gradle\caches\modules-2\files-2.1\com.h2database\h2\2.3.232\4fcc05d966ccdb2812ae8b9a718f69226c0cf4e2\h2-2.3.232.jar` |

The `AUTO_SERVER=TRUE` flag allows concurrent connections (the app can be running while you query).

### Web Console

The H2 web console is available at `http://localhost:8000/h2-console` when the application is running.

---

## Database Schema

### ASSETS

Primary table for tracked financial assets (stocks, ETFs, FIIs).

| Column | Type | Nullable | Key | Default | Description |
|--------|------|----------|-----|---------|-------------|
| TICKER | VARCHAR(50) | NO | PK | | Asset ticker symbol (e.g., BBAS3, VTI, KNRI11) |
| YF_TICKER | VARCHAR(100) | YES | | | Yahoo Finance ticker for price lookups |
| NAME | VARCHAR(255) | YES | | | Asset display name |
| TYPE | VARCHAR(50) | YES | | | Asset type (ACAO, ETF, FII, etc.) |
| CURRENCY | VARCHAR(10) | NO | | 'BRL' | Currency (BRL, USD) |
| CREATED_AT | TIMESTAMP | NO | | CURRENT_TIMESTAMP | |
| DELISTED | BOOLEAN | NO | | FALSE | Whether the asset has been delisted |

### TRANSACTIONS

Buy/sell transactions for each asset.

| Column | Type | Nullable | Key | Default | Description |
|--------|------|----------|-----|---------|-------------|
| ID | INTEGER | NO | PK | auto | |
| ASSET_ID | VARCHAR(50) | NO | FK | | References ASSETS.TICKER |
| TYPE | VARCHAR(10) | NO | | | BUY or SELL |
| QUANTITY | DOUBLE | NO | | | Number of shares/units |
| PRICE | DOUBLE | NO | | | Price per unit in original currency |
| FEES | DOUBLE | NO | | 0.0 | Transaction fees in original currency |
| DATE | DATE | NO | | | Transaction date |
| BROKER | VARCHAR(255) | YES | | | Broker name (XP, AVENUE, etc.) |
| NOTES | CLOB | YES | | | |
| CREATED_AT | TIMESTAMP | NO | | CURRENT_TIMESTAMP | |
| PRICE_BRL | DOUBLE | YES | | 0 | Price converted to BRL |
| FEES_BRL | DOUBLE | YES | | 0 | Fees converted to BRL |
| CURRENCY | VARCHAR(3) | YES | | 'BRL' | Original currency |

### DIVIDENDS

Dividend and income payments received.

| Column | Type | Nullable | Key | Default | Description |
|--------|------|----------|-----|---------|-------------|
| ID | INTEGER | NO | PK | auto | |
| ASSET_ID | VARCHAR(50) | NO | FK | | References ASSETS.TICKER |
| TYPE | VARCHAR(20) | NO | | | DIVIDENDO, JCP, RENDIMENTO, BTC, BONIFICACAO |
| DATE | DATE | NO | | | Payment date |
| TOTAL_AMOUNT | DOUBLE | NO | | | Gross amount in original currency |
| TAX_WITHHELD | DOUBLE | NO | | 0.0 | Tax withheld in original currency |
| NOTES | CLOB | YES | | | |
| CREATED_AT | TIMESTAMP | NO | | CURRENT_TIMESTAMP | |
| BROKER | VARCHAR(100) | YES | | | Broker name |
| CURRENCY | VARCHAR(10) | YES | | 'BRL' | Original currency |
| TOTAL_AMOUNT_BRL | DOUBLE | YES | | 0 | Gross amount in BRL |
| TAX_WITHHELD_BRL | DOUBLE | YES | | 0 | Tax withheld in BRL |

### EXCHANGE_RATES

Historical currency exchange rates (USD/BRL).

| Column | Type | Nullable | Key | Default | Description |
|--------|------|----------|-----|---------|-------------|
| ID | INTEGER | NO | PK | auto | |
| DATE | DATE | NO | UNI | | Rate date |
| FROM_CURRENCY | VARCHAR(10) | NO | UNI | | Source currency (e.g., USD) |
| TO_CURRENCY | VARCHAR(10) | NO | UNI | | Target currency (e.g., BRL) |
| BUY_RATE | DOUBLE | NO | | | Buy exchange rate |
| SELL_RATE | DOUBLE | NO | | | Sell exchange rate |
| CREATED_AT | TIMESTAMP | NO | | CURRENT_TIMESTAMP | |

### MONTHLY_SNAPSHOTS

Monthly portfolio snapshots per asset for historical tracking.

| Column | Type | Nullable | Key | Default | Description |
|--------|------|----------|-----|---------|-------------|
| ID | INTEGER | NO | PK | auto | |
| ASSET_ID | VARCHAR(50) | NO | UNI | | References ASSETS.TICKER |
| MONTH | DATE | NO | UNI | | First day of the month |
| QUANTITY | DOUBLE | NO | | | Shares held at month end |
| AVG_PRICE | DOUBLE | NO | | | Average purchase price |
| MARKET_PRICE | DOUBLE | NO | | | Market price at month end |
| TOTAL_COST | DOUBLE | NO | | | Total cost basis |
| MARKET_VALUE | DOUBLE | NO | | | Market value at month end |
| CREATED_AT | TIMESTAMP | NO | | CURRENT_TIMESTAMP | |
| ACCUMULATED_NET_DIVIDENDS | DOUBLE | NO | | 0.0 | Cumulative net dividends received |

### PRICE_HISTORY

Daily closing prices for assets.

| Column | Type | Nullable | Key | Default | Description |
|--------|------|----------|-----|---------|-------------|
| ID | INTEGER | NO | PK | auto | |
| ASSET_ID | VARCHAR(50) | NO | UNI | | References ASSETS.TICKER |
| DATE | DATE | NO | UNI | | Price date |
| CLOSE | DOUBLE | NO | | | Closing price |
| CREATED_AT | TIMESTAMP | NO | | CURRENT_TIMESTAMP | |

---

## Common Queries

### List all assets
```sql
SELECT * FROM ASSETS;
```

### Portfolio summary (current holdings with quantities)
```sql
SELECT t.ASSET_ID, a.NAME, a.TYPE, a.CURRENCY,
       SUM(CASE WHEN t.TYPE = 'BUY' THEN t.QUANTITY ELSE -t.QUANTITY END) AS CURRENT_QTY
FROM TRANSACTIONS t
JOIN ASSETS a ON t.ASSET_ID = a.TICKER
GROUP BY t.ASSET_ID, a.NAME, a.TYPE, a.CURRENCY
HAVING CURRENT_QTY > 0;
```

### Total dividends by asset
```sql
SELECT ASSET_ID, CURRENCY, SUM(TOTAL_AMOUNT) AS TOTAL, SUM(TAX_WITHHELD) AS TOTAL_TAX
FROM DIVIDENDS
GROUP BY ASSET_ID, CURRENCY
ORDER BY TOTAL DESC;
```

### Recent transactions
```sql
SELECT * FROM TRANSACTIONS ORDER BY DATE DESC LIMIT 20;
```

---

## Cleanup — Reset Test Data

When the user asks to clean up or reset the database, delete all records from the
transactional tables while preserving the ASSETS catalog and reference data.

The order matters because of foreign key-like relationships: snapshots and dividends
reference assets and transactions, so delete them first.

Run this single command to wipe DIVIDENDS, TRANSACTIONS, and MONTHLY_SNAPSHOTS:

```bash
java -cp "C:\Users\super\.gradle\caches\modules-2\files-2.1\com.h2database\h2\2.3.232\4fcc05d966ccdb2812ae8b9a718f69226c0cf4e2\h2-2.3.232.jar" \
  org.h2.tools.Shell \
  -url "jdbc:h2:file:C:/ws/stocks/data/stocks;AUTO_SERVER=TRUE" \
  -user sa \
  -password "" \
  -sql "DELETE FROM MONTHLY_SNAPSHOTS; DELETE FROM DIVIDENDS; DELETE FROM TRANSACTIONS;"
```

After cleanup, confirm success by checking row counts:

```bash
java -cp "C:\Users\super\.gradle\caches\modules-2\files-2.1\com.h2database\h2\2.3.232\4fcc05d966ccdb2812ae8b9a718f69226c0cf4e2\h2-2.3.232.jar" \
  org.h2.tools.Shell \
  -url "jdbc:h2:file:C:/ws/stocks/data/stocks;AUTO_SERVER=TRUE" \
  -user sa \
  -password "" \
  -sql "SELECT 'DIVIDENDS' AS TBL, COUNT(*) AS ROWS FROM DIVIDENDS UNION ALL SELECT 'TRANSACTIONS', COUNT(*) FROM TRANSACTIONS UNION ALL SELECT 'MONTHLY_SNAPSHOTS', COUNT(*) FROM MONTHLY_SNAPSHOTS;"
```

Tables preserved (not cleaned):
- **ASSETS** — the asset catalog is reference data, not test data
- **EXCHANGE_RATES** — historical rates are reusable across tests
- **PRICE_HISTORY** — price data is fetched from external APIs and expensive to rebuild
