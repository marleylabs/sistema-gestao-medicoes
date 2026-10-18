# Runbook — P0 como único ID do fornecedor na pré-produção

Migração de dados e deploy da P2 "P0 como único ID do fornecedor" ([spec](brain/specs/p2-vinculo-login-profissional.md),
[decisão 012](brain/decisoes/012-p0-como-id-do-fornecedor.md), [plano](brain/specs/p2-vinculo-login-profissional-plano.md), T6).

> Nada deste documento foi executado no servidor. Executar só com autorização, na janela combinada.

**O que muda:**
- Para cada fornecedor com login, o código passa a ser o P0 do login: `Profissional.codigo`, código do cadastro, BMs, divergências, mapa, BM auxiliar e logs.
- O código antigo (o nome) vira alias, e a planilha continua importando pelo nome.
- **Sem migration de schema:** a pré-produção já tem as 8 migrations desta release.

**Ensaio feito em 2026-10-17** numa cópia local do backup da pré-produção (2026-10-18T01:00Z):
- 55/55 migráveis, 0 conflitos;
- aplicar e medir 55/55;
- valores e status dos BMs idênticos ao original;
- a reversão volta exatamente ao original (hash linha a linha).

## 0. Pré-requisitos (antes da janela)

- [ ] Branch `release/2026-10-02-import-identities` enviada ao GitHub (push autorizado) e SHA aprovado (`APPROVED_SHA`).
- [ ] Ninguém importa planilha nem edita fornecedor durante a janela (avisar a equipe). O passo 4 para o ETL e o web, então a janela tem alguns minutos fora do ar.
- [ ] Login de um ADMIN ativo para a auditoria: `P0000001`.

Ambiente: `projetachatwoot`, diretório `/opt/sistema-gestao-medicoes`, projeto compose `projetocrud-medio`, web na porta 3020.

## 1. Variáveis, GO/ABORT e imagens de rollback

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes
C="docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml"
APPROVED_SHA="<SHA_APROVADO>"
ADMIN_AUDITORIA="P0000001"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
B="$HOME/backups-medicoes/p0_$TS"; mkdir -p "$B"; chmod 700 "$B"

test -z "$(git status --porcelain)"            # ABORTAR se houver alteração local
git fetch --prune origin
git cat-file -e "${APPROVED_SHA}^{commit}"      # ABORTAR se o SHA não existir
PREVIOUS_SHA="$(git rev-parse HEAD)"
docker image tag "$(docker inspect --format '{{.Image}}' medicoes-web)" "local/medicoes-web-rollback:$TS"
docker image tag "$(docker inspect --format '{{.Image}}' medicoes-etl)" "local/medicoes-etl-rollback:$TS"
printf 'TS=%s\nAPPROVED_SHA=%s\nPREVIOUS_SHA=%s\nWEB_TARGET_IMAGE=%s\nETL_TARGET_IMAGE=%s\n' \
  "$TS" "$APPROVED_SHA" "$PREVIOUS_SHA" \
  "$(docker inspect --format '{{.Config.Image}}' medicoes-web)" "$(docker inspect --format '{{.Config.Image}}' medicoes-etl)" \
  | tee "$B/deploy.env"
