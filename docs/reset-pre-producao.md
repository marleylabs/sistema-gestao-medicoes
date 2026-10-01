# Reset controlado do ambiente pré-produção (banco limpo + aplicação nova)

O ambiente em `projetachatwoot:/opt/sistema-gestao-medicoes` ainda não opera de verdade: os dados
atuais são fictícios e **não são migrados**. O banco novo nasce vazio, criado **somente** pelo
histórico Prisma, num **volume novo** — o volume antigo fica intacto para rollback.

> Nada deste documento foi executado no servidor. Executar somente com autorização, na janela.

## Gates (todos validados localmente antes da janela)

- [x] Migration base `20260902000000_baseline_legado` + 6 incrementais constroem um banco vazio
      (`migrate deploy`: 7/7; sem P3005/P3006/duplicidade/FK), duas reconstruções independentes.
- [x] `migrate status` = up to date; `migrate diff` contra `schema.prisma` = vazio.
- [x] Schema físico idêntico ao da produção migrada (inclui CHECKs, view `vw_dashboard_medicoes`, `pgcrypto`).
- [x] Banco-sombra (`migrate diff --from-migrations`) reconstrói o histórico (antes: P3006) → `migrate dev` futuro funciona.
- [x] Suíte completa num banco criado só pelas migrations: targeted 364/364, Python 8/8, Playwright 120/120.
- [x] Stack real pelo compose novo (web + ETL + Postgres em volume novo + serviço `migrate`): health 200,
      bootstrap do ADMIN no primeiro login, seis áreas com estados vazios, máscara limpa, sem erros.
- [ ] Release candidate publicado (push autorizado).
- [ ] Backup do banco atual na janela (o de 2026-09-30 20:25 UTC já existe, ver abaixo).

## Situação auditada (2026-09-30)

- App: `952f15e` (branch `layout2.0`), compose project `projetocrud-medio`, containers
  `medicoes-web` / `medicoes-etl` / `medicoes-postgres`, volume `projetocrud-medio_postgres_data`.
- `docker-compose.yml` local difere do Git só no padrão `${WEB_PORT:-3000}` → `${WEB_PORT:-3020}`;
  o `.env` já define `WEB_PORT=3020`, então o compose versionado mantém a porta 3020.
- `.env`: `EMAIL_ENABLED=true` e `EMAIL_TEST_MODE=false` (e-mail REAL) — desligar durante a janela.
- O compose atual usa a senha fixa `medicoes_app_dev` e publica o Postgres em `0.0.0.0:15432`.
- Backup já feito: `/home/anderson/backups-medicoes/pre_reset_20260930_202506/` (dump 179.502 bytes,
  SHA-256 `6fa1aa369d2beada5111906fe7dc41e92bd824f09f2876e084199adecd2df4bb`, `pg_restore --list` ok,
  19 tabelas de dados) + cópias de `.env`, compose e do diff local (chmod 600).

## O que muda no `docker-compose.yml` (versionado; padrões preservam o comportamento atual)

- `database/schema.sql` não é mais montado em `initdb` (num volume novo ele criaria as tabelas antes do
  Prisma e o `migrate deploy` falharia com P3005).
- `POSTGRES_PASSWORD` (padrão `medicoes_app_dev`) usada pelo Postgres, pelo web e pelo ETL.
- `POSTGRES_VOLUME_NAME` (padrão `projetocrud-medio_postgres_data`) → banco novo em outro volume.
- `POSTGRES_BIND_ADDRESS` (padrão `0.0.0.0`) → `127.0.0.1` quando confirmado que nada externo usa o banco.
- Serviço `migrate` (perfil `migrate`): `npx prisma migrate deploy` a partir do estágio `builder`.

## Janela de reset (comandos exatos)

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes
RC_SHA="<SHA aprovado>"
TS="$(date -u +%Y%m%d_%H%M%S)"; B="$HOME/backups-medicoes/reset_$TS"; mkdir -p "$B"; chmod 700 "$B"
date -u +"inicio_janela=%FT%TZ" | tee "$B/janela.txt"

