"""
Dados da auditoria de segurança — separados do gerador para que reescrever o layout do PDF
não obrigue a mexer nos achados, e vice-versa.

Cada achado aponta arquivo:linha verificados no código real em 2026-09-02.
"""

PROJECT = "Big Cat Stock Tamer"
DATE = "2 de setembro de 2026"
COMMIT = "1a1a768"

SEVERITIES = ["crítica", "alta", "média", "baixa", "informativa"]

COLORS = {
    "crítica": "#B91C1C",
    "alta": "#EA580C",
    "média": "#D97706",
    "baixa": "#2563EB",
    "informativa": "#64748B",
    "forte": "#059669",
}

STACK = [
    ("Linguagem / runtime", "TypeScript 5.9 · Node 22 (ESM)"),
    ("Framework HTTP", "Fastify 5 (+ @fastify/cookie, formbody, multipart, static)"),
    ("ORM / banco", "Prisma 7 · SQLite via @prisma/adapter-better-sqlite3"),
    ("Autenticação", "Usuário único, senha em APP_AUTH_PASSWORD; sessão em cookie + arquivo de hashes"),
    ("Frontend", "JSX renderizado no servidor (preact-render-to-string) + HTMX + Bootstrap 5 via CDN"),
    ("Client-side", "TypeScript compilado por esbuild para public/js/"),
    ("Validação", "Zod 4 na fronteira de rota e de integração"),
    ("Deploy", "systemd (deploy/big-cat.service + big-cat.path) · GitHub Actions (.github/workflows/ci.yml)"),
    ("Sem Docker/Helm/Terraform", "Não há Dockerfile, docker-compose, chart Helm nem módulo Terraform no repositório"),
]

METHODOLOGY = [
    (
        "1. Banco sem tranca (isolamento de inquilino)",
        "O equivalente de RLS nesta stack seria um filtro por dono nas queries do Prisma. "
        "O schema (prisma/schema.prisma) foi lido por inteiro: os 11 modelos — AssetClass, Asset, "
        "Transaction, BrokerNote, Dividend, PriceHistory, MonthlySnapshot, ExchangeRate, "
        "BenchmarkPrice, CdiRate, RiskMetric — não têm coluna de usuário, organização, workspace "
        "ou tenant. A aplicação é single-user por desenho (uma senha só, sem tabela de usuários). "
        "Categoria NÃO APLICÁVEL: não existe inquilino a isolar. O mecanismo de isolamento "
        "real é o portão de sessão único do onRequest em src/plugins/auth.ts:21, auditado na "
        "categoria 4.",
    ),
    (
        "2. Permissão definida no navegador",
        "Não há sistema de papéis (nenhum isAdmin, canEdit ou role no código). O único gate de "
        "recurso na interface é a aba de importação por nota de negociação, escondida quando "
        "noteImportEnabled é falso (transaction.routes.ts:107 → views/pages/transactions.tsx). "
        "Esse gate FOI cruzado com o backend e tem verificação equivalente no servidor "
        "(anthropic.client.ts:110), confirmada por requisição direta. Categoria sem achados.",
    ),
    (
        "3. IDOR",
        "Os 58 handlers registrados foram percorridos um a um (não por amostragem): 8 em "
        "allocation, 9 em asset, 3 em auth, 11 em dividend, 4 em evolution, 4 em portfolio, "
        "2 em risk, 15 em transaction e 2 em app.ts. Todas as rotas endereçadas por id "
        "(/transactions/:id, /dividends/:id, /allocation/classes/:id, /transactions/notes/:id) "
        "operam sobre objetos de um único dono. Sem segunda identidade no sistema, não há posse "
        "cruzada a violar. Categoria NÃO APLICÁVEL na forma clássica; ver o ponto de atenção "
        "registrado como informativo.",
    ),
    (
        "4. Chaves expostas",
        "Varridos: código-fonte, prisma/, tests/, docs/, .env.example, .github/workflows/ci.yml, "
        "deploy/*.service e deploy/README.md, além do histórico completo do git (git log --all -S "
        "e git grep sobre todos os commits, procurando sk-ant-, AKIA e blocos PRIVATE KEY). "
        "Nenhum segredo real embutido. O achado desta categoria é o oposto: um default vazio que "
        "desliga um controle de segurança inteiro sem validação de boot que o rejeite.",
    ),
    (
        "5. Inputs sem tratamento (XSS)",
        "Frontend: procurados innerHTML, outerHTML, insertAdjacentHTML, eval, new Function, "
        "document.write e dangerouslySetInnerHTML em src/client/ e src/views/. Backend: "
        "procurado input do usuário chegando a resposta HTML sem escape. As views JSX escapam "
        "por padrão; o caminho furado é a resposta de erro em texto puro, comprovado por "
        "requisição real.",
    ),
]

