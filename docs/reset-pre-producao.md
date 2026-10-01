# Reset controlado do ambiente pré-produção (banco limpo + aplicação nova)

O ambiente em `projetachatwoot:/opt/sistema-gestao-medicoes` ainda não opera de verdade: os dados
atuais são fictícios e **não são migrados**. O banco novo nasce vazio, criado **somente** pelo
histórico Prisma, num **volume novo** — o volume antigo fica intacto para rollback.

> Nada deste documento foi executado no servidor. Executar somente com autorização, na janela.

| | Volume | Código | Imagens | Senha do Postgres |
|---|---|---|---|---|
| **NOVO** | `projetocrud-medio_postgres_data_v2` (via `POSTGRES_VOLUME_NAME`) | release candidate | build novo `:latest` | `POSTGRES_PASSWORD` nova, só no `.env` |
| **ROLLBACK** | `projetocrud-medio_postgres_data` (atual, intocado) | `952f15e` + stash do compose | `:pre-reset-952f15e` | a antiga, fixa no compose de `952f15e` |

Nenhum passo remove volume: **proibido** `docker compose down -v`, `docker volume rm` e
`docker system prune --volumes`. Volumes antigos e dumps só saem depois do aceite formal.

## Gates (todos validados localmente antes da janela)

- [x] Migration base `20260902000000_baseline_legado` + 6 incrementais constroem um banco vazio
      (`migrate deploy`: 7/7; sem P3005/P3006/duplicidade/FK), reconstruções independentes repetidas.
- [x] `migrate status` = up to date; `migrate diff` contra `schema.prisma` = vazio.
- [x] Checksums gravados em `_prisma_migrations` = SHA-256 dos arquivos LF do Git (`.gitattributes` fixa LF).
- [x] Schema físico idêntico ao da produção migrada (inclui CHECKs, view `vw_dashboard_medicoes`, `pgcrypto`).
- [x] Banco-sombra (`migrate diff --from-migrations`) reconstrói o histórico (antes: P3006) → `migrate dev` futuro funciona.
- [x] Suíte completa no SHA do release, num banco criado só pelas migrations: tsc, build, targeted 369/369,
      migration base 5/5, Python 8/8, Playwright completo.
- [x] Stack real pelo compose novo (web + ETL + Postgres em volume novo + serviço `migrate`): health 200,
      bootstrap do ADMIN no primeiro login, seis áreas com estados vazios, máscara limpa, sem erros.
- [ ] Release candidate publicado (push autorizado) e `RC_SHA` aprovado.
- [ ] Backup do banco atual **na janela** (o de 2026-09-30 só prova o procedimento).

## Situação auditada (2026-10-01, somente leitura)

- App: `952f15e` (branch `layout2.0`), compose project `projetocrud-medio`, containers
  `medicoes-web` / `medicoes-etl` / `medicoes-postgres`; imagens `projetocrud-medio-web:latest`
  (`83fc40507857`), `projetocrud-medio-etl:latest` (`8d5ea2bb859a`), `postgres:16-alpine`.
- Banco montado: volume `projetocrud-medio_postgres_data` (labels do compose: volume `postgres_data`).
  `projetocrud-medio_postgres_data_v2` **não existe**. `medicoes-prod_postgres_data` (antigo, sem container) não é tocado.
- `docker-compose.yml` local difere do Git só no padrão `${WEB_PORT:-3000}` → `${WEB_PORT:-3020}`;
  o `.env` já define `WEB_PORT=3020`, então o compose versionado mantém a porta 3020.
- `.env`: `EMAIL_ENABLED=true` e `EMAIL_TEST_MODE=false` (e-mail REAL) — desligar durante a janela.
  `AUTH_CREATE_DEFAULT_MEDICAO_USERS=false` (deve continuar false). `POSTGRES_PASSWORD` ainda não existe.
- Postgres publicado em `0.0.0.0:15432` (e `[::]`) com a senha fixa antiga; web em `0.0.0.0:3020`;
  o acesso público chega pelo `cloudflared` (túnel gerenciado por token — rotas só visíveis no painel Cloudflare).
- Backup de prova: `/home/anderson/backups-medicoes/pre_reset_20260930_202506/` (dump 179.502 bytes,
  SHA-256 `6fa1aa369d2beada5111906fe7dc41e92bd824f09f2876e084199adecd2df4bb`, `pg_restore --list` ok,
  19 tabelas de dados) + cópias de `.env`, compose e do diff local (chmod 600).

