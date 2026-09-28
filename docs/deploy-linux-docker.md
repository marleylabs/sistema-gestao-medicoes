# Runbook de deploy controlado — produção

Ambiente auditado:

- diretório: `/opt/sistema-gestao-medicoes`;
- Compose: `docker-compose.yml`;
- container preservado: `medicoes-postgres`;
- containers atualizados: `medicoes-etl` e `medicoes-web`.

Este pacote não possui migration Prisma. Não execute comandos de migration, baseline ou alteração manual de schema durante este deploy.

## 1. Variáveis da janela

Abra uma única sessão SSH e substitua o placeholder pelo SHA aprovado:

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes

APPROVED_SHA="<SHA_FINAL_APROVADO>"
DEPLOY_TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/opt/sistema-gestao-medicoes-backups/${DEPLOY_TS}"
mkdir -p "$BACKUP_DIR"
```

## 2. GO/ABORT antes de alterar o ambiente

```bash
test "$(pwd)" = "/opt/sistema-gestao-medicoes"
test -f docker-compose.yml
test -f .env
test -z "$(git status --porcelain)"

git fetch --prune origin
git cat-file -e "${APPROVED_SHA}^{commit}"

PREVIOUS_SHA="$(git rev-parse HEAD)"
printf 'DEPLOY_TS=%s\nAPPROVED_SHA=%s\nPREVIOUS_SHA=%s\n' \
  "$DEPLOY_TS" "$APPROVED_SHA" "$PREVIOUS_SHA" \
  | tee "$BACKUP_DIR/deploy.env"

docker compose -f docker-compose.yml ps | tee "$BACKUP_DIR/compose-before.txt"
sha256sum .env | tee "$BACKUP_DIR/env.sha256"
```

ABORTAR se o diretório estiver incorreto, o Git estiver sujo, o SHA não existir, o PostgreSQL não estiver saudável ou `.env` estiver ausente.

## 3. Registrar imagens atuais para rollback

```bash
WEB_IMAGE_ID="$(docker inspect --format '{{.Image}}' medicoes-web)"
ETL_IMAGE_ID="$(docker inspect --format '{{.Image}}' medicoes-etl)"
WEB_TARGET_IMAGE="$(docker inspect --format '{{.Config.Image}}' medicoes-web)"
ETL_TARGET_IMAGE="$(docker inspect --format '{{.Config.Image}}' medicoes-etl)"

docker image inspect "$WEB_IMAGE_ID" > "$BACKUP_DIR/web-image-before.json"
docker image inspect "$ETL_IMAGE_ID" > "$BACKUP_DIR/etl-image-before.json"
docker image tag "$WEB_IMAGE_ID" "local/medicoes-web-rollback:${DEPLOY_TS}"
docker image tag "$ETL_IMAGE_ID" "local/medicoes-etl-rollback:${DEPLOY_TS}"

printf 'WEB_IMAGE_ID=%s\nETL_IMAGE_ID=%s\nWEB_TARGET_IMAGE=%s\nETL_TARGET_IMAGE=%s\n' \
  "$WEB_IMAGE_ID" "$ETL_IMAGE_ID" "$WEB_TARGET_IMAGE" "$ETL_TARGET_IMAGE" \
  | tee -a "$BACKUP_DIR/deploy.env"
```

## 4. Backup PostgreSQL

O comando usa o PostgreSQL já em execução e não recria seu container:

```bash
docker compose -f docker-compose.yml exec -T postgres \
  pg_dump -U medicoes_app -d medicoes -Fc \
  > "$BACKUP_DIR/postgres.dump"

test -s "$BACKUP_DIR/postgres.dump"
docker compose -f docker-compose.yml exec -T postgres \
  pg_restore --list < "$BACKUP_DIR/postgres.dump" \
  > "$BACKUP_DIR/postgres.restore-list.txt"
test -s "$BACKUP_DIR/postgres.restore-list.txt"
```

ABORTAR se o dump ou sua listagem falhar.

## 5. Atualizar código e rebuildar somente web/etl

```bash
git switch --detach "$APPROVED_SHA"
test "$(git rev-parse HEAD)" = "$APPROVED_SHA"

