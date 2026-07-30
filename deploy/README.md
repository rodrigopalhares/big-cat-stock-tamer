# Deploy — Big Cat

App pessoal single-user (Fastify + Node) que sobe **automaticamente** quando o volume
criptografado `/storage/media` é montado, e cai quando é desmontado.

## Como funciona o auto-start

- `big-cat.path` é um *path unit* que vigia a sentinela `/storage/media/big-cat/.mounted`.
  Essa sentinela mora **dentro** do btrfs criptografado, então só existe quando o volume
  está montado. Assim que ela aparece, o systemd sobe o `big-cat.service`.
- `big-cat.service` roda um processo só — o scheduler (croner) e o backup sobem
  in-process, então nada de réplicas. `BindsTo=storage-media.mount` faz o app **cair
  sozinho** ao desmontar `/storage/media`.
- Banco, backups, notas de negociação e o `auth.key` ficam **todos** em
  `/storage/media/big-cat/data`, no volume criptografado. O código fica em `/srv`, e o
  serviço só tem leitura ali.

## Isolamento

A unit usa as diretivas de sandbox do systemd — as mesmas primitivas do kernel que o
bubblewrap usa (mount namespaces + seccomp), só que declaradas e auditáveis:

```bash
systemd-analyze security big-cat.service
```

O desenho é: **um único caminho gravável**, `/storage/media/big-cat/data`. Ele cobre as
três escritas que a aplicação faz — `infra/backup.ts:82` (snapshot), `modules/broker-note/
broker-note.service.ts:192` (PDF da nota) e `modules/auth/auth.service.ts:111` (hashes de
sessão). Todo o resto do sistema é read-only, `/home` vira um tmpfs vazio com um furo
read-only só para o runtime do node, e o processo não tem nenhuma capability (a porta
8001 é > 1024).

Duas armadilhas que valem saber antes de mexer:

- **`MemoryDenyWriteExecute` não pode entrar.** O JIT do V8 precisa de páginas W+X; com a
  diretiva ligada o node não sobe.
- **`AF_NETLINK` é obrigatório** em `RestrictAddressFamilies`. O `getaddrinfo` da glibc
  abre um socket netlink para enumerar interfaces — sem ele, DNS falha e as integrações
  (Yahoo, BCB, Tesouro, Anthropic) param.

Se algo quebrar depois de uma mudança na unit, `SystemCallFilter=@system-service` é a
primeira linha a comentar no diagnóstico.

## Configuração

O `.env` fica no próprio diretório do repositório e é lido pelo `src/main.ts` a partir do
CWD — daí o `WorkingDirectory` ser obrigatório. `NODE_ENV=production` vem da unit, não do
arquivo: `process.loadEnvFile` **não** sobrescreve o ambiente, então o `.env` pode ficar em
`development` para o `npm run dev` continuar com log formatado.

O arquivo tem a chave da Anthropic e a senha de acesso — mantenha em `chmod 600`.

### O caminho dos dados aparece duas vezes

`ReadWritePaths=` não expande variável de ambiente — `systemd.exec(5)` deixa claro que a
diretiva toma *"a space-separated list of paths"*, e o motivo é de mecanismo: o namespace é
montado antes de o processo (e portanto o ambiente dele) existir. Só *specifiers* do próprio
systemd (`%h`, `%S`, …) são resolvidos ali, e nenhum enxerga o `.env`.

Então o caminho está duplicado: `APP_DATA_DIR` no `.env` e `ReadWritePaths=` na unit. Para a
divergência não passar batida, a unit tem uma assertiva:

```ini
ExecStartPre=/usr/bin/grep -qxF APP_DATA_DIR=/storage/media/big-cat/data .env
```

Sem ela a falha seria **silenciosa**: o banco derruba o boot (o `PRAGMA journal_mode = WAL`
não cria o `-wal` em FS read-only), mas o backup não — o `guard` do `infra/scheduler.ts:33`
engole exceção de job por design, então um `EROFS` no snapshot viraria uma linha no journal
com a aplicação seguindo de pé, sem backup. Com a assertiva, o serviço recusa subir e o
motivo aparece no `systemctl status`.

Mudou o `APP_DATA_DIR`? Mude os dois, recopie a unit e rode `daemon-reload`.

## Instalação (rodar uma vez, com `/storage/media` montado)

```bash
cd /srv/big-cat-stock-tamer

# 1) Build e migrations (o servico nunca roda npm — so `node dist/main.js`)
mkdir -p /storage/media/big-cat/data
npm ci
npm run build
npm run db:deploy

# 2) Units
sudo cp deploy/big-cat.service /etc/systemd/system/
sudo cp deploy/big-cat.path    /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now big-cat.path

# 3) Sentinela POR ULTIMO: com o .path ja habilitado, ela sobe o app no mesmo segundo
touch /storage/media/big-cat/.mounted
```

A sentinela vem no fim de propósito. Numa instalação virgem a ordem não importa (a unit
ainda não existe para disparar), mas numa reinstalação ou num volume que já tem a sentinela,
criá-la antes das migrations sobe a aplicação com o schema velho. Acesse em
`http://<ip-da-maquina>:8001` (bind `0.0.0.0`).

> O `.service` fica `disabled` de propósito — quem o inicia é o `.path`. Habilitar os dois
> faria o systemd tentar subir o app no boot, antes do volume existir.

## Operação no dia a dia

```bash
# Montar -> o app sobe sozinho em segundos
sudo mount /storage/media

systemctl status big-cat.service      # estado
journalctl -u big-cat.service -f      # logs ao vivo

# Desmontar -> o app cai junto (BindsTo)
sudo umount /storage/media
```

## Atualizar o código

```bash
cd /srv/big-cat-stock-tamer
git pull
npm ci && npm run build     # dist/ e public/js/ nao sao versionados
npm run db:deploy           # se houver migration nova
sudo systemctl restart big-cat.service
```

Mudou `big-cat.service` ou `big-cat.path`? Copie de novo para `/etc/systemd/system/` e
rode `sudo systemctl daemon-reload`.
