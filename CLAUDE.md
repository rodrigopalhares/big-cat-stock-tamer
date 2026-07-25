# Stocks Application

Aplicação pessoal de acompanhamento de carteira de investimentos, em TypeScript.

## Comandos

- **Rodar**: `npm run dev`
- **Build**: `npm run build`
- **Testes**: `npm test`
- **Tipos**: `npm run typecheck`
- **Lint**: `npm run lint` (Biome + typescript-eslint + dependency-cruiser + prisma validate)
- **Formatar**: `npm run format`
- **Tudo**: `npm run check`
- **Migrations**: `npm run db:migrate` (dev) · `npm run db:deploy` (aplicar) · `npm run db:seed`

## Diretrizes

- **Simplicidade**: prefira solução simples a abstração complexa.
- **Código em inglês**, **interface em português** (labels, mensagens, textos de tela).
- **Mudanças cirúrgicas**: mexa no necessário e verifique com testes.
- **Testes obrigatórios**: ao criar ou alterar uma feature, crie ou atualize os testes junto,
  no mesmo commit.
- **Skills**: quando uma feature tem skill em `.claude/skills/`, atualize a skill se a
  mudança afetar o escopo dela.

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript 5.9 / Node 22 |
| Servidor | Fastify 5 |
| Banco | SQLite (better-sqlite3) |
| ORM / migrations | Prisma 7 |
| Views | JSX no servidor (`preact-render-to-string`) + HTMX |
| CSS | Bootstrap 5 (CDN) |
| Validação | Zod |
| HTTP client | `fetch` nativo |
| Scheduler | croner |
| Testes | Vitest + MSW |
| Lint/format | Biome + typescript-eslint + dependency-cruiser |

## Arquitetura

Módulos por feature em `src/modules/<feature>/`, cada um com rota, service, schema e teste
juntos. O que não é de feature fica fora:

```
src/
  domain/        funções puras — cálculo, XIRR, regressão, parsing de CSV. Sem I/O.
  integrations/  clientes HTTP (Yahoo, BCB, Tesouro). Não persistem.
  modules/       uma pasta por feature: *.routes.ts, *.service.ts, *.schema.ts, *.test.ts
  views/         componentes JSX. Recebem tudo por props.
  plugins/       hooks do Fastify (auth, erros, views)
  infra/         backup e scheduler
  shared/        utilidades sem dono (datas, formatação, HttpError)
  client/        TypeScript de navegador, compilado por esbuild para public/js/
  config/        ambiente (Zod) e conexão do banco
  container.ts   composition root — instancia e liga os services
```

### Regras de camada

Verificadas pelo `dependency-cruiser` no CI, não só combinadas:

- `domain/` não importa Prisma, Fastify, service ou integração. Se precisa de `await`,
  não pertence ao domínio.
- `views/` não chama service nem Prisma. Import **type-only** de schema é permitido — é o
  contrato tipado entre rota e view.
- `integrations/` busca dado externo e devolve; quem persiste é o service.
- Rota não tem lógica de negócio: valida com Zod, chama um service, escolhe a resposta.

## Convenções

- Arquivos em `kebab-case`, com sufixo `.service.ts`, `.routes.ts`, `.schema.ts`, `.test.ts`.
- Sem `export default` — sempre nomeado.
- `any` proibido; use `unknown` + validação Zod na fronteira externa.
- Erros de aplicação via `HttpError`; um único `setErrorHandler` decide HTML ou JSON.

## Decisões que valem conhecer antes de mexer

**Data de calendário é `string` ISO, não `Date`.** O tipo `IsoDate` em `src/shared/iso-date.ts`
substitui o `LocalDate` do Java. Toda aritmética passa por `Date.UTC`, então nada depende do
fuso do processo. Usar `Date` para data de transação reintroduz o bug de "o dia 1º aparece
como dia 31 do mês anterior".

**Nada de rede dentro de transação.** O SQLite tem escritor único; segurar o lock durante uma
chamada HTTP trava a aplicação inteira. Busque primeiro, escreva depois.

**`Float` continua `Float`.** Não troque por `Decimal` sem uma bateria de validação própria —
os resultados de TIR e preço médio mudariam.

**Backup é `VACUUM INTO`**, cópia consistente com a aplicação escrevendo. Nunca cópia de arquivo.

## Banco de dados

SQLite em `${APP_DATA_DIR}/stocks.db` (padrão `./data`). Migrations em `prisma/migrations/`,
aplicadas com `npm run db:deploy`. `PRAGMA journal_mode = WAL` e `foreign_keys = ON` são
aplicados no boot — o segundo é obrigatório, senão o SQLite ignora silenciosamente os
`ON DELETE CASCADE`.

## Backup

`BackupService` (I/O) + `backup-retention` (política pura) tiram snapshot ao subir e às 00:05
(`America/Sao_Paulo`). Dois conjuntos: `daily/stocks-yyyy-MM-dd.db.gz` (7 cópias) e
`monthly/stocks-yyyy-MM.db.gz` (3). Idempotente por período — reiniciar várias vezes no mesmo
dia não duplica nada. Banco em memória é no-op. Configuração em `APP_BACKUP_*`.
O arquivo é gzip de um `.db`, não um zip — restaurar é parar a aplicação e rodar
`gunzip -c <backup> > ${APP_DATA_DIR}/stocks.db`.

## Autenticação

Usuário único, senha em `APP_AUTH_PASSWORD`. Em branco, autenticação desabilitada.
As sessões são persistidas em `${APP_DATA_DIR}/auth.key` como *hashes* de token — o arquivo
nunca guarda o token em claro, então vazá-lo não dá acesso a ninguém.

## Histórico

Este projeto era Kotlin/Spring Boot e foi migrado para TypeScript. O plano, as decisões e o
porquê de cada escolha estão em `docs/migracao-typescript.md` e `docs/fase-0-spike.md`.
