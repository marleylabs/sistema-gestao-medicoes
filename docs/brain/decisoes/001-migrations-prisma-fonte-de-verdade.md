---
data: 2026-09-02
status: aceita
tags: [decisao]
---
# 001 Migrations Prisma como fonte de verdade do banco

**Contexto:** o banco nasceu de um script manual (`database/schema.sql`) e de um `database/schema.prisma` legado. Sem histórico versionado, as mudanças em produção eram arriscadas.

**Decisão:** criar um baseline (`prisma/migrations/20260902000000_baseline_legado`) e evoluir o banco só com migrations do Prisma (`prisma migrate deploy` no perfil `migrate` do compose). O banco é PostgreSQL 16.

**Alternativas descartadas:** continuar com `schema.sql` manual (sem histórico) e `db push` (perde controle em produção).

**Consequências:** toda mudança de schema é uma nova migration; nunca se edita uma já aplicada. O ETL não cria tabelas. `database/` é legado. `docs/database-source-of-truth.md` ainda descreve o estado anterior ao baseline e precisa ser atualizado. Há CHECKs que existem só no SQL (ex.: `statusColaborador`).