docker compose -f docker-compose.yml build web etl
```

Não use `docker compose up` sem limitar os serviços. O PostgreSQL deve permanecer intacto.

## 6. Recriar somente ETL e web

```bash
docker compose -f docker-compose.yml up -d --no-deps --force-recreate etl

for attempt in $(seq 1 30); do
  test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-etl)" = "healthy" && break
  test "$attempt" -eq 30 && exit 1
  sleep 2
done

docker compose -f docker-compose.yml up -d --no-deps --force-recreate web

for attempt in $(seq 1 45); do
  test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-web)" = "healthy" && break
  test "$attempt" -eq 45 && exit 1
  sleep 2
done
```

## 7. Health e smoke técnico

```bash
test "$(docker inspect --format '{{.State.Running}}' medicoes-postgres)" = "true"
test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-postgres)" = "healthy"
test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-etl)" = "healthy"
test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-web)" = "healthy"

curl --fail --silent --show-error http://127.0.0.1:3000/api/health
docker compose -f docker-compose.yml exec -T etl python -c \
  "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:4000/health', timeout=5).status == 200"

docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --since 10m web etl \
  | tee "$BACKUP_DIR/web-etl-after.log"
```

Smoke funcional, executado por operador autorizado:

1. Login ADMIN e carregamento da Visão Geral.
2. Confirmar status visual do BM em um registro já existente.
3. Em um BM real previamente autorizado e pendente, validar o botão **Enviar BM**; não criar massa sintética.
4. Abrir uma divergência já existente e confirmar a apresentação correta para Equipe e fornecedor.
5. Validar uma NF real/controlada com os CNPJs corretos; nomes/valor divergentes não devem bloquear.
6. Conferir os registros reais de BM AUX de Cristiano e Mauricio sem importar nova planilha.
7. Revisar logs por `P2002`, erro de validação, traceback, `5xx` ou reinício inesperado.

Não faça upload sintético em produção: a importação pode acionar `full_refresh`.

## 8. Critério GO/ABORT

GO somente se:

- backup e `pg_restore --list` forem válidos;
- tags de rollback existirem;
- `medicoes-postgres` permanecer com o mesmo container e saudável;
- web e ETL estiverem `healthy`;
- `/api/health` responder HTTP 200;
- smoke ADMIN/BM/divergência/NF/BM AUX passar;
- logs não apresentarem erro novo.

ABORTAR e executar rollback se qualquer item falhar.

## 9. Rollback por imagens e commit anteriores

Use o mesmo `DEPLOY_TS` do deploy:

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes

DEPLOY_TS="<DEPLOY_TS_DO_DEPLOY>"
BACKUP_DIR="/opt/sistema-gestao-medicoes-backups/${DEPLOY_TS}"
. "$BACKUP_DIR/deploy.env"

git switch --detach "$PREVIOUS_SHA"

docker image tag "local/medicoes-etl-rollback:${DEPLOY_TS}" "$ETL_TARGET_IMAGE"
docker image tag "local/medicoes-web-rollback:${DEPLOY_TS}" "$WEB_TARGET_IMAGE"

docker compose -f docker-compose.yml up -d --no-deps --force-recreate etl
for attempt in $(seq 1 30); do
  test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-etl)" = "healthy" && break
  test "$attempt" -eq 30 && exit 1
  sleep 2
done

docker compose -f docker-compose.yml up -d --no-deps --force-recreate web
for attempt in $(seq 1 45); do
  test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-web)" = "healthy" && break
  test "$attempt" -eq 45 && exit 1
  sleep 2
done

curl --fail --silent --show-error http://127.0.0.1:3000/api/health
docker compose -f docker-compose.yml ps
```

O rollback normal não restaura o dump, pois isso descartaria dados legítimos gravados após o deploy. A restauração PostgreSQL exige janela de manutenção e decisão humana explícita; o dump fica disponível apenas para contingência de dados.
