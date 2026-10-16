---
atualizado: 2026-10-16
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
2. Resolver as pendências P1 de [pendências](pendencias.md). Próxima: escopo do fornecedor por nome em `lib/colaborador-alias.ts`; [spec](specs/p1-escopo-fornecedor-por-identidade.md) aprovada; [plano](specs/p1-escopo-fornecedor-por-identidade-plano.md) aprovado; em execução a partir da T1.
3. Fechar os itens abertos de `docs/plano-pre-deploy-producao.md` §7 (os checkboxes de §4 estão desatualizados: auditoria e ensaio feitos em 2026-09-30).
4. Criar rotina de backup automática (hoje só há `pg_dump` manual nos runbooks).
5. Definir o fluxo manual para corrigir valores de BM aprovado ou pago (a planilha só reporta a divergência).
6. Pré-produção, já autorizado: limpar `senha_temporaria` antiga (`UPDATE usuarios SET senha_temporaria = NULL`) e rodar `diagnose_identities.py` na planilha real.
7. Atualizar `docker-compose.prod.yml` para o Resend, `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`.

## Bloqueios
- `npm run lint` não roda (não há `eslint.config.*`). Use `npx tsc --noEmit`.
- Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` apontando para um banco de teste migrado (ou carregue o `.env.test`). Os testes de banco usam `lib/prisma-test.ts` e abortam sem essas variáveis.
- O banco `medicoes_e2e` está sem as migrations de 2026-09-28 em diante; use `medicoes_e2e_bm`. Um banco de teste novo precisa de `prisma migrate deploy` e de `npm run test:e2e:seed`; sem o seed, `tests/identidade-importacao.test.ts` falha (ver [pendências](pendencias.md)).

## Cuidados operacionais
- Nunca usar `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.
- `npm run build` e o Playwright compartilham `.next`: rode `rm -rf .next` depois do build.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-16: limpeza da reimportação casa só identidade exata; fornecedor ausente com nome parecido não perde mais medições, mapa nem BM. 11 testes do ETL com banco e `test:targeted` 465/465.
- 2026-10-16: ENVIAR do fornecedor recusa (409) BM com conferência não concluída; E2E em `e2e/portal-fornecedor-redesign.spec.ts` (11/11). `test:targeted` 464/465 (falha do `psycopg` ausente).
- 2026-10-16: `documentos-medidos` e `usuario-nome` passam a usar `lib/prisma-test.ts` (guarda contra gravar no banco DEV). `test:targeted` 463/464; a falha é a do `psycopg` ausente.
- 2026-10-16: ecf5477, bf97ecd e o cérebro enviados ao GitHub e levados para `layout2.0`; `graph.json` do Obsidian fora do versionamento.
- 2026-10-16: cérebro reorganizado (status e [pendências](pendencias.md)); CLAUDE.md passa a usar `npx tsc --noEmit` e a exigir banco de teste nos testes; `.gitignore` ignora o estado pessoal do Obsidian.