# --------------------------------------------------------------------------------------
# Achados
# --------------------------------------------------------------------------------------

FINDINGS = [
    {
        "id": "F1",
        "sev": "crítica",
        "cat": "4. Chaves expostas / default inseguro",
        "title": "Senha em branco desliga a autenticação inteira, e nada no boot rejeita isso",
        "where": "src/config/env.ts:18",
        "refs": [
            ("src/config/env.ts", "18", "APP_AUTH_PASSWORD: z.string().default(''),"),
            ("src/modules/auth/auth.service.ts", "46", "this.authEnabled = options.password.length > 0"),
            ("src/modules/auth/auth.service.ts", "74", "if (!this.authEnabled) return true   // isValid()"),
            ("src/plugins/auth.ts", "22", "if (!auth.authEnabled) return   // hook onRequest"),
            (".env.example", "24", "APP_AUTH_PASSWORD="),
            ("src/main.ts", "34", "await app.listen({ port: env.PORT, host: '0.0.0.0' })"),
        ],
        "why": (
            "APP_AUTH_PASSWORD tem default de string vazia no schema Zod, e string vazia significa "
            "\"autenticação desligada\" em três camadas: o AuthService marca authEnabled como false "
            "(auth.service.ts:46), isValid() passa a devolver true para qualquer token — inclusive "
            "nenhum (auth.service.ts:74) — e o hook onRequest retorna antes de qualquer verificação "
            "(plugins/auth.ts:22). O loadEnv() valida formato mas não rejeita o valor vazio, nem "
            "mesmo com NODE_ENV=production, então o boot segue normalmente: o único sinal é um "
            "logger.warn (auth.service.ts:49) que, em produção, vai para o journal e ninguém lê. "
            "O .env.example distribui exatamente esse valor perigoso na linha 24 — copiar o exemplo "
            "e subir é o caminho documentado no README de deploy. E o listen é em 0.0.0.0 (main.ts:34), "
            "com o deploy/README.md:100 instruindo a acessar por http://<ip-da-maquina>:8001. "
            "O resultado é a carteira inteira — transações, proventos, patrimônio, PDFs de notas de "
            "corretagem com CPF e dados bancários — legível e gravável por qualquer host da rede, "
            "sem credencial nenhuma."
        ),
        "proof": (
            "O próprio teste do projeto documenta o comportamento: tests/integration/auth.test.ts:160-176, "
            "bloco \"sem senha configurada\", assevera que GET /assets/ responde 200 sem cookie. "
            "Confirmado nesta auditoria em app.inject: com APP_AUTH_PASSWORD='' todas as rotas abrem."
        ),
        "cond": "Ativo sempre que APP_AUTH_PASSWORD estiver ausente ou vazia no ambiente. Não depende de flag nem de outra configuração.",
        "fix": (
            "Tornar a senha obrigatória quando NODE_ENV=production, via superRefine no EnvSchema, "
            "e exigir tamanho mínimo. Se o modo aberto tiver de continuar existindo para "
            "desenvolvimento, torná-lo explícito (APP_AUTH_DISABLED=true) em vez de implícito num "
            "campo vazio — assim ninguém desliga a autenticação por omissão."
        ),
    },
    {
        "id": "F2",
        "sev": "alta",
        "cat": "5. Inputs sem tratamento (XSS)",
        "title": "Handler de erro devolve a mensagem crua com Content-Type text/html, sem escape",
        "where": "src/plugins/errors.ts:27",
        "refs": [
            ("src/plugins/errors.ts", "27", "return reply.code(status).type('text/html; charset=utf-8').send(error.message)"),
            ("src/plugins/errors.ts", "24", "return reply.code(status).header('HX-Retarget', '#error-banner').send(error.message)"),
            ("src/modules/allocation/asset-class.service.ts", "27", "throw HttpError.conflict(`Já existe uma classe chamada '${form.name}'.`)"),
            ("src/modules/allocation/asset-class.service.ts", "37", "throw HttpError.conflict(`Já existe uma classe chamada '${form.name}'.`)"),
            ("src/integrations/anthropic/anthropic.client.ts", "115", "throw HttpError.badRequest(`Tipo de arquivo não suportado: ${contentType}`)"),
        ],
        "why": (
            "O setErrorHandler é o ponto único de tradução de erro para resposta, e no ramo HTML ele "
            "envia error.message declarando text/html — o navegador então interpreta a string como "
            "marcação. Toda a defesa de XSS do projeto está nas views JSX, que escapam por padrão; "
            "este caminho não passa por view nenhuma. Basta que uma mensagem de erro carregue texto "
            "vindo do usuário, e três carregam: asset-class.service.ts:27 e :37 interpolam o nome da "
            "classe informado no formulário, e anthropic.client.ts:115 interpola o Content-Type do "
            "upload. O nome da classe é persistido, então a mensagem se repete a cada nova tentativa "
            "de cadastro com o mesmo nome."
        ),
        "proof": (
            "Reproduzido em app.inject nesta auditoria. POST /allocation/classes/new com "
            "name=<svg onload=alert(1)> (dentro do limite de 40 caracteres do schema) duas vezes:\n"
            "  1ª → 302 (classe criada)\n"
            "  2ª → 409, content-type: text/html; charset=utf-8\n"
            "  corpo: Já existe uma classe chamada '<svg onload=alert(1)>'.\n"
            "O payload volta literal, sem &lt;. Com a mesma sonda, um name de 41+ caracteres retorna "
            "\"Too big: expected string to have <=40 characters\" — o limite reduz o payload, não o impede."
        ),
        "cond": (
            "Com autenticação ligada, a exploração é limitada a self-XSS: o SameSite=Lax do cookie "
            "impede que um POST cross-site chegue autenticado à rota. Com a autenticação desligada "
            "(F1), um formulário em site de terceiro pode fazer POST para /allocation/classes/new e o "
            "navegador renderiza a resposta na origem da aplicação — XSS pleno, encadeado a partir de F1."
        ),
        "fix": (
            "No ramo HTML e no ramo HTMX do setErrorHandler, escapar a mensagem (ou responder "
            "text/plain, que já resolve sem tocar em template). Em paralelo, parar de interpolar "
            "entrada do usuário em mensagem de erro: a mensagem diz o que houve, a interface é que "
            "mostra o valor — e a interface escapa."
        ),
    },
    {
        "id": "F3",
        "sev": "alta",
        "cat": "5. Inputs sem tratamento (destino controlado pelo usuário)",
        "title": "Open redirect: o campo returnTo dos formulários vai direto para o Location",
        "where": "src/modules/asset/asset.routes.ts:184",
        "refs": [
            ("src/modules/asset/asset.routes.ts", "27-30", "function destinationOf(returnTo) { ... return trimmed === '' ? '/assets/' : trimmed }"),
            ("src/modules/asset/asset.routes.ts", "184", "return reply.redirect(withPriceWarning(destinationOf(form.returnTo), warn), 302)"),
            ("src/modules/transaction/transaction.routes.ts", "134", "return reply.redirect(form.returnTo ?? '/transactions/', 302)"),
            ("src/modules/transaction/transaction.routes.ts", "158", "return reply.redirect(form.returnTo ?? '/transactions/', 302)"),
            ("src/modules/transaction/transaction.routes.ts", "165", "return reply.redirect(returnTo ?? '/transactions/', 302)"),
            ("src/modules/dividend/dividend.routes.ts", "71", "return reply.redirect(form.returnTo ?? '/dividends/', 302)"),
            ("src/modules/dividend/dividend.routes.ts", "85", "return reply.redirect(form.returnTo ?? '/dividends/', 302)"),
            ("src/modules/dividend/dividend.routes.ts", "91", "return reply.redirect(returnTo ?? '/dividends/', 302)"),
        ],
        "why": (
            "Sete handlers aceitam returnTo do corpo do formulário e o entregam ao reply.redirect() "
            "sem nenhuma verificação de que é um caminho interno. O schema declara o campo apenas como "
            "z.string().optional() (transaction.schema.ts, dividend.schema.ts, asset.routes.ts:70), "
            "então qualquer URL absoluta passa. O comentário em asset.routes.ts:19-26 mostra que o "
            "campo já deu problema antes — mas o conserto tratou a string vazia, não o destino externo. "
            "Um link para /transactions/123/delete com returnTo=https://... apontando para uma cópia da "
            "tela de login devolve o usuário, depois de uma ação legítima e bem-sucedida na aplicação, "
            "a um site controlado pelo atacante: o contexto de \"acabei de operar no sistema\" é "
            "exatamente o que torna o phishing de senha convincente."
        ),
        "proof": (
            "Reproduzido em app.inject nesta auditoria, com sessão válida:\n"
            "  POST /transactions/<id>/delete   returnTo=https://evil.example.com/phish\n"
            "    → 302  Location: https://evil.example.com/phish\n"
            "  POST /assets/PETR4/edit          returnTo=//evil.example.com/\n"
            "    → 302  Location: //evil.example.com/\n"
            "  POST /dividends/new              returnTo=https://evil.example.com/\n"
            "    → 302  Location: https://evil.example.com/\n"
            "A forma //host é a mais traiçoeira: parece caminho relativo e o navegador a lê como "
            "URL protocol-relative."
        ),
        "cond": (
            "Exige que o usuário submeta o formulário — na prática, um link ou página preparada. "
            "Note que o redirect acontece DEPOIS da escrita no banco: mesmo com SameSite bloqueando "
            "o cookie num POST cross-site, a variante em que o próprio usuário é induzido a colar/"
            "seguir um link dentro da aplicação continua valendo."
        ),
        "fix": (
            "Validar returnTo como caminho interno antes de redirecionar: aceitar apenas strings que "
            "comecem com uma única barra e não com '//' nem '/\\'. Um helper em shared/ usado pelos "
            "sete pontos, com teste que fixe os casos https://, //host e /\\host."
        ),
    },
    {
        "id": "F4",
        "sev": "alta",
        "cat": "Mecanismo de autenticação (transversal às categorias 2 e 4)",
        "title": "POST /login não tem limite de tentativas, atraso nem bloqueio",
        "where": "src/modules/auth/auth.routes.ts:19",
        "refs": [
            ("src/modules/auth/auth.routes.ts", "19-31", "app.post('/login', ...)  — sem contador, sem atraso, sem bloqueio"),
            ("src/config/env.ts", "19", "APP_AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(365)"),
            ("package.json", "—", "sem @fastify/rate-limit nas dependências"),
        ],
        "why": (
            "A aplicação tem um segredo só, e ele protege tudo. O handler de login compara a senha e "
            "responde 401, sem contabilizar tentativas por IP, sem atraso progressivo e sem bloqueio "
            "temporário; não há @fastify/rate-limit nem equivalente no projeto. Como o serviço escuta "
            "em 0.0.0.0, qualquer host da rede pode tentar senhas na velocidade que o servidor "
            "aguentar. A comparação em tempo constante (auth.service.ts:124-129) protege contra ataque "
            "de temporização, mas não contra volume — são problemas diferentes. E o sucesso é "
            "duradouro: a sessão padrão vale 365 dias (env.ts:19), então um acerto único dá um ano de "
            "acesso."
        ),
        "proof": (
            "Reproduzido em app.inject nesta auditoria: 30 POSTs consecutivos para /login com senhas "
            "erradas. Todos responderam 401 — nenhum 429, nenhum atraso perceptível, nenhum bloqueio. "
            "O contraste está em tests/integration/auth.test.ts:97-107, que cobre a senha errada uma "
            "vez, mas não a repetição."
        ),
        "cond": "Sem pré-condição. Vale sempre que a autenticação estiver ligada — e é justamente o cenário 'protegido'.",
        "fix": (
            "Registrar @fastify/rate-limit só na rota de login (algo como 5 tentativas por minuto por "
            "IP, com bloqueio crescente), e reduzir APP_AUTH_SESSION_DAYS para uma janela defensável. "
            "Um contador de falhas em memória no AuthService, com pausa após N erros, já muda a ordem "
            "de grandeza do ataque."
        ),
    },
    {
        "id": "F5",
        "sev": "média",
        "cat": "4. Configuração de segurança",
        "title": "Cookie de sessão sem Secure e respostas sem cabeçalhos de segurança",
        "where": "src/plugins/auth.ts:41",
        "refs": [
            ("src/plugins/auth.ts", "41-47", "return { httpOnly: true, path: '/', sameSite: 'lax', maxAge }  — sem `secure`"),
            ("src/app.ts", "32-55", "buildApp() não registra helmet nem define CSP/X-Frame-Options/X-Content-Type-Options"),
            ("deploy/README.md", "100", "Acesse em http://<ip-da-maquina>:8001 (bind 0.0.0.0)"),
            ("src/views/layout.tsx", "68-76", "3 CDNs (jsdelivr, unpkg) carregadas sem atributo integrity"),
        ],
        "why": (
            "Três lacunas de configuração que se somam. (a) O cookie de sessão não tem o atributo "
            "Secure, e o deploy documentado serve HTTP puro na LAN: o token de 365 dias trafega em "
            "claro em toda requisição, visível para qualquer um que capture o tráfego do segmento — "
            "roubá-lo dá acesso completo sem precisar da senha. (b) Nenhuma resposta traz "
            "Content-Security-Policy, X-Content-Type-Options, X-Frame-Options ou Referrer-Policy "
            "(verificado nos cabeçalhos reais de GET /login: só content-type, content-length, date e "
            "connection). Uma CSP teria contido o impacto do F2. (c) As três tags de CDN em "
            "layout.tsx:68-76 não usam integrity/SRI, então a aplicação executa, com privilégio total "
            "de origem, o que jsdelivr e unpkg entregarem."
        ),
        "proof": (
            "Cabeçalhos de GET /login capturados nesta auditoria: {content-type, content-length, date, "
            "connection}. Nenhum cabeçalho de segurança. O Set-Cookie do login contém HttpOnly "
            "(asseverado em tests/integration/auth.test.ts:94) e não contém Secure."
        ),
        "cond": (
            "O item (a) exige um atacante no mesmo segmento de rede — realista num deploy de LAN "
            "doméstica com outros dispositivos. Os itens (b) e (c) são redução de defesa em "
            "profundidade, não falha explorável sozinha."
        ),
        "fix": (
            "Ligar `secure: true` quando NODE_ENV=production (e pôr a aplicação atrás de TLS, ainda "
            "que com certificado próprio); registrar @fastify/helmet com CSP restritiva; e fixar SRI "
            "nas três tags de CDN — ou passar a servir os assets do próprio public/."
        ),
    },
    {
        "id": "F6",
        "sev": "baixa",
        "cat": "5. Tratamento de erro",
        "title": "Falha de validação vira 500 e devolve a estrutura interna do Zod",
        "where": "src/plugins/errors.ts:11",
        "refs": [
            ("src/plugins/errors.ts", "11", "const status = isHttpError(error) ? error.statusCode : (error.statusCode ?? 500)"),
            ("src/modules/dividend/dividend.routes.ts", "61", "const form = DividendForm.parse(req.body)   // ZodError sem statusCode → 500"),
            ("src/modules/transaction/transaction.routes.ts", "113", "const form = TransactionForm.parse(req.body)"),
            ("src/modules/allocation/allocation.routes.ts", "71-77", "parseForm() — o jeito certo, usado só na allocation"),
        ],
        "why": (
            "As rotas de allocation passam por um helper parseForm() que converte erro de Zod em 400 "
            "com mensagem curta (allocation.routes.ts:71-77). As demais chamam .parse() direto: o "
            "ZodError sobe sem statusCode, o handler classifica como 500, registra como \"erro não "
            "tratado\" (errors.ts:13) e devolve ao cliente o JSON completo das issues — caminho do "
            "campo, código interno e valor recebido. É ruído de diagnóstico exposto e log de erro "
            "poluído com o que na verdade é pedido malfeito; o próprio comentário em "
            "allocation.routes.ts:65-70 já diagnosticou o problema, mas a correção não foi propagada."
        ),
        "proof": (
            "Reproduzido nesta auditoria: POST /dividends/new com total_amount não numérico → 500 e "
            "corpo com o array de issues do Zod, incluindo \"received\": \"NaN\" e o path do campo."
        ),
        "cond": "Requer sessão válida. Sem impacto direto de confidencialidade neste projeto — é higiene de erro e ruído operacional.",
        "fix": (
            "Promover o parseForm() de allocation.routes.ts para shared/ e usá-lo em todas as rotas, "
            "ou tratar ZodError no setErrorHandler convertendo para 400 com a primeira mensagem."
        ),
    },
    {
        "id": "F7",
        "sev": "informativa",
        "cat": "3. IDOR (nota prospectiva)",
        "title": "Rotas por id não têm verificação de posse — correto hoje, quebra no dia do multiusuário",
        "where": "src/modules/transaction/transaction.routes.ts:197",
        "refs": [
            ("src/modules/transaction/transaction.routes.ts", "197-203", "GET /transactions/notes/:id — serve o PDF de qualquer nota pelo id"),
            ("src/modules/broker-note/broker-note.service.ts", "167-171", "findNote(id) — busca por id, sem cláusula de dono"),
            ("src/modules/dividend/dividend.routes.ts", "74/88", "updateDividend(Number(id)) / deleteDividend(Number(id))"),
        ],
        "why": (
            "Não é falha: o sistema tem um dono só, e o portão de sessão já decide tudo. Fica "
            "registrado porque /transactions/notes/:id serve PDFs de notas de corretagem — o dado mais "
            "sensível do acervo — por id sequencial e sem nenhuma condição além de estar autenticado. "
            "No dia em que existir uma segunda identidade, estes são os handlers que viram IDOR "
            "imediatamente, e nenhum teste hoje falharia para avisar."
        ),
        "proof": "Leitura dos 58 handlers. Nenhuma cláusula de posse existe porque nenhuma coluna de dono existe (prisma/schema.prisma, 11 modelos).",
        "cond": "Não explorável na arquitetura atual.",
        "fix": "Se multiusuário entrar no roadmap, introduzir a coluna de dono junto com um helper de busca que exija o id do dono — não depois.",
    },
]

