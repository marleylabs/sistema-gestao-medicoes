-- Auditoria SOMENTE LEITURA do estado Prisma/schema de um banco (produção ou cópia).
-- Não altera nada: roda numa transação READ ONLY e termina com ROLLBACK.
--
-- Uso (no host, sem expor senha):
--   docker exec -i medicoes-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < scripts/audit-prisma-baseline-readonly.sql > auditoria-prisma-$(date -u +%Y%m%dT%H%M%SZ).txt
--
-- Cada migration de prisma/migrations é classificada pela sua assinatura física:
--   APLICADA FISICAMENTE = todos os objetos existem; NAO APLICADA = nenhum existe;
--   INDETERMINADA = existência parcial (exige análise manual antes de qualquer baseline).

BEGIN TRANSACTION READ ONLY;

\echo '== Servidor'
SELECT version() AS postgres, current_database() AS banco, current_user AS usuario, now() AS executado_em;

\echo '== _prisma_migrations'
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS existe_prisma_migrations \gset
\if :existe_prisma_migrations
  \echo '_prisma_migrations EXISTE — conteúdo:'
  SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
  FROM public._prisma_migrations ORDER BY started_at;
\else
  \echo '_prisma_migrations NAO EXISTE (banco sem histórico Prisma — exige baseline antes de migrate deploy)'
\endif

\echo '== Assinatura física por migration'
WITH col AS (
  SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
), idx AS (
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
), sig(migration, objeto, existe) AS (
  VALUES
    ('20260903160000_profissional_exclusao_definitiva', 'profissionais.deleted_at',              EXISTS (SELECT 1 FROM col WHERE table_name = 'profissionais' AND column_name = 'deleted_at')),
    ('20260903160000_profissional_exclusao_definitiva', 'profissionais.deleted_reason',          EXISTS (SELECT 1 FROM col WHERE table_name = 'profissionais' AND column_name = 'deleted_reason')),
    ('20260903160000_profissional_exclusao_definitiva', 'medicoes.profissional_nome_snapshot',   EXISTS (SELECT 1 FROM col WHERE table_name = 'medicoes' AND column_name = 'profissional_nome_snapshot')),
    ('20260903160000_profissional_exclusao_definitiva', 'tabela admin_audit_logs',               to_regclass('public.admin_audit_logs') IS NOT NULL),
    ('20260903160000_profissional_exclusao_definitiva', 'idx_profissionais_deleted_at',          EXISTS (SELECT 1 FROM idx WHERE indexname = 'idx_profissionais_deleted_at')),
    ('20260904120000_condicao_fixa_condicional',        'cadastros_fornecedores.tipo_condicao_fixa', EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'tipo_condicao_fixa')),
    ('20260904120000_condicao_fixa_condicional',        'cadastros_fornecedores.valor_condicao_fixa_com_producao', EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'valor_condicao_fixa_com_producao')),
    ('20260904120000_condicao_fixa_condicional',        'cadastros_fornecedores.valor_condicao_fixa_sem_producao', EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'valor_condicao_fixa_sem_producao')),
    ('20260904140000_fonte_medicao',                    'cadastros_fornecedores.fonte_medicao',  EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'fonte_medicao')),
    ('20260909150000_usuario_permissao_extra',          'tabela usuarios_permissoes',            to_regclass('public.usuarios_permissoes') IS NOT NULL),
    ('20260909150000_usuario_permissao_extra',          'usuarios_permissoes_usuario_id_permissao_key', EXISTS (SELECT 1 FROM idx WHERE indexname = 'usuarios_permissoes_usuario_id_permissao_key')),
    ('20260928173000_cadastro_fornecedor_inativacao',   'cadastros_fornecedores.ativo',          EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'ativo')),
    ('20260928173000_cadastro_fornecedor_inativacao',   'cadastros_fornecedores.inativado_at',   EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'inativado_at')),
    ('20260930090000_profissional_alias',               'tabela profissional_aliases',           to_regclass('public.profissional_aliases') IS NOT NULL),
    ('20260930090000_profissional_alias',               'profissional_aliases_profissional_alias_key', EXISTS (SELECT 1 FROM idx WHERE indexname = 'profissional_aliases_profissional_alias_key'))
)
SELECT migration, objeto, existe FROM sig ORDER BY migration, objeto;

