# Fase 0 — Resultado do spike

Executado em 2026-07-24. Código descartável, rodado fora do repositório. Este documento é o entregável.

**Versões encontradas ao instalar (`latest` em 2026-07-24):** Node 22.23.1, Prisma 7.9.0, Fastify 5.10.0,
Biome 2.5.5, preact-render-to-string 6.7.0, better-sqlite3 12.11.1, TypeScript 7.0.2, ESLint 10.8.0,
typescript-eslint 8.65.0.

**Resultado:** 25 de 26 verificações passaram; a única falha foi assertiva errada minha, não comportamento.
As cinco decisões do §3 do plano **se confirmam**. Mas o spike derrubou três premissas de ferramental e
achou um furo sério de lint. Detalhes abaixo.

---

## 1. Confirmado sem ressalva

| Verificação | Resultado |
|---|---|
| `ORDER BY` em data-string ordena cronologicamente | `2023-11-20 · 2024-01-05 · 2024-02-29 · 2024-03-15 · 2024-12-31` |
| `WHERE gte/lte` em data-string filtra intervalo | `2024-02-01..2024-03-31` → `2024-02-29 · 2024-03-15` |
| Data não sofre deslocamento de fuso no round-trip | `2024-12-31` volta `2024-12-31` |
| `createdAt DateTime` volta como `Date` | ok — instantes continuam sendo instantes |
| `ON DELETE CASCADE` remove as transações do ativo | 5 → 0 |
| `VACUUM INTO` via `$executeRawUnsafe` | 32.768 bytes, e o arquivo **abre e responde query** |
| `VACUUM` dentro de `$transaction` falha | falha, como esperado — confirma a regra do §3.5 |
| `$transaction` estoura e faz rollback | 800 ms de espera com `timeout: 500` → erro, escrita parcial desfeita |
| `include: { transactions: true }` | resolve o N+1 numa chamada |
| `app.inject()` sem abrir porta | 200, corpo completo |
| JSX: `map`, componente aninhado, `&&`, `??` | todos renderizam corretamente |
| `hx-swap-oob="true"` sobrevive ao render | ok |
| `setErrorHandler` distingue HTML de JSON e HTMX | ok |

**Migration gerada pelo Prisma, exatamente como o plano previa:**

```sql
CREATE TABLE "transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,          -- data como string ISO
    "quantity" REAL NOT NULL,      -- IEEE-754, idêntico ao Double do Kotlin
    CONSTRAINT "transactions_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "assets" ("ticker") ON DELETE CASCADE ON UPDATE CASCADE
);
```

**Escaping do `preact-render-to-string`** — testado com payloads reais, escapa por padrão em texto e em atributo:

```
<script>alert(1)</script>       → &lt;script>alert(1)&lt;/script>
"><img src=x onerror=alert(1)>  → &quot;>&lt;img src=x onerror=alert(1)>
O'Reilly & Sons                 → O'Reilly &amp; Sons
```

`>` fica solto, o que é seguro: sozinho não abre tag nem escapa de atributo com aspas. Confirma a escolha do
§3 por `preact-render-to-string` em vez de `@kitajs/html`, que exigiria marcação manual.

---

## 2. O furo: Biome não enxerga promise do Prisma

Era o item que decidia se o `typescript-eslint` entraria no plano. **Entra.**

Com `noFloatingPromises` **e** `noMisusedPromises` ligadas, o Biome empata com o typescript-eslint num arquivo
autocontido — 8 de 9 casos, nas mesmas posições exatas. Mas o teste que importa é o código real: service num
arquivo, rota em outro, tipos vindos do client gerado.

```ts
export function c(prisma: PrismaClient) {
  prisma.asset.create({ data: { ticker: 'VALE3' } })    // sem await: não grava, não avisa
}
```

| | A: service cross-file | B: `if (svc.exists())` | **C: `prisma.create()` direto** | D: `forEach(async)` |
|---|---|---|---|---|
| Biome 2.5.5 | pega | pega | **NÃO PEGA** | pega |
| typescript-eslint 8.65 | pega | pega | **pega** | pega |

**Causa, confirmada na fonte:** `PrismaPromise<T> extends Promise<T>`. A inferência própria do Biome não segue
a herança de interface através dos arquivos de declaração — no mesmo arquivo ele sinaliza uma `Promise` nativa
e ignora a `PrismaPromise` na linha seguinte. O typescript-eslint usa o type checker do TypeScript e resolve.

