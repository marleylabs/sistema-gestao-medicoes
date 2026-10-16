---
atualizado: 2026-10-16
---
# Status

## Em andamento
- Branch `release/2026-10-02-import-identities`, HEAD bf97ecd. `layout2.0` está em 7482a2d (2 commits atrás).
- Não enviados ao remoto: ecf5477 ([decisão 010](decisoes/010-reimportacao-preserva-bm.md) + CLAUDE.md + cérebro) e bf97ecd (correções da revisão: carga abortada se um BM for aprovado durante a importação; testes de MAPA PAGTO, Documentos Auxiliares e aprovação concorrente).
- `test:targeted` no HEAD (bf97ecd + este commit de docs): 464/464 no `medicoes_e2e_bm`, depois de `npm run test:e2e:seed` nesse banco.
- Integração em `layout2.0`/`release/*`; `main` (13b7cd7) está 85 commits atrás.

## Próximos passos
1. Fazer push e levar ecf5477, bf97ecd e o commit de docs para `layout2.0`.
2. Resolver as pendências P1 de [pendências](pendencias.md).
3. Fechar os itens abertos de `docs/plano-pre-deploy-producao.md` §7 (os checkboxes de §4 estão desatualizados: auditoria e ensaio feitos em 2026-09-30).
4. Criar rotina de backup automática (hoje só há `pg_dump` manual nos runbooks).
5. Definir o fluxo manual para corrigir valores de BM aprovado ou pago (a planilha só reporta a divergência).
6. Atualizar `docker-compose.prod.yml` para o Resend, `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`.

## Bloqueios
- `npm run lint` não roda (não há `eslint.config.*`). Use `npx tsc --noEmit`.
- Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` apontando para um banco de teste migrado. Sem isso, `tests/documentos-medidos.test.ts` grava no banco DEV.
- O banco `medicoes_e2e` está sem as migrations de 2026-09-28 em diante; use `medicoes_e2e_bm`. Um banco de teste novo precisa de `prisma migrate deploy` e de `npm run test:e2e:seed`; sem o seed, `tests/identidade-importacao.test.ts` falha (ver [pendências](pendencias.md)).

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-16: cérebro reorganizado (status e [pendências](pendencias.md)); CLAUDE.md passa a usar `npx tsc --noEmit` e a exigir banco de teste nos testes; `.gitignore` ignora o estado pessoal do Obsidian.
- 2026-10-16 bf97ecd: carga abortada quando um BM é aprovado durante a importação; novos testes. 11 testes do ETL e tsc passando.
- 2026-10-16 ecf5477: reimportação preserva BMs em AGUARDANDO_NF, APROVADO e PAGO; divergências reportadas em `divergencias_bm_bloqueado`. `test:targeted` 464/464 antes das correções da revisão.
- 2026-10-16: cérebro do projeto criado (arquitetura, glossário, 14 módulos, 9 decisões).
- 7482a2d: feat(import): identidades de fornecedor pendentes.