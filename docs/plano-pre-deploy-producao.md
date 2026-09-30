# Plano pré-deploy — feature/figma-redesign → layout2.0 → produção

Documento de preparação. **Nada aqui foi executado em produção.** Cada etapa exige autorização
explícita do responsável e deve ser executada primeiro numa cópia do banco (homologação).

## 1. Estado das migrations do repositório

Não existe migration inicial (`0_init`): o schema base foi criado fora do Prisma (`database/schema.sql`)
e as migrations abaixo são incrementais. No DEV todas estão registradas em `_prisma_migrations`;
a maioria com `applied_steps_count = 0`, isto é, aplicadas via `prisma db execute` e registradas com
`prisma migrate resolve --applied`.

| Ordem | Migration | Assinatura física | Idempotente |
|---|---|---|---|
| 1 | `20260903160000_profissional_exclusao_definitiva` | `profissionais.deleted_*`, snapshots em `medicoes`, `admin_audit_logs`, índices | sim (`IF NOT EXISTS`) |
| 2 | `20260904120000_condicao_fixa_condicional` | `cadastros_fornecedores.tipo_condicao_fixa`, `valor_condicao_fixa_com/sem_producao` | sim |
| 3 | `20260904140000_fonte_medicao` | `cadastros_fornecedores.fonte_medicao` | sim |
| 4 | `20260909150000_usuario_permissao_extra` | tabela `usuarios_permissoes` + índices | sim |
| 5 | `20260928173000_cadastro_fornecedor_inativacao` | `cadastros_fornecedores.ativo`, `inativado_at` | **não** (`ADD COLUMN` sem `IF NOT EXISTS`) |
| 6 | `20260930090000_profissional_alias` | tabela `profissional_aliases` + índices | sim |

## 2. Auditoria read-only da produção (a executar pelo operador)

```bash
cd /opt/sistema-gestao-medicoes
docker exec -i medicoes-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < scripts/audit-prisma-baseline-readonly.sql > "auditoria-prisma-$(date -u +%Y%m%dT%H%M%SZ).txt"
```

O script roda numa transação `READ ONLY` e termina em `ROLLBACK`. Ele informa: versão do PostgreSQL,
se `_prisma_migrations` existe (e o conteúdo), a classificação de cada migration
(APLICADA FISICAMENTE / NAO APLICADA / INDETERMINADA), tabelas, constraints relevantes e volumes.

## 3. Backup obrigatório (antes de baseline/deploy)

```bash
DEPLOY_TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/opt/sistema-gestao-medicoes-backups/${DEPLOY_TS}"
mkdir -p "$BACKUP_DIR"
docker exec medicoes-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$BACKUP_DIR/medicoes-${DEPLOY_TS}.dump"
test -s "$BACKUP_DIR/medicoes-${DEPLOY_TS}.dump"
stat -c '%s bytes' "$BACKUP_DIR/medicoes-${DEPLOY_TS}.dump" | tee "$BACKUP_DIR/tamanho.txt"
sha256sum "$BACKUP_DIR/medicoes-${DEPLOY_TS}.dump" | tee "$BACKUP_DIR/medicoes-${DEPLOY_TS}.dump.sha256"
docker exec -i medicoes-postgres pg_restore --list < "$BACKUP_DIR/medicoes-${DEPLOY_TS}.dump" > "$BACKUP_DIR/toc.txt"
grep -c "TABLE DATA" "$BACKUP_DIR/toc.txt"   # deve listar as tabelas de dados
```

`pg_dump` só lê (bloqueio ACCESS SHARE); pode rodar com o sistema no ar.

## 4. Plano de baseline (decidido pelo resultado da auditoria)

Regra: registrar como aplicadas **somente** as migrations classificadas como APLICADA FISICAMENTE;
qualquer INDETERMINADA bloqueia o processo até análise manual.

1. Ensaiar tudo numa cópia restaurada do backup (seção 6), nunca direto em produção.
2. Para cada migration APLICADA FISICAMENTE, em ordem:
   `npx prisma migrate resolve --applied <nome>` (o primeiro `resolve` cria `_prisma_migrations`).
