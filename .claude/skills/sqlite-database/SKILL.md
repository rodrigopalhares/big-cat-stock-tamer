---
name: sqlite-database
description: >
  Guide for connecting to and querying the SQLite database used by the stocks application.
  Use this skill whenever the user asks to query the database, check data, run SQL,
  inspect tables, connect to the database, look at database contents, debug data issues,
  or verify records. Also use it when the user asks to clean up or reset test data
  (cleanup, limpar dados, resetar banco, apagar registros de teste), or to inspect and
  restore a database backup. Triggers on mentions of: SQLite, database, SQL, query,
  banco de dados, consulta, tabela, SELECT, dados do banco, prisma studio, verificar dados,
  cleanup, limpar dados, resetar, backup, restaurar backup, restore, snapshot do banco.
---

# Banco de dados SQLite

O banco fica em `${APP_DATA_DIR}/stocks.db` (padrão `data/stocks.db`). É um arquivo único,
sem servidor. O schema é gerenciado pelo Prisma.

## Como consultar

Três formas, da mais conveniente para a mais crua.

### 1. Prisma Studio (GUI)

```bash
npm run db:studio
```

Abre uma interface no navegador para navegar e editar as tabelas. É o caminho mais rápido
para "dar uma olhada nos dados".

### 2. Script pontual com o client do Prisma

Para consulta programática, com tipos:

```bash
npx tsx -e "
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'
process.loadEnvFile('.env')
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL }) })
console.table(await db.asset.findMany({ select: { ticker: true, quantity: true, avgPrice: true } }))
await db.\$disconnect()
"
```

### 3. SQL direto

```bash
# Requer o binário sqlite3 instalado
sqlite3 data/stocks.db "SELECT ticker, quantity, avg_price FROM assets WHERE has_position = 1"
```

Ou sem depender do binário, usando o driver que já está instalado:

```bash
npx tsx -e "
import Database from 'better-sqlite3'
const db = new Database('data/stocks.db', { readonly: true })
console.table(db.prepare('SELECT ticker, quantity FROM assets').all())
"
```

> **Leitura enquanto a aplicação roda**: use `readonly: true`. O banco está em modo WAL,
> então leitura concorrente funciona sem bloquear a escrita.

## Tabelas

| Tabela | Chave | Observação |
|---|---|---|
| `assets` | `ticker` (texto) | Campos de posição são derivados das transações |
| `transactions` | `id` | `quantity` negativa = venda |
| `dividends` | `id` | `total_amount` bruto; líquido = bruto − `tax_withheld` |
| `price_history` | `id` | Único por (`asset_id`, `date`) |
| `monthly_snapshots` | `id` | Único por (`asset_id`, `month`) |
| `exchange_rates` | `id` | Único por (`date`, `from_currency`, `to_currency`) |
| `benchmark_prices` | `id` | Único por (`ticker`, `month`) — IBOV mensal |
| `risk_metrics` | `id` | Único por (`ticker`, `calculated_at`) |

### Tipos, e por que importam

- **Datas de calendário são `TEXT` no formato `YYYY-MM-DD`**, não `DATE`. Comparação e
  ordenação funcionam direto (`WHERE date >= '2024-01-01'`, `ORDER BY date`). Isso é
  deliberado: o SQLite não tem tipo data e o `DateTime` do Prisma arrastaria fuso.
  Ver `docs/migracao-typescript.md` §3.1.
- `created_at` é `DATETIME` — instante de verdade.
- Valores monetários são `REAL` (IEEE-754). Não converta para `NUMERIC`.
- **Booleanos são `INTEGER` 0/1** em SQL cru; o Prisma converte para `boolean`.

## Consultas úteis

```sql
-- posição atual
SELECT ticker, quantity, avg_price, total_cost FROM assets WHERE has_position = 1 ORDER BY ticker;

-- transações de um ativo
SELECT date, type, quantity, price, fees FROM transactions WHERE asset_id = 'PETR4' ORDER BY date;

-- proventos líquidos por ativo
SELECT asset_id, SUM(total_amount_brl - tax_withheld_brl) AS liquido
FROM dividends GROUP BY asset_id ORDER BY liquido DESC;

-- último preço de cada ativo
SELECT p.asset_id, p.date, p.close FROM price_history p
JOIN (SELECT asset_id, MAX(date) AS d FROM price_history GROUP BY asset_id) m
  ON m.asset_id = p.asset_id AND m.d = p.date;

-- lacunas no histórico de preços
SELECT asset_id, COUNT(*) AS dias, MIN(date), MAX(date) FROM price_history GROUP BY asset_id;
```

## Limpar dados de teste

```bash
# Apagar tudo de um ativo — as transações, proventos, preços e snapshots saem em cascata
npx tsx -e "
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'
process.loadEnvFile('.env')
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL }) })
await db.asset.delete({ where: { ticker: 'TESTE3' } })
await db.\$disconnect()
"
```

> O `ON DELETE CASCADE` só funciona com `PRAGMA foreign_keys = ON`, que a aplicação aplica no
> boot. Num script avulso, aplique também — senão o SQLite deixa órfãos em silêncio.

Para zerar o banco inteiro e recomeçar:

```bash
rm data/stocks.db && npm run db:deploy && npm run db:seed
```

## Backup e restauração

Os backups ficam em `data/backups/daily/` e `data/backups/monthly/`, como `.zip` (gzip de um
arquivo SQLite). São gerados ao subir a aplicação e às 00:05.

```bash
# inspecionar um backup sem tocar no banco atual
gunzip -c data/backups/daily/stocks-2026-06-09.zip > /tmp/inspecao.db
sqlite3 /tmp/inspecao.db "SELECT COUNT(*) FROM transactions"

# restaurar
# 1. pare a aplicação
gunzip -c data/backups/daily/stocks-2026-06-09.zip > data/stocks.db
# 2. suba de novo
```

## Alterando o schema

Nunca edite o banco com `ALTER TABLE` na mão: o Prisma perde a sincronia com as migrations.

```bash
# 1. edite prisma/schema.prisma
# 2. gere e aplique a migration
npm run db:migrate
# 3. o client é regenerado automaticamente
```

Para conferir se schema e banco batem: `npx prisma migrate status`.