## O que muda no `docker-compose.yml` (versionado; padrões preservam o comportamento atual)

- `database/schema.sql` não é mais montado em `initdb` (num volume novo ele criaria as tabelas antes do
  Prisma e o `migrate deploy` falharia com P3005).
- `POSTGRES_PASSWORD` (padrão `medicoes_app_dev`) usada pelo Postgres, pelo web e pelo ETL. Ela só vale na
  **criação** do volume: o volume antigo continua com a senha antiga.
- `POSTGRES_VOLUME_NAME` (padrão `projetocrud-medio_postgres_data`) → banco novo em outro volume.
  **Atenção:** sem essa variável o compose novo montaria o volume ANTIGO — por isso o passo 5 a verifica.
- `POSTGRES_BIND_ADDRESS` (padrão `0.0.0.0`) → `127.0.0.1` quando confirmado que nada externo usa o banco.
- Serviço `migrate` (perfil `migrate`): `npx prisma migrate deploy` a partir do estágio `builder`.
- O compose não usa `env_file`: `DATABASE_URL`/`ETL_DATABASE_URL` dos containers são montadas a partir de
  `POSTGRES_PASSWORD`; as do `.env` só servem a scripts no host.

## Janela de reset (comandos exatos)

Rodar bloco a bloco num shell `bash` (o `set -e` interrompe ao primeiro erro — por isso as negações usam `if …; then exit 1`, já que `! cmd` não dispara o `set -e`; se algo falhar, **parar** e
avaliar o rollback). `C="docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml"`.

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes
RC_SHA="<SHA completo aprovado>"
C="docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml"
TS="$(date -u +%Y%m%d_%H%M%S)"; B="$HOME/backups-medicoes/reset_$TS"; mkdir -p "$B"; chmod 700 "$B"
date -u +"inicio_janela=%FT%TZ" | tee "$B/janela.txt"

# 0. Pré-checagens (abortam se o estado não for o auditado)
test "$(git rev-parse HEAD)" = "952f15e925407997258a46342348b68699d4a60e"
if docker volume inspect projetocrud-medio_postgres_data_v2 >/dev/null 2>&1; then echo 'ABORTAR: v2 ja existe'; exit 1; fi
docker inspect medicoes-postgres --format '{{range .Mounts}}{{.Name}} {{end}}' | grep -qw projetocrud-medio_postgres_data
docker image inspect projetocrud-medio-web:latest projetocrud-medio-etl:latest >/dev/null