Isso não é uma lacuna de canto: **toda chamada ao banco desta aplicação retorna `PrismaPromise`**. A regra que
protegeria o ponto mais perigoso da migração é exatamente a que falha.

Vale registrar o caso B, que não é hipotético — é o `AssetController.createAssetForm` de hoje:

```kotlin
if (assetService.exists(normalizedTicker)) { ... }   // Kotlin: Boolean
```
```ts
if (svc.exists(ticker)) { ... }                      // TS sem await: Promise, sempre truthy
```

Um caso que **nenhuma das duas** pega: `const p = save()` — promise atribuída e nunca aguardada. Ambas tratam
atribuição como "tratamento". Fica como item de revisão de código, não de lint.

### Consequência: TypeScript fica no 5.9, não no 7

`npm install typescript` hoje traz a **7.0.2** (o compilador nativo em Go). Mas:

```
peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.65.0
```

O typescript-eslint ainda não suporta TS 7. Como ele passou a ser obrigatório, o TypeScript fica pinado em
**5.9.3**. É a troca certa: ganho de velocidade de compilação em 5,5k linhas é irrelevante perto de perder a
única regra que pega `await` esquecido em chamada de banco. Revisar depois da migração concluída.

---

## 3. Prisma 7 mudou três coisas que o plano assumia

**a) `url` saiu do `schema.prisma`.** Agora vive num `prisma.config.ts` na raiz:

```ts
import { defineConfig, env } from 'prisma/config'

process.loadEnvFile()   // Prisma 7 não carrega .env sozinho; Node 22 tem loader nativo

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
})
```

O datasource no schema fica só com `provider = "sqlite"`. **Nenhum `dotenv` necessário.**

**b) O generator é `prisma-client`, não `prisma-client-js`,** e exige `output`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```

Ele emite **TypeScript**, não JavaScript compilado — o client é checado junto com o resto do projeto.
`src/generated/` precisa entrar no `.gitignore` e ser excluído do Biome (`"!src/generated/**"`).

**c) O client exige driver adapter:**

```ts
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'   // atenção: "Sqlite", q minúsculo
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:./data/stocks.db' }) })
```

Detalhe irônico: **o Prisma 7 roda sobre o `better-sqlite3`**. O driver síncrono está lá embaixo — só não é
exposto. A escolha do §3.2 (tudo `async` a partir do service) continua valendo, mas por decisão de API do
Prisma, não por limitação do driver.

---

## 4. Dois ajustes menores descobertos

**`journal_mode` não é WAL por padrão** — vem `delete`. Confirma que o `PRAGMA` do §6 é obrigatório, não
cosmético. Já `foreign_keys` **veio ligado** pelo adapter (retorna `1n`, BigInt), mas setar explicitamente
custa nada e protege contra mudança de default.

**Um helper de view não basta.** No spike, o decorator único prefixava `<!DOCTYPE html>` também nos fragmentos
HTMX. São dois helpers:

```ts
reply.html(<Page />)        // com <!DOCTYPE html>, para páginas
reply.partial(<Fragment />) // sem, para respostas HTMX
```

**Banco `:memory:` funciona** no adapter (`url: ':memory:'`). Vale reavaliar a estratégia do §8, que previa
arquivo temporário por worker: `:memory:` é mais rápido e mais isolado. A ressalva é que a migration precisa
ser aplicada em cada conexão nova, já que nada persiste — medir os dois na fase 1.

---

## 5. O que muda no plano

| § | Mudança |
|---|---|
| 2 | TypeScript pinado em **5.9.3** (não 7.x) — dependência do typescript-eslint |
| 5 | `typescript-eslint` deixa de ser condicional e **entra como obrigatório**, com `no-floating-promises`, `no-misused-promises` e `await-thenable`. Biome mantém `noFloatingPromises` + `noMisusedPromises` para o feedback rápido no editor |
| 6 | `url` sai do `datasource` → `prisma.config.ts`; generator vira `prisma-client` com `output`; adapter `@prisma/adapter-better-sqlite3` obrigatório; `.env` carregado com `process.loadEnvFile()` |
| 6 | `src/generated/` no `.gitignore` e fora do Biome |
| 8 | Avaliar `:memory:` no lugar de arquivo temporário por worker |
| 5 | Dois helpers de view (`html` e `partial`), não um |

Nenhuma das cinco decisões técnicas do §3 mudou. O que mudou foi ferramental — e o achado do Biome é o
tipo de coisa que teria custado dias se aparecesse na fase 4, com trinta chamadas de banco já escritas.