# 1. Backup final + configuração (banco ainda no ar, só leitura)
docker exec medicoes-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$B/medicoes_pre_reset_$TS.dump"
sha256sum "$B/medicoes_pre_reset_$TS.dump" | tee "$B/medicoes_pre_reset_$TS.dump.sha256"
docker exec -i medicoes-postgres pg_restore --list < "$B/medicoes_pre_reset_$TS.dump" > "$B/toc.txt"
cp .env "$B/env.backup"; cp docker-compose.yml "$B/docker-compose.yml.backup"; git rev-parse HEAD > "$B/app_sha.txt"; chmod 600 "$B"/*

# 2. Imagens antigas preservadas para rollback sem rebuild
docker tag projetocrud-medio-web:latest projetocrud-medio-web:pre-reset-952f15e
docker tag projetocrud-medio-etl:latest projetocrud-medio-etl:pre-reset-952f15e

# 3. Parar a aplicação (sem down -v, sem apagar volume)
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml stop web etl postgres

# 4. Código novo (a alteração local do compose fica guardada; o .env já carrega WEB_PORT=3020)
git stash push -m "pre-reset: WEB_PORT default local" -- docker-compose.yml
git fetch origin && git merge --ff-only origin/layout2.0 && test "$(git rev-parse HEAD)" = "$RC_SHA"

# 5. .env (editar à mão, sem expor valores): EMAIL_ENABLED=false; POSTGRES_PASSWORD=<nova senha forte>;
#    POSTGRES_VOLUME_NAME=projetocrud-medio_postgres_data_v2; conferir AUTH_BOOTSTRAP_USERNAME/PASSWORD.
grep -E '^(EMAIL_ENABLED|POSTGRES_VOLUME_NAME)=' .env

# 6. Build + Postgres novo e vazio (volume v2 criado agora; o antigo não é tocado)
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml build web etl migrate
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml up -d postgres
docker exec medicoes-postgres psql -U medicoes_app -d medicoes -Atc "select count(*) from information_schema.tables where table_schema='public'"   # esperado 0

# 7. Migrations do zero (sem baseline manual, sem resolve) + validação
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml --profile migrate run --rm migrate
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml --profile migrate run --rm migrate npx prisma migrate status
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml --profile migrate run --rm migrate \
  npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code

# 8. Aplicação nova
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml up -d etl web
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/api/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/login        # 200
```

9. Primeiro login com `AUTH_BOOTSTRAP_USERNAME` / `AUTH_BOOTSTRAP_PASSWORD` cria o ADMIN (só quando
   `usuarios` está vazia). Trocar a senha pelo fluxo normal e depois esvaziar `AUTH_BOOTSTRAP_PASSWORD`
   no `.env` (recriar só o web).
10. Smoke: seis áreas com estados vazios; contagens 0 (medições, mapa, BM AUX, SGC, aliases, ciclos);
    máscara limpa. Fixture de portal, se usada, removida ao fim.
11. Reativar e-mail somente depois do smoke (`EMAIL_ENABLED=true`, `EMAIL_TEST_MODE` conforme decisão),
    recriando só o web.

## Rollback (enquanto o novo ambiente não for aceito)

```bash
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml stop web etl postgres
cp "$B/env.backup" .env
git checkout 952f15e925407997258a46342348b68699d4a60e && git stash pop
docker tag projetocrud-medio-web:pre-reset-952f15e projetocrud-medio-web:latest
docker tag projetocrud-medio-etl:pre-reset-952f15e projetocrud-medio-etl:latest
docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml up -d --no-build postgres etl web   # volume antigo
```

O volume `projetocrud-medio_postgres_data` (antigo) e os dumps só são removidos depois do aceite formal.

## Bancos já existentes (fora do servidor)

DEV e E2E foram criados antes da migration base: registrá-la sem executar, quando autorizado —
`npx prisma migrate resolve --applied 20260902000000_baseline_legado` (com `DATABASE_URL` do banco).