3. A primeira migration realmente executada é a primeira NAO APLICADA — esperado:
   `20260930090000_profissional_alias` (e possivelmente outras, conforme a auditoria).
   `npx prisma migrate deploy` aplica só as pendentes.
4. Atenção à migration 5 (`cadastro_fornecedor_inativacao`): se já estiver aplicada fisicamente, ela
   **tem** de ser registrada com `resolve` (reexecutar falharia por coluna duplicada).
5. Validação antes/depois: rodar o script de auditoria (todas APLICADA FISICAMENTE e registradas);
   `npx prisma migrate status` = "Database schema is up to date"; e, na cópia,
   `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`
   sem diferenças (drift zero). Conferir contagens de medições/mapa/cadastros iguais às anteriores.
6. Rollback:
   - baseline (só `resolve`): apagar as linhas inseridas em `_prisma_migrations` (ou a tabela, se foi
     criada agora) — o schema físico não muda;
   - `profissional_aliases` recém-criada e ainda sem dados: `DROP TABLE profissional_aliases` e remover
     a linha correspondente de `_prisma_migrations`;
   - qualquer outro caso: restaurar o backup (`pg_restore --clean --if-exists` num banco novo, validar,
     e só então apontar a aplicação para ele), com a versão anterior da aplicação (`PREVIOUS_SHA`).

## 5. Integração no Git

Topologia (auditada): `origin/layout2.0` = `3159815`; `layout2.0` local = `3159815` + 5 commits não
publicados (ciclo de vida de inativação de fornecedor); `feature/figma-redesign` já contém o
`layout2.0` local (merge `0b01570`), sem nenhum commit exclusivo do lado do `layout2.0`.

Estratégia: **fast-forward** — sem conflitos e sem commit de merge artificial.

```bash
# no worktree onde layout2.0 está checado (C:/Users/.../.codex/worktrees/layout2-integracao/...)
git status --short                       # deve estar vazio
git merge --ff-only feature/figma-redesign
git rev-parse --short HEAD               # deve ser o HEAD aprovado da feature
# push somente com autorização:
git push origin layout2.0 feature/figma-redesign
```

## 6. Homologação

- Ambiente isolado: projeto Compose separado (ex.: `-p medicoes-homolog`), volume próprio e portas
  próprias; banco restaurado do backup de produção (`pg_restore` num banco novo).
- Ensaiar a seção 4 exatamente como será feita em produção.
- E-mail: `EMAIL_ENABLED=false`; se for preciso validar o envio, `EMAIL_ENABLED=true` com
  `EMAIL_TEST_MODE=true` (padrão) e `BM_EMAIL_TEST_TO` apontando para uma caixa controlada — nunca
  `EMAIL_TEST_MODE=false` em homologação.
- Validar: migrations e drift, aliases (resolução e importação), importação da planilha e máscara
  limpa, Dashboard, Fornecedores (ciclo publicado, Gerenciar ciclos), Administrativo, Evidências,
  Financeiro, Histórico, portal do fornecedor, e o `DELETE /api/ciclos` num ciclo de teste
  (só limpa o que pertencia ao ciclo).
- Rodar a suíte Playwright contra o ambiente de homologação quando possível.

## 7. Checklist de produção

- [x] `DELETE /api/ciclos` corrigido (limpeza restrita ao ciclo excluído)
- [x] teste real do DELETE verde (E2E sem interceptação)
- [ ] Cristiano validado pela área de negócio (pendência externa)
- [ ] backup de produção (seção 3) com SHA-256 e TOC
- [ ] auditoria read-only da produção executada e revisada (seção 2)
- [ ] baseline Prisma aprovado
- [ ] baseline ensaiado em cópia
- [ ] migration de aliases ensaiada
- [ ] branch integrada (fast-forward) e publicada com autorização
- [ ] regressão completa
- [ ] homologação aprovada
- [ ] plano de rollback revisado
- [ ] janela de deploy definida