```

## 2. Backup (obrigatório)

```bash
docker exec medicoes-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$B/medicoes_pre_p0_$TS.dump"
test -s "$B/medicoes_pre_p0_$TS.dump"
sha256sum "$B/medicoes_pre_p0_$TS.dump" | tee "$B/medicoes_pre_p0_$TS.dump.sha256"
docker exec -i medicoes-postgres pg_restore --list < "$B/medicoes_pre_p0_$TS.dump" | grep -c "TABLE DATA"
```

ABORTAR se o dump estiver vazio ou a listagem falhar.

## 3. Código novo e imagens (com o sistema ainda no ar)

```bash
git switch --detach "$APPROVED_SHA"
test "$(git rev-parse HEAD)" = "$APPROVED_SHA"
$C build web etl
$C --profile migrate build migrate
```

O serviço `migrate` usa o estágio de build (código-fonte + `tsx`) e monta a `DATABASE_URL` a partir do `.env`; nenhuma senha é digitada. Validado localmente em 2026-10-17: o dry-run pela imagem `migrate` contra a cópia da pré-produção deu os mesmos 55 `MIGRAVEL`.

## 4. Janela: parar importação e uso, dry-run

```bash
$C stop etl web
$C --profile migrate run --rm --no-deps migrate npx tsx scripts/migrar-codigo-p0.ts | tee "$B/1-dry-run.json"
```

GO somente se:
- `conflitosPorMotivo` estiver vazio e `loginsParaRevisar` vazio;
- `porClasse` só tiver `MIGRAVEL` (ou `JA_E_P0`), com total igual ao número de fornecedores (55 no ensaio; pode ter mudado se houve cadastro novo).

Com conflito: **ABORTAR**. Volte ao código e às imagens antigas (passo 8, item A, sem o `--reverter`) e resolva os casos com o Administrativo.

## 5. Aplicar e medir

```bash
$C --profile migrate run --rm --no-deps -e MIGRACAO_P0_ADMIN="$ADMIN_AUDITORIA" migrate npx tsx scripts/migrar-codigo-p0.ts --aplicar | tee "$B/2-aplicar.json"
$C --profile migrate run --rm --no-deps migrate npx tsx scripts/migrar-codigo-p0.ts --medir | tee "$B/3-medir.json"
```

GO somente se:
- `2-aplicar.json` tiver `falhas: []` e a lista `migrados` com o mesmo total do dry-run;
- `3-medir.json` tiver `ok` igual a `migrados` e `comProblema: []`.

Senão: rollback (passo 8, item A).

## 6. Deploy (logo em seguida, sem fallback por nome)

```bash
$C up -d --no-deps --force-recreate etl
for i in $(seq 1 30); do test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-etl)" = healthy && break; test "$i" -eq 30 && exit 1; sleep 2; done
$C up -d --no-deps --force-recreate web
for i in $(seq 1 45); do test "$(docker inspect --format '{{.State.Health.Status}}' medicoes-web)" = healthy && break; test "$i" -eq 45 && exit 1; sleep 2; done
curl --fail --silent --show-error http://127.0.0.1:3020/api/health
$C logs --since 10m web etl | tee "$B/4-web-etl.log"
```

## 7. Smoke (operador autorizado; sem importar planilha sintética)

1. Login ADMIN; a lista do Administrativo mostra o acesso de cada fornecedor (coluna de acesso preenchida).
2. Login de um fornecedor real autorizado: o portal mostra o próprio BM, NF e comprovante; Minhas Medições lista só os dele.
3. Abrir um BM existente no Financeiro e conferir a composição (sem pagar nada).
4. Rodar a medição de novo; deve continuar 55/55 ok:
   ```bash
   $C --profile migrate run --rm --no-deps migrate npx tsx scripts/migrar-codigo-p0.ts --medir | tee "$B/5-medir-pos-deploy.json"
   ```
5. Logs sem `P2002`, `5xx`, traceback ou reinício.

GO final se todos os itens passarem. A próxima importação de planilha já roda com o P0 (o nome resolve pelo alias).

## 8. Rollback

**A. Antes da primeira importação depois da migração** (caminho normal):

```bash
set -euo pipefail
cd /opt/sistema-gestao-medicoes
C="docker compose --env-file .env -p projetocrud-medio -f docker-compose.yml"
. "$HOME/backups-medicoes/p0_<TS>/deploy.env"
$C stop etl web
# Só se o passo 5 chegou a aplicar: desfaz pela auditoria, com a imagem migrate ainda do código novo.
$C --profile migrate run --rm --no-deps -e MIGRACAO_P0_ADMIN=P0000001 migrate npx tsx scripts/migrar-codigo-p0.ts --reverter
$C --profile migrate run --rm --no-deps migrate npx tsx scripts/migrar-codigo-p0.ts --medir   # "migrados": 0
git switch --detach "$PREVIOUS_SHA"
docker image tag "local/medicoes-etl-rollback:$TS" "$ETL_TARGET_IMAGE"
docker image tag "local/medicoes-web-rollback:$TS" "$WEB_TARGET_IMAGE"
$C up -d --no-deps --force-recreate etl
$C up -d --no-deps --force-recreate web
curl --fail --silent --show-error http://127.0.0.1:3020/api/health
```

O `--reverter` devolve códigos, aliases, cadastros, BMs, divergências, mapa, BM auxiliar e logs exatamente ao estado anterior (provado no ensaio). Só ficam as linhas de auditoria.

**B. Depois de uma importação nova:** o `--reverter` também volta para o código antigo as linhas gravadas com P0 pela importação. O app antigo espera isso, mas confira antes. Em último caso, restaure `medicoes_pre_p0_<TS>.dump` num **banco novo**, com janela de manutenção e decisão humana explícita. Isso descarta o que foi gravado depois da migração. Nunca use `docker compose down -v`, `docker volume rm` nem `prune`.

## 9. Depois

- Guardar `$B` (dump, JSONs e logs) até o aceite.
- Atualizar o cérebro: plano (T6), status e pendências. A P2 só sai das pendências depois da produção.
- **Produção:** mesmo roteiro, ajustando diretório, projeto compose e porta, com novo ensaio local a partir de um backup da produção.
