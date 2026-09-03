"""
Texto completo das issues do GitHub, em Markdown, pronto para copiar e colar.

Achados triviais do mesmo tema estão agrupados numa issue só (F5 reúne cookie, cabeçalhos e
SRI; F3 reúne os sete redirects), para não virar spam de issue.
"""

ISSUES = [
    {
        "n": 1,
        "sev": "crítica",
        "title": "[Segurança] Senha em branco desliga a autenticação inteira sem falhar o boot",
        "labels": "`security`, `severity:crítica`, `auth`",
        "body": """## Problema

`APP_AUTH_PASSWORD` tem default de string vazia no schema de ambiente, e string vazia
significa **autenticação desligada** em três camadas encadeadas:

1. `AuthService` marca `authEnabled = false` (`auth.service.ts:46`);
2. `isValid()` passa a devolver `true` para qualquer token, inclusive nenhum (`auth.service.ts:74`);
3. o hook `onRequest` retorna antes de qualquer verificação (`plugins/auth.ts:22`).

`loadEnv()` valida o formato mas **não rejeita o valor vazio**, nem com `NODE_ENV=production`.
O boot segue normal; o único sinal é um `logger.warn` que, em produção, vira uma linha no
journal que ninguém lê.

### Por que é explorável

O `.env.example` distribui exatamente esse valor perigoso (linha 24) e copiar o exemplo é o
caminho documentado em `deploy/README.md`. O `listen` é em `0.0.0.0` (`main.ts:34`) e o próprio
README manda acessar por `http://<ip-da-maquina>:8001`. Resultado: transações, proventos,
patrimônio e os PDFs de notas de corretagem — com CPF e dados bancários — ficam legíveis e
graváveis por qualquer host da rede, sem credencial nenhuma. Não há pré-condição: basta a
variável estar ausente.

## Evidência

`src/config/env.ts:18`
```ts
APP_AUTH_PASSWORD: z.string().default(''),
```

`src/modules/auth/auth.service.ts:46,74`
```ts
this.authEnabled = options.password.length > 0
// ...
isValid(token: string | null | undefined): boolean {
  if (!this.authEnabled) return true
```

`src/plugins/auth.ts:22`
```ts
app.addHook('onRequest', async (request, reply) => {
  if (!auth.authEnabled) return
```

O comportamento já está fixado por teste em `tests/integration/auth.test.ts:160-176`
("sem senha configurada" → `GET /assets/` responde 200 sem cookie).

## Impacto

Exposição total da base de dados financeira e dos arquivos de nota a qualquer um com acesso
de rede à porta. É também o multiplicador da issue de XSS refletido: com autenticação
desligada, aquele self-XSS vira XSS pleno explorável cross-site.

## Correção sugerida

Em `src/config/env.ts`, um `superRefine` que rejeite senha vazia quando
`NODE_ENV === 'production'` e exija tamanho mínimo. Se o modo aberto precisa continuar
existindo para desenvolvimento, torná-lo **explícito** (`APP_AUTH_DISABLED=true`) em vez de
implícito num campo vazio — ninguém deve desligar autenticação por omissão.

## Critérios de aceite

- [ ] `loadEnv()` lança erro quando `NODE_ENV=production` e `APP_AUTH_PASSWORD` está vazia
- [ ] Senha aceita apenas com tamanho mínimo definido (sugestão: 12 caracteres)
- [ ] Desligar a autenticação exige uma variável explícita, nunca um campo em branco
- [ ] `.env.example` documenta que a senha é obrigatória em produção
- [ ] Teste cobrindo: produção + senha vazia derruba o boot; produção + senha válida sobe
- [ ] Teste existente de "sem senha configurada" atualizado para o novo contrato explícito
""",
    },
    {
        "n": 2,
        "sev": "alta",
        "title": "[Segurança] XSS refletido: handler de erro devolve mensagem crua como text/html",
        "labels": "`security`, `severity:alta`, `xss`",
        "body": """## Problema

O `setErrorHandler` é o ponto único de tradução de erro para resposta, e no ramo HTML ele
envia `error.message` declarando `text/html` — o navegador interpreta a string como marcação.
Toda a defesa de XSS do projeto está nas views JSX, que escapam por padrão; **este caminho não
passa por view nenhuma**.

### Por que é explorável

Basta que uma mensagem de erro carregue texto vindo do usuário, e três carregam:
`asset-class.service.ts:27` e `:37` interpolam o nome da classe informado no formulário, e
`anthropic.client.ts:115` interpola o `Content-Type` do upload. O nome da classe é persistido,
então a mensagem se repete a cada nova tentativa de cadastro com o mesmo nome.

Com autenticação ligada, o `SameSite=Lax` do cookie limita o alcance a self-XSS. **Com a
autenticação desligada** (ver a issue de senha em branco), um formulário em site de terceiro
faz `POST` para `/allocation/classes/new` e o navegador renderiza a resposta **na origem da
aplicação** — XSS pleno.

## Evidência

`src/plugins/errors.ts:24,27`
```ts
if (request.headers['hx-request']) {
  return reply.code(status).header('HX-Retarget', '#error-banner').send(error.message)
}
return reply.code(status).type('text/html; charset=utf-8').send(error.message)
```

`src/modules/allocation/asset-class.service.ts:27` (e idêntico em `:37`)
```ts
throw HttpError.conflict(`Já existe uma classe chamada '${form.name}'.`)
```

Reproduzido com `app.inject` — `POST /allocation/classes/new` com
`name=<svg onload=alert(1)>`, duas vezes:

```
1ª → 302 (classe criada)
2ª → 409  content-type: text/html; charset=utf-8
     corpo: Já existe uma classe chamada '<svg onload=alert(1)>'.
```

O payload volta literal, sem `&lt;`. O limite de 40 caracteres do schema encurta o payload,
não o impede.

## Impacto

Execução de script na origem da aplicação. Como o cookie é `httpOnly`, o roubo direto de
sessão está contido, mas o script age como o usuário: criar/apagar transações e proventos,
ler o histórico inteiro e baixar os PDFs de notas de corretagem.

## Correção sugerida

Escapar a mensagem nos ramos HTML e HTMX do `setErrorHandler` — ou, mais simples, responder
`text/plain`, que resolve sem tocar em template algum. Em paralelo, parar de interpolar
entrada do usuário em mensagem de erro: a mensagem diz **o que** houve, e a interface, que
escapa, é quem mostra o valor.

## Critérios de aceite

- [ ] Resposta de erro não interpreta HTML vindo da mensagem (escape ou `text/plain`)
- [ ] O mesmo vale para o ramo HTMX (`HX-Retarget`)
- [ ] `asset-class.service.ts:27` e `:37` deixam de interpolar `form.name` na mensagem
- [ ] Teste: conflito de nome com `<svg onload=alert(1)>` não devolve a tag literal em HTML
- [ ] Teste cobrindo o ramo HTMX com o mesmo payload
""",
    },
    {
        "n": 3,
        "sev": "alta",
        "title": "[Segurança] Open redirect: returnTo vai direto para o Location em 7 endpoints",
        "labels": "`security`, `severity:alta`, `open-redirect`",
        "body": """## Problema

Sete handlers aceitam `returnTo` do corpo do formulário e o entregam ao `reply.redirect()`
sem verificar que é um caminho interno. O schema declara o campo apenas como
`z.string().optional()`, então qualquer URL absoluta passa.

Os sete pontos:

| Arquivo | Linha | Rota |
|---|---|---|
| `src/modules/asset/asset.routes.ts` | 184 (via `destinationOf`, 27-30) | `POST /assets/:ticker/edit` |
| `src/modules/transaction/transaction.routes.ts` | 134 | `POST /transactions/new` |
| `src/modules/transaction/transaction.routes.ts` | 158 | `POST /transactions/:id/edit` |
| `src/modules/transaction/transaction.routes.ts` | 165 | `POST /transactions/:id/delete` |
| `src/modules/dividend/dividend.routes.ts` | 71 | `POST /dividends/new` |
| `src/modules/dividend/dividend.routes.ts` | 85 | `POST /dividends/:id/edit` |
| `src/modules/dividend/dividend.routes.ts` | 91 | `POST /dividends/:id/delete` |

### Por que é explorável

O redirect acontece **depois** de uma ação legítima e bem-sucedida. O usuário apaga uma
transação, a operação funciona, e ele é despejado numa cópia da tela de login hospedada pelo
atacante — o contexto de "acabei de operar no sistema" é justamente o que torna o phishing de
senha convincente. A forma `//host` é a mais traiçoeira: parece caminho relativo e o navegador
a lê como URL protocol-relative.

O comentário em `asset.routes.ts:19-26` mostra que o campo já deu problema antes, mas o
conserto tratou a string vazia, não o destino externo.

## Evidência

`src/modules/asset/asset.routes.ts:27-30,184`
```ts
function destinationOf(returnTo: string | undefined): string {
  const trimmed = returnTo?.trim() ?? ''
  return trimmed === '' ? '/assets/' : trimmed
}
// ...
return reply.redirect(withPriceWarning(destinationOf(form.returnTo), warn), 302)
```

`src/modules/transaction/transaction.routes.ts:165`
```ts
return reply.redirect(returnTo ?? '/transactions/', 302)
```

Reproduzido com `app.inject`, com sessão válida:

```
POST /transactions/<id>/delete  returnTo=https://evil.example.com/phish
  → 302  Location: https://evil.example.com/phish
POST /assets/PETR4/edit         returnTo=//evil.example.com/
  → 302  Location: //evil.example.com/
POST /dividends/new             returnTo=https://evil.example.com/
  → 302  Location: https://evil.example.com/
```

## Impacto

Phishing de credencial com a autoridade do domínio da aplicação, no momento de maior
confiança do usuário. Também serve de trampolim para levar a vítima a qualquer destino
externo a partir de um link que aparenta ser interno.

## Correção sugerida

Um helper em `src/shared/` que aceite apenas caminho interno — começa com uma barra e **não**
com `//` nem `/\\` — e devolva o default quando não passar. Usá-lo nos sete pontos.

## Critérios de aceite

- [ ] Helper de validação de destino interno criado em `src/shared/`
- [ ] Os sete redirects listados passam por ele
- [ ] Teste fixando os casos rejeitados: `https://host`, `//host`, `/\\host`, `http:/host`
- [ ] Teste fixando os casos aceitos: `/assets/`, `/transactions/?ticker=PETR4`, vazio → default
- [ ] Destino inválido cai no default, sem erro visível ao usuário
""",
    },
    {
        "n": 4,
        "sev": "alta",
        "title": "[Segurança] Login sem limite de tentativas e sessão de 365 dias",
        "labels": "`security`, `severity:alta`, `auth`",
        "body": """## Problema

A aplicação tem **um segredo só**, e ele protege tudo. O handler de login compara a senha e
responde 401 — sem contabilizar tentativas por IP, sem atraso progressivo, sem bloqueio
temporário. Não há `@fastify/rate-limit` nem equivalente nas dependências.

### Por que é explorável

O serviço escuta em `0.0.0.0` (`main.ts:34`), então qualquer host da rede pode tentar senhas na
velocidade que o servidor aguentar. A comparação em tempo constante
(`auth.service.ts:124-129`) protege contra ataque de temporização, mas não contra volume — são
problemas diferentes. E o sucesso é duradouro: a sessão padrão vale **365 dias**
(`env.ts:19`), então um acerto único dá um ano de acesso.

## Evidência

`src/modules/auth/auth.routes.ts:19-31`
```ts
app.post('/login', async (req, reply) => {
  const { password } = LoginForm.parse(req.body)
  const token = c.auth.login(password)

  if (token === null) {
    return reply.code(401).html(LoginPage({ error: true }))
  }
  // ... sem contador, sem atraso, sem bloqueio
})
```

`src/config/env.ts:19`
```ts
APP_AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(365),
```

Reproduzido com `app.inject`: 30 POSTs consecutivos para `/login` com senhas erradas. Todos
responderam 401 — nenhum 429, nenhum atraso, nenhum bloqueio.

## Impacto

Ataque de força bruta contra a única credencial do sistema, na velocidade da rede local.
Acertar uma vez concede um ano de acesso a toda a carteira.

## Correção sugerida

Registrar `@fastify/rate-limit` **apenas** na rota de login (sugestão: 5 tentativas por minuto
por IP, com bloqueio crescente) e reduzir `APP_AUTH_SESSION_DAYS` para uma janela defensável.
Um contador de falhas em memória no `AuthService`, com pausa após N erros, já muda a ordem de
grandeza do ataque.

## Critérios de aceite

- [ ] `POST /login` limitado por IP, devolvendo 429 ao estourar
- [ ] Tentativas malsucedidas registradas em log (sem a senha tentada)
- [ ] `APP_AUTH_SESSION_DAYS` com default reduzido e documentado no `.env.example`
- [ ] Teste: N+1 tentativas erradas seguidas devolvem 429
- [ ] Teste: o limite não afeta um login legítimo após o intervalo
""",
    },
    {
        "n": 5,
        "sev": "média",
        "title": "[Segurança] Cookie sem Secure, respostas sem cabeçalhos de segurança e CDNs sem SRI",
        "labels": "`security`, `severity:média`, `hardening`",
        "body": """## Problema

Três lacunas de configuração agrupadas nesta issue por serem do mesmo tema — endurecimento da
camada HTTP.

**(a) Cookie de sessão sem `Secure`.** `sessionCookieOptions` define `httpOnly`, `path` e
`sameSite`, mas não `secure`. O deploy documentado serve HTTP puro na LAN
(`deploy/README.md:100`), então o token — válido por 365 dias — trafega em claro em toda
requisição. Quem capturar o tráfego do segmento e roubar o cookie entra sem precisar da senha.

**(b) Nenhum cabeçalho de segurança.** `buildApp()` não registra helmet nem define
`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` ou `Referrer-Policy`.
Uma CSP teria contido o impacto do XSS refletido reportado em issue separada.

**(c) CDNs sem SRI.** As três tags externas de `layout.tsx:68-76` (jsdelivr e unpkg) não têm
atributo `integrity`, então a aplicação executa com privilégio total de origem o que esses
hosts entregarem.

## Evidência

`src/plugins/auth.ts:41-47`
```ts
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    maxAge: maxAgeSeconds,
  }   // sem `secure`
}
```

Cabeçalhos reais de `GET /login`, capturados na auditoria:
```
content-type, content-length, date, connection
```
Nenhum cabeçalho de segurança.

`src/views/layout.tsx:68-76` — três `<link>`/`<script>` para CDN, nenhum com `integrity`.

## Impacto

(a) Roubo de sessão por quem estiver no mesmo segmento de rede — realista numa LAN doméstica
com outros dispositivos. (b) e (c) são redução de defesa em profundidade: nenhum é explorável
sozinho, mas ambos ampliam o estrago de qualquer XSS ou comprometimento de CDN.

## Correção sugerida

- `secure: true` quando `NODE_ENV=production`, com a aplicação atrás de TLS (certificado
  próprio serve num deploy de LAN);
- registrar `@fastify/helmet` com CSP restritiva;
- fixar `integrity` nas três tags de CDN, ou passar a servir esses assets do próprio `public/`.

## Critérios de aceite

- [ ] Cookie de sessão sai com `Secure` em produção
- [ ] Respostas trazem CSP, `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`
- [ ] A CSP não quebra o HTMX nem o Chart.js (verificado com a aplicação rodando)
- [ ] As três tags de CDN têm `integrity` + `crossorigin`, ou os assets são locais
- [ ] Teste asseverando `Secure` no `Set-Cookie` com `NODE_ENV=production`
""",
    },
    {
        "n": 6,
        "sev": "baixa",
        "title": "[Segurança] Erro de validação vira 500 e devolve a estrutura interna do Zod",
        "labels": "`security`, `severity:baixa`, `dx`",
        "body": """## Problema

As rotas de allocation passam por um helper `parseForm()` que converte erro de Zod em 400 com
mensagem curta (`allocation.routes.ts:71-77`). **As demais chamam `.parse()` direto**: o
`ZodError` sobe sem `statusCode`, o handler classifica como 500, registra como "erro não
tratado" (`errors.ts:13`) e devolve ao cliente o JSON completo das issues — caminho do campo,
código interno e valor recebido.

O comentário em `allocation.routes.ts:65-70` já diagnosticou o problema; a correção só não foi
propagada para os outros módulos.

## Evidência

`src/plugins/errors.ts:11`
```ts
const status = isHttpError(error) ? error.statusCode : (error.statusCode ?? 500)
```

`src/modules/dividend/dividend.routes.ts:61` (mesmo padrão em `transaction.routes.ts:113`,
`:138`, e nas rotas `/api`)
```ts
const form = DividendForm.parse(req.body)
```

Reproduzido: `POST /dividends/new` com `total_amount` não numérico →
```
500
[ { "expected": "number", "code": "invalid_type", "received": "NaN",
    "path": ["total_amount"], "message": "Invalid input: expected number, received NaN" } ]
```

## Impacto

Sem impacto direto de confidencialidade neste projeto — é higiene de erro. O custo real é
operacional: o log de erro enche de "erro não tratado" para o que na verdade é pedido
malfeito, e um 500 esconde que o problema é do cliente, atrapalhando o diagnóstico do
problema seguinte.

## Correção sugerida

Promover o `parseForm()` de `allocation.routes.ts` para `src/shared/` e usá-lo em todas as
rotas; ou tratar `ZodError` no próprio `setErrorHandler`, convertendo para 400 com a primeira
mensagem.

## Critérios de aceite

- [ ] Falha de validação responde 400, não 500, em todas as rotas
- [ ] A resposta traz mensagem curta, não o array de issues do Zod
- [ ] Requisição malfeita registra `warn`, não `error`, no log
- [ ] Teste cobrindo pelo menos uma rota de formulário e uma rota `/api`
""",
    },
]