\echo '== Classificação'
WITH col AS (
  SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
), idx AS (
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
), sig(migration, existe) AS (
  VALUES
    ('20260903160000_profissional_exclusao_definitiva', EXISTS (SELECT 1 FROM col WHERE table_name = 'profissionais' AND column_name = 'deleted_at')),
    ('20260903160000_profissional_exclusao_definitiva', EXISTS (SELECT 1 FROM col WHERE table_name = 'profissionais' AND column_name = 'deleted_reason')),
    ('20260903160000_profissional_exclusao_definitiva', EXISTS (SELECT 1 FROM col WHERE table_name = 'medicoes' AND column_name = 'profissional_nome_snapshot')),
    ('20260903160000_profissional_exclusao_definitiva', to_regclass('public.admin_audit_logs') IS NOT NULL),
    ('20260903160000_profissional_exclusao_definitiva', EXISTS (SELECT 1 FROM idx WHERE indexname = 'idx_profissionais_deleted_at')),
    ('20260904120000_condicao_fixa_condicional',        EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'tipo_condicao_fixa')),
    ('20260904120000_condicao_fixa_condicional',        EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'valor_condicao_fixa_com_producao')),
    ('20260904120000_condicao_fixa_condicional',        EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'valor_condicao_fixa_sem_producao')),
    ('20260904140000_fonte_medicao',                    EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'fonte_medicao')),
    ('20260909150000_usuario_permissao_extra',          to_regclass('public.usuarios_permissoes') IS NOT NULL),
    ('20260909150000_usuario_permissao_extra',          EXISTS (SELECT 1 FROM idx WHERE indexname = 'usuarios_permissoes_usuario_id_permissao_key')),
    ('20260928173000_cadastro_fornecedor_inativacao',   EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'ativo')),
    ('20260928173000_cadastro_fornecedor_inativacao',   EXISTS (SELECT 1 FROM col WHERE table_name = 'cadastros_fornecedores' AND column_name = 'inativado_at')),
    ('20260930090000_profissional_alias',               to_regclass('public.profissional_aliases') IS NOT NULL),
    ('20260930090000_profissional_alias',               EXISTS (SELECT 1 FROM idx WHERE indexname = 'profissional_aliases_profissional_alias_key'))
)
SELECT migration,
       CASE WHEN bool_and(existe) THEN 'APLICADA FISICAMENTE'
            WHEN NOT bool_or(existe) THEN 'NAO APLICADA'
            ELSE 'INDETERMINADA' END AS classificacao,
       count(*) FILTER (WHERE existe) || '/' || count(*) AS objetos
FROM sig GROUP BY migration ORDER BY migration;

\echo '== Tabelas do schema public (estrutura física)'
SELECT table_name, count(*) AS colunas
FROM information_schema.columns WHERE table_schema = 'public'
GROUP BY table_name ORDER BY table_name;

\echo '== Constraints relevantes'
SELECT conrelid::regclass AS tabela, conname, contype, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN ('profissionais', 'cadastros_fornecedores', 'medicoes', 'mapa_pagamento_contexto', 'sgc_aprovacoes_medicao', 'usuarios_permissoes', 'profissional_aliases')
ORDER BY 1, 2;

\echo '== Volumes (somente contagem)'
SELECT 'medicoes' AS tabela, count(*) FROM medicoes
UNION ALL SELECT 'mapa_pagamento_itens', count(*) FROM mapa_pagamento_itens
UNION ALL SELECT 'profissionais', count(*) FROM profissionais
UNION ALL SELECT 'cadastros_fornecedores', count(*) FROM cadastros_fornecedores
UNION ALL SELECT 'mapa_pagamento_contexto', count(*) FROM mapa_pagamento_contexto;

ROLLBACK;
