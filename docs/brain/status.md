---
atualizado: 2026-10-17
---
# Status

## Em andamento
- Branch `release/2026-10-02-import-identities`, HEAD 69d48a7, já enviado ao GitHub (inclui ecf5477, bf97ecd, 7f2b9d0 e 69d48a7). Todos os branches locais do outro notebook também foram publicados.
- `layout2.0` recebeu esses commits por fast-forward em 2026-10-16.
- Pré-produção roda 7482a2d (8 migrations). Rollback: imagens `projetocrud-medio-{web,etl}:pre-import-identities-3830ba4` + backup `pre_import_identities_7482a2d_20261002_155132`.
- `test:targeted` em bf97ecd: 464/464 no `medicoes_e2e_bm`, depois de `npm run test:e2e:seed` nesse banco.
- Integração em `layout2.0`/`release/*`; `main` (13b7cd7) está 85 commits atrás.

## Próximos passos
1. (feito) Fast-forward de `layout2.0`.
2. P1 resolvidas em 2026-10-16, incluindo os achados da revisão da P1 4 (cadastro exibido pelo escopo, conferência por `profissionalId`, login ambíguo, escopo único em Minhas Medições) e o bloqueio da troca de nome ([decisão 011](decisoes/011-nome-do-fornecedor-so-pelo-administrativo.md)). Próxima frente: P2 de [pendências](pendencias.md), começando pelo vínculo explícito login → Profissional (P0 como único ID: [spec aprovada](specs/p2-vinculo-login-profissional.md), [plano](specs/p2-vinculo-login-profissional-plano.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md); T1 a T3 feitas no banco de teste; próximo: T4, fim da busca por nome. Tudo local primeiro; a pré-produção e a produção ficam para a T6).
3. Fechar os itens abertos de `docs/plano-pre-deploy-producao.md` §7 (os checkboxes de §4 estão desatualizados: auditoria e ensaio feitos em 2026-09-30).
4. Criar rotina de backup automática (hoje só há `pg_dump` manual nos runbooks).
5. Definir o fluxo manual para corrigir valores de BM aprovado ou pago (a planilha só reporta a divergência).
6. Pré-produção, já autorizado: limpar `senha_temporaria` antiga (`UPDATE usuarios SET senha_temporaria = NULL`) e rodar `diagnose_identities.py` na planilha real.
7. Atualizar `docker-compose.prod.yml` para o Resend, `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`.

## Bloqueios
- `npm run lint` não roda (não há `eslint.config.*`). Use `npx tsc --noEmit`.
- `pytest etl/` precisa de `DATA_ENCRYPTION_KEY` (32 bytes em Base64); o `.env.test` não tem. Use uma chave aleatória só para o teste.
- Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` apontando para um banco de teste migrado (ou carregue o `.env.test`). Os testes de banco usam `lib/prisma-test.ts` e abortam sem essas variáveis.
- O banco `medicoes_e2e` está sem as migrations de 2026-09-28 em diante; use `medicoes_e2e_bm`. Um banco de teste novo precisa de `prisma migrate deploy` e de `npm run test:e2e:seed`; sem o seed, `tests/identidade-importacao.test.ts` falha (ver [pendências](pendencias.md)).

## Cuidados operacionais
- O banco DEV local (`medicoes`) deste notebook está sem as migrations recentes (não tem `profissional_aliases`).
- Nunca usar `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.
- `npm run build` e o Playwright compartilham `.next`: rode `rm -rf .next` depois do build.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-17: T3 da P2: fornecedor novo nasce com P0 (nome vira alias `CADASTRO`); identidade antiga reativada passa para o P0 do login (`lib/codigo-p0.ts`); usuário de outro fornecedor nunca é reaproveitado pelo nome. `test:targeted` 498/498, E2E de fornecedor 46/46 (2 rodadas).
- 2026-10-17: T2 da P2 (P0 como ID): migração com aplicar, medir e reverter (`lib/migracao-codigo-p0.ts`, `scripts/migrar-codigo-p0.ts`), sem mudança no ETL. `test:targeted` 493/493, `pytest etl/` 44/44.
- 2026-10-16: T1 da P2 (P0 como ID): inventário das colunas e dry-run só leitura (`lib/migracao-codigo-p0.ts`, `scripts/migrar-codigo-p0.ts`). `test:targeted` 485/485.
- 2026-10-16: spec da P2 aprovada (P0 como único ID do fornecedor; código antigo vira alias), decisão 012 e plano T1–T6.
- 2026-10-16: achados da revisão da P1 4 corrigidos (cadastro exibido, conferência, login ambíguo, N+1 em Minhas Medições; testes V2 e de login). `test:targeted` 478/478, E2E 206/206.