# 1. Backup NOVO (banco ainda no ar). Qualquer falha aqui = ABORTAR o reset.
docker exec medicoes-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$B/medicoes_pre_reset_$TS.dump"
echo "pg_dump_exit=$?" | tee -a "$B/janela.txt"
test -s "$B/medicoes_pre_reset_$TS.dump"
stat -c 'tamanho=%s' "$B/medicoes_pre_reset_$TS.dump" | tee -a "$B/janela.txt"
sha256sum "$B/medicoes_pre_reset_$TS.dump" | tee "$B/medicoes_pre_reset_$TS.dump.sha256"
docker exec -i medicoes-postgres pg_restore --list < "$B/medicoes_pre_reset_$TS.dump" > "$B/toc.txt"
echo "pg_restore_list_exit=$? table_data=$(grep -c 'TABLE DATA' "$B/toc.txt")" | tee -a "$B/janela.txt"
docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select count(*) from usuarios" | sed 's/^/usuarios_antigo=/' | tee -a "$B/janela.txt"
cp .env "$B/env.backup"; cp docker-compose.yml "$B/docker-compose.yml.backup"; git diff > "$B/docker-compose.local.diff"
git rev-parse HEAD > "$B/app_sha.txt"
grep -E '^(EMAIL_ENABLED|EMAIL_TEST_MODE|EMAIL_CTA_ENABLED|WEB_PORT|POSTGRES_PORT|AUTH_BOOTSTRAP_USERNAME|AUTH_CREATE_DEFAULT_MEDICAO_USERS)=' .env > "$B/env-nao-secreto.txt"
chmod 600 "$B"/*

# 2. Imagens antigas preservadas para rollback sem rebuild
docker tag projetocrud-medio-web:latest projetocrud-medio-web:pre-reset-952f15e
docker tag projetocrud-medio-etl:latest projetocrud-medio-etl:pre-reset-952f15e

# 3. Parar a aplicação (stop: containers e volumes continuam existindo)
$C stop web etl postgres

# 4. Código novo. A alteração local do compose (WEB_PORT padrão 3020) fica guardada no stash, não descartada.
git stash push -m "pre-reset: WEB_PORT default local" -- docker-compose.yml
git stash list | head -1 | tee -a "$B/janela.txt"
git fetch origin && git merge --ff-only origin/layout2.0
test "$(git rev-parse HEAD)" = "$RC_SHA"
```

**5. `.env` (editar à mão, sem imprimir segredos):**

- `EMAIL_ENABLED=false` (valor anterior `true` guardado em `env-nao-secreto.txt` e `env.backup`);
- `POSTGRES_PASSWORD=<nova senha forte, gerada na hora, ex. openssl rand -base64 32 | tr -d '/+='>` — nunca versionada;
- `POSTGRES_VOLUME_NAME=projetocrud-medio_postgres_data_v2`;
- `AUTH_BOOTSTRAP_PASSWORD=<senha temporária forte para o primeiro ADMIN>` (será esvaziada no passo 9);
- manter `WEB_PORT=3020`, `AUTH_BOOTSTRAP_USERNAME=P0000001`, `AUTH_CREATE_DEFAULT_MEDICAO_USERS=false`;
- opcional: atualizar `DATABASE_URL`/`ETL_DATABASE_URL` do `.env` com a senha nova (só scripts de host usam).

```bash
# 5b. Verificação do .env e do compose resolvido (não imprime segredos)
grep -qx 'EMAIL_ENABLED=false' .env
grep -qx 'POSTGRES_VOLUME_NAME=projetocrud-medio_postgres_data_v2' .env
grep -qx 'WEB_PORT=3020' .env
grep -qx 'AUTH_CREATE_DEFAULT_MEDICAO_USERS=false' .env
P="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"; test "${#P}" -ge 24 && test "$P" != medicoes_app_dev; unset P
A="$(grep -E '^AUTH_BOOTSTRAP_PASSWORD=' .env | cut -d= -f2-)"; test "${#A}" -ge 12; unset A
$C config | grep -q 'name: projetocrud-medio_postgres_data_v2'      # compose vai montar o volume NOVO
$C config | grep -q 'published: "3020"'                              # web segue em 3020 via .env

# 6. Build + Postgres novo e vazio (volume v2 criado agora; o antigo não é tocado)
$C build web etl migrate
$C up -d postgres
docker inspect medicoes-postgres --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' | tee -a "$B/janela.txt"
docker inspect medicoes-postgres --format '{{range .Mounts}}{{.Name}} {{end}}' | grep -qw projetocrud-medio_postgres_data_v2
test "$(docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select count(*) from information_schema.tables where table_schema='public'")" = 0

# 7. Migrations do zero (sem baseline manual, sem resolve) + validação
$C --profile migrate run --rm migrate                                    # esperado: 7 migrations aplicadas
$C --profile migrate run --rm migrate npx prisma migrate status          # esperado: up to date
$C --profile migrate run --rm migrate \
  npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
test "$(docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = 7
test "$(docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select count(*) from usuarios")" = 0

# 8. Aplicação nova (e-mail desligado no processo, não só no arquivo)
$C up -d etl web
docker exec medicoes-web sh -c 'test "$EMAIL_ENABLED" = false && echo email_desligado'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/api/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/login        # 200
```

**9. Bootstrap do ADMIN** (`ensureBootstrapAdmin`, `lib/auth.ts`, chamado em todo `POST /api/auth/login`):

- Com `usuarios` vazia, o **primeiro** POST de login (qualquer corpo, inclusive credenciais erradas) cria
  exatamente 1 usuário: `usuario = AUTH_BOOTSTRAP_USERNAME`, `nome = AUTH_BOOTSTRAP_NAME` (padrão
  "Administrador"), `perfil = ADMIN`, senha = hash scrypt de `AUTH_BOOTSTRAP_PASSWORD`, `primeiroLogin = false`.
  Usuários-padrão de medição só seriam criados com `AUTH_CREATE_DEFAULT_MEDICAO_USERS=true` (fica false).
- Sem senha (ou com menos de 6 caracteres) e `usuarios` vazia, o login responde erro 500 e nada é criado.
- Com `usuarios` > 0 a função retorna antes de ler `AUTH_BOOTSTRAP_PASSWORD` → esvaziá-la depois é seguro.
- Como a senha vem só do `.env`, um POST alheio antes do nosso cria o mesmo ADMIN mas não dá acesso.
  Mesmo assim, fazer o login de bootstrap logo após o passo 8.

```bash
# login pela UI (https://smfprojeta.boingaestrutural.com/ ou http://127.0.0.1:3020) com P0000001 + senha do .env, depois:
docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select usuario, perfil, ativo from usuarios"   # 1 linha: P0000001|ADMIN|t
# trocar a senha pelo fluxo normal (Alterar senha, /api/auth/alterar-senha); depois esvaziar no .env:
#   AUTH_BOOTSTRAP_PASSWORD=
# e RECRIAR o web (restart não relê o .env; o processo antigo manteria o valor):
$C up -d --no-deps --force-recreate web
docker exec medicoes-web sh -c 'test -z "$AUTH_BOOTSTRAP_PASSWORD" && echo bootstrap_password_vazia'
```

10. Smoke: seis áreas com estados vazios; contagens 0 (medições, mapa, BM AUX, SGC, aliases, ciclos);
    máscara limpa; nenhum e-mail enviado (`select count(*) from email_logs` = 0). Fixture de portal, se usada, removida ao fim.
11. Reativar e-mail somente **depois do aceite** (`EMAIL_ENABLED=true`, `EMAIL_TEST_MODE` conforme decisão),
    com `$C up -d --no-deps --force-recreate web`.

## Rollback (enquanto o novo ambiente não for aceito)

Volta código, imagens, `.env`, compose local **e o volume antigo**. O volume v2 também é preservado
(para análise); nada é apagado.

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes
B="$HOME/backups-medicoes/reset_<TS da janela>"
C="docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml"

# a. Parar o ambiente novo (stop, sem -v)
$C stop web etl postgres

# b. Configuração anterior: o .env antigo NÃO tem POSTGRES_VOLUME_NAME/POSTGRES_PASSWORD
cp "$B/env.backup" .env
if grep -q '^POSTGRES_VOLUME_NAME=' .env; then echo 'ABORTAR: .env nao e o antigo'; exit 1; fi

# c. Código antigo + alteração local do compose de volta
git checkout --detach 952f15e925407997258a46342348b68699d4a60e
git stash list | grep -q 'pre-reset: WEB_PORT default local' && git stash pop
git diff --stat                        # esperado: só docker-compose.yml (WEB_PORT padrão 3020)

# d. O compose de 952f15e declara "volumes: postgres_data:" sem name: → projeto + volume =
#    projetocrud-medio_postgres_data, o volume ANTIGO. Conferir antes de subir:
$C config | grep -A2 '^volumes:'       # esperado: name: projetocrud-medio_postgres_data
$C config | grep -q 'name: projetocrud-medio_postgres_data$'

# e. Imagens antigas
docker tag projetocrud-medio-web:pre-reset-952f15e projetocrud-medio-web:latest
docker tag projetocrud-medio-etl:pre-reset-952f15e projetocrud-medio-etl:latest

# f. Subir sem build. --force-recreate garante que o container do Postgres seja recriado
#    montando o volume antigo (e não o v2 que o container novo montava).
$C up -d --no-build --force-recreate postgres etl web
docker inspect medicoes-postgres --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
docker inspect medicoes-postgres --format '{{range .Mounts}}{{.Name}} {{end}}' | grep -qw projetocrud-medio_postgres_data
docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select count(*) from usuarios"   # = usuarios_antigo de janela.txt
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/api/health   # 200
```

A senha antiga funciona porque o compose de `952f15e` a fixa e ela é a gravada no volume antigo.
Se o volume antigo estiver danificado (não esperado: só recebeu `stop`), restaurar o dump da janela num
volume novo e vazio com `pg_restore`, nunca sobre o v2.

## Bancos já existentes (fora do servidor)

DEV e E2E foram criados antes da migration base: registrá-la sem executar, quando autorizado —
`npx prisma migrate resolve --applied 20260902000000_baseline_legado` (com `DATABASE_URL` do banco).