# --------------------------------------------------------------------------------------
# Pontos fortes verificados
# --------------------------------------------------------------------------------------

STRENGTHS = [
    (
        "Portão de sessão sem furo de prefixo",
        "src/plugins/auth.ts:21-35",
        "O hook onRequest é registrado por fastify-plugin, então vale para toda rota registrada "
        "depois — inclusive /health e as rotas /api. Testadas 12 variações de bypass contra a lista "
        "PUBLIC_PREFIXES (/login/../assets/, /js/../assets/, /js/%2e%2e/assets/, /favicon.ico/../assets/, "
        "//assets/, /logout/../assets/, /loginX/assets/, entre outras): todas redirecionaram para "
        "/login ou devolveram 404. Nenhuma alcançou conteúdo protegido.",
    ),
    (
        "Rotas JSON também protegidas",
        "src/app.ts:65-72",
        "Verificado individualmente: /portfolio/api, /assets/api, /allocation/api, /transactions/api, "
        "/dividends/api, /evolution/api e /health respondem 302 para /login sem sessão. Não há "
        "\"porta dos fundos\" de API fora do portão.",
    ),
    (
        "Sessão guardada como hash, comparada em tempo constante",
        "src/modules/auth/auth.service.ts:63, 84, 119-129",
        "O token é randomBytes(32) em base64url; o arquivo auth.key guarda apenas sha256 do token, "
        "então vazar o arquivo não dá acesso. A comparação usa timingSafeEqual com checagem prévia "
        "de tamanho. Sessões expiradas são descartadas na leitura (auth.service.ts:82).",
    ),
    (
        "Nenhum SQL cru recebe entrada do usuário",
        "src/config/db.ts:18-19, src/app.ts:61, src/infra/backup.ts:88+116",
        "Só existem três usos de $executeRawUnsafe/$queryRawUnsafe em produção: dois PRAGMA "
        "constantes, um SELECT 1 constante e o VACUUM INTO do backup — cujo caminho vem da "
        "configuração, não de requisição, e ainda passa por sqlLiteral() (backup.ts:116). Todo o "
        "resto do acesso a dados é Prisma parametrizado.",
    ),
    (
        "Escape por padrão nas views, com um único dangerouslySetInnerHTML e ele é literal",
        "src/views/layout.tsx:59-65",
        "A varredura em src/views/ encontrou uma só ocorrência de dangerouslySetInnerHTML: o script "
        "inline de tema, uma string constante sem interpolação. Todos os dados de usuário passam pelo "
        "escape do preact-render-to-string.",
    ),
    (
        "Realce de JSON por tokens, não por HTML montado à mão",
        "src/shared/json-view.ts:1-8, 30-55",
        "A resposta do modelo (texto externo, não confiável) é exibida com destaque de sintaxe. "
        "O módulo devolve tokens tipados para o JSX escapar, em vez de string com <span> — a decisão "
        "está escrita no cabeçalho do arquivo e evita exatamente a injeção que um "
        "dangerouslySetInnerHTML criaria.",
    ),
    (
        "innerHTML no cliente só recebe HTML do próprio servidor; erro vai por textContent",
        "src/client/transactions.ts:551-566, src/client/dividends.ts:41-47",
        "Os pontos que usam innerHTML (transactions.ts:552, dividends.ts:51) injetam fragmentos "
        "renderizados pelas views JSX, já escapados. As mensagens de erro — que podem vir do servidor "
        "em texto puro — são inseridas com textContent, com o motivo comentado em transactions.ts:560.",
    ),
    (
        "Cor da classe validada por regex antes de virar atributo style",
        "src/modules/allocation/allocation.schema.ts:6 e 15",
        "bucket.color é interpolado em style= em allocation.tsx:144 e :278. O schema exige "
        "/^#[0-9a-fA-F]{6}$/, então nada além de um hex chega lá — a injeção de CSS está barrada na "
        "fronteira, não só no escape.",
    ),
    (
        "Download de nota sem path traversal nem injeção de cabeçalho",
        "src/modules/broker-note/broker-note.service.ts:207-218, transaction.routes.ts:59-65",
        "O nome do arquivo é gerado pelo servidor a partir da data e do id (`${data}_${id}.${ext}`), "
        "nunca vindo da URL nem do nome que o usuário enviou; a extensão sai de uma tabela fechada "
        "(EXTENSIONS, linhas 38-44). O Content-Disposition recebe esse nome gerado, então não há "
        "aspas nem CRLF de usuário no cabeçalho.",
    ),
    (
        "Ticker codificado antes de entrar em URL externa",
        "src/integrations/yahoo/yahoo.client.ts:14 e 159",
        "O host é constante e o ticker informado pelo usuário passa por encodeURIComponent, então não "
        "há como escapar do caminho para outro destino. Os clientes BCB e Tesouro usam URLs fixas.",
    ),
    (
        "Gate de interface com verificação equivalente no servidor",
        "src/modules/transaction/transaction.routes.ts:107 ↔ src/integrations/anthropic/anthropic.client.ts:110",
        "A aba de importação por nota some da tela quando a chave da Anthropic não está configurada. "
        "Testado por requisição direta a POST /transactions/parse-note ignorando a interface: o "
        "servidor responde 400 \"APP_ANTHROPIC_API_KEY não configurada.\" O gate não vive só no "
        "navegador.",
    ),
    (
        "Nenhum segredo no código, nos configs, no CI ou no histórico",
        ".gitignore:22, .env.example:24-29, .github/workflows/ci.yml, deploy/big-cat.service",
        ".env está no .gitignore e nunca foi versionado (git log --all sobre o caminho não retorna "
        "commit). O .env.example traz apenas campos vazios. O CI não define segredo algum e a unit "
        "systemd não embute credencial. Busca em todos os commits por sk-ant-, AKIA e blocos PRIVATE "
        "KEY: nada. As únicas strings parecidas com credencial são fixtures de teste "
        "('sk-teste' em anthropic.client.test.ts:44, 'segredo' em auth.service.test.ts:14).",
    ),
    (
        "Upload limitado na entrada",
        "src/app.ts:46",
        "@fastify/multipart registrado com fileSize de 20 MB e files: 1 — o endpoint de nota não vira "
        "porta de entrada para arquivo grande nem para envio múltiplo.",
    ),
    (
        "Cookie httpOnly e SameSite=Lax",
        "src/plugins/auth.ts:41-47",
        "httpOnly bloqueia leitura por script (contendo o impacto de um XSS) e SameSite=Lax é o que "
        "hoje impede que os POSTs de escrita sejam disparados autenticados a partir de outro site — "
        "é o substituto de fato do token anti-CSRF nesta aplicação.",
    ),
    (
        "Sandbox do systemd bem apertado",
        "deploy/big-cat.service:31-66",
        "NoNewPrivileges, ProtectSystem=strict com dois ReadWritePaths, CapabilityBoundingSet vazio, "
        "ProtectHome=tmpfs, RestrictNamespaces, SystemCallFilter=@system-service e UMask=0077. "
        "Se a aplicação for comprometida, o raio de alcance no host é pequeno.",
    ),
]

