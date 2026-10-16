---
atualizado: 2026-10-16
tags: [arquitetura]
---
# Arquitetura

## Stack
- **Web:** Next.js 16 (App Router, React 19), HeroUI 3 + Tailwind 4. API em `app/api/**`. Exceção: `pages/api/admin/etl.ts` (Pages Router) só para desligar o bodyParser e repassar uploads de até 100 MB ao ETL.
- **Banco:** PostgreSQL 16 via Prisma 6 (`prisma/schema.prisma`, `prisma/migrations/`). Ver [001 Migrations Prisma como fonte de verdade](decisoes/001-migrations-prisma-fonte-de-verdade.md).
- **ETL:** serviço HTTP em Python 3.13 (`etl/server.py` + `etl/ingest_medicoes.py`, pandas/SQLAlchemy), porta 4000. Ver [ETL](modulos/etl.md).
- **Sessão:** JWT próprio (jose) em cookie, revalidado no banco a cada request (`lib/session.ts`, `lib/auth.ts`, `proxy.ts`).
- **E-mail:** Resend (`lib/email/`). `nodemailer` está no package.json, mas nenhum código o importa.
- **Validação de entrada:** manual (sem zod). Usa `typeof`, normalizadores e helpers como `isUuid`/`detectAllowed*Mime` (`lib/file-security.ts`).

## Pastas
- `app/`: páginas (`page.tsx` escolhe a UI pelo perfil: o COLABORADOR cai em `components/colaborador-app.tsx`) e rotas de API.
- `components/`: UI por área (`administrativo/`, `financeiro/`, `divergencias/`, `evidencias/`, `historico/`, `importacao/`, `dashboard-pilot/`...).
- `lib/`: regras de negócio e acesso a dados; as rotas são finas e chamam funções daqui.
- `etl/`: importação de planilhas e testes Python (`test_*.py`).
- `prisma/`: schema e migrations. `database/schema.sql` e `database/schema.prisma` são legados e não devem ser usados para gerar o cliente.
- `tests/`: testes `tsx --test` (`npm run test:targeted`). `e2e/`: Playwright (1 worker, `next dev -p 3011` sobre banco E2E).
- `scripts/`: auditorias read-only, scripts de identidade/aliases, seed e reset de dev (protegidos por `scripts/lib/dev-guard.ts`).

## Fluxo principal
1. **Carga:** o perfil MEDICAO sobe a planilha do ciclo → ETL grava `medicoes`, `mapa_pagamento_*`, `bm_aux_medicoes`.
2. **Envio do BM** (Planejamento) → fornecedor confere (upload de planilha) → divergências resolvidas pela equipe.
3. **Fornecedor aprova o BM** → envia a NF → Financeiro registra o pagamento.

O estado do fluxo fica por fornecedor + ciclo em `SgcAprovacaoMedicao`, não na linha de medição. Ver [002](decisoes/002-estado-do-fluxo-por-fornecedor-e-ciclo.md) e [Ciclo de vida do BM](modulos/envio-bm.md).

## Perfis × setores do CLAUDE.md
Os perfis são strings em `lib/perfis.ts`: ADMIN, MEDICAO, ADMINISTRATIVO, FINANCEIRO, COLABORADOR (= fornecedor). O código não tem o conceito de "setor". A leitura provável é Planejamento = MEDICAO, mas isso não está confirmado. As guardas (`lib/admin.ts`) não seguem estritamente um setor por etapa: `requireFinanceiro`, por exemplo, também libera MEDICAO, ADMIN e ADMINISTRATIVO. Ver [Autenticação](modulos/autenticacao.md).

## Infra
- `docker-compose.yml`: postgres, etl, web (Node 22, `standalone`) e o perfil `migrate` (`prisma migrate deploy`).
- `docker-compose.test.yml`: postgres de teste em 127.0.0.1:15433.
- `docker-compose.prod.yml` está desatualizado: ainda tem SMTP e não tem as variáveis do Resend.
- Runbooks: `docs/deploy-linux-docker.md`, `docs/reset-pre-producao.md`, `docs/plano-pre-deploy-producao.md`.
- Health: `app/api/health`. Reset do banco: `app/api/admin/reset-database` (só ADMIN, exige confirmação; bloqueado em produção sem `ALLOW_DATABASE_RESET`).