# --------------------------------------------------------------------------------------
# Recomendações priorizadas
# --------------------------------------------------------------------------------------

RECOMMENDATIONS = [
    (
        "P1",
        "Exigir senha em produção e falhar o boot sem ela",
        "F1",
        "É a única falha que expõe a base inteira sem nenhuma condição prévia, e é também o "
        "multiplicador do F2. Um superRefine no EnvSchema resolve em poucas linhas.",
    ),
    (
        "P1",
        "Escapar (ou mandar como text/plain) a mensagem no handler de erro",
        "F2",
        "Corrige o único caminho de XSS confirmado, num arquivo só, sem tocar em nenhuma view.",
    ),
    (
        "P2",
        "Validar returnTo como caminho interno nos sete redirects",
        "F3",
        "Um helper em shared/ e um teste que fixe https://, //host e /\\host.",
    ),
    (
        "P2",
        "Limitar tentativas de login e encurtar a sessão",
        "F4",
        "@fastify/rate-limit só na rota de login, mais um valor de APP_AUTH_SESSION_DAYS menor que 365.",
    ),
    (
        "P3",
        "Secure no cookie, helmet com CSP e SRI nas CDNs",
        "F5",
        "Defesa em profundidade: reduz o impacto de qualquer XSS futuro e tira o token de sessão do "
        "tráfego em claro.",
    ),
    (
        "P3",
        "Propagar o parseForm() para todas as rotas",
        "F6",
        "Higiene: erro de validação vira 400 com mensagem curta, e o log de erro volta a significar "
        "erro de verdade.",
    ),
]
