---
atualizado: 2026-10-18
---
# Status

## Em andamento
- **P2 — P0 como único ID do fornecedor** ([spec](specs/p2-vinculo-login-profissional.md), [plano](specs/p2-vinculo-login-profissional-plano.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md)). T1 a T5 prontas e testadas no ambiente local; nada implantado. **Pré-produção migrada e implantada em 2026-10-18 (UTC)** com 2e1a9a4: 55/55 migrados, medição ok antes e depois do deploy, smoke ok ([plano, T6](specs/p2-vinculo-login-profissional-plano.md), [runbook](../runbook-p0-pre-producao.md)). Falta a produção: novo ensaio local com um backup dela, runbook ajustado, `/review` e `/ponytail-review` antes.
  - Ordem combinada em 2026-10-17: tudo no ambiente local primeiro. O ensaio com dados reais roda numa cópia local de um backup da pré-produção; o servidor só é tocado na T6.
  - Tudo enviado ao GitHub em 2026-10-17: `release/2026-10-02-import-identities` em 6fec06d (spec, T1 a T5, E2E do financeiro, ensaio e runbook). Candidato a `APPROVED_SHA` do runbook: este commit ou o seguinte, que só atualiza o status. `layout2.0` continua em 58375bb.
- Pré-produção roda 2e1a9a4 (8 migrations, dados no P0). Rollback: imagens `local/medicoes-{web,etl}-rollback:20261018T011856Z` + `~/backups-medicoes/p0_20261018T011856Z/` (dump, JSONs, logs). Ficou lá um fornecedor de teste do smoke, com medição.
- Pré-produção: o volume antigo `projetocrud-medio_postgres_data` não é usado (o banco está no `_v2`); avaliar a remoção fora de janela, com backup.
- Testes em 2026-10-17, com a T5 no ambiente local: `test:targeted` 506/506, `pytest etl/` 44/44 e E2E 207/207 em duas rodadas seguidas, no `medicoes_e2e_bm`, depois de `npm run test:e2e:seed` nesse banco.
- Integração em `layout2.0`/`release/*`; `main` (13b7cd7) está 85 commits atrás.

## Próximos passos
1. (feito) Fast-forward de `layout2.0`.
2. P1 resolvidas em 2026-10-16, incluindo os achados da revisão da P1 4 (cadastro exibido pelo escopo, conferência por `profissionalId`, login ambíguo, escopo único em Minhas Medições) e o bloqueio da troca de nome ([decisão 011](decisoes/011-nome-do-fornecedor-so-pelo-administrativo.md)). Próxima frente: P2 de [pendências](pendencias.md), começando pelo vínculo explícito login → Profissional (P0 como único ID: [spec aprovada](specs/p2-vinculo-login-profissional.md), [plano](specs/p2-vinculo-login-profissional-plano.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md); T1 a T4 feitas no banco de teste; próximo: T6 (ensaio local com um backup da pré-produção, depois pré-produção e produção). Tudo local primeiro; a pré-produção e a produção ficam para a T6).
3. Fechar os itens abertos de `docs/plano-pre-deploy-producao.md` §7 (os checkboxes de §4 estão desatualizados: auditoria e ensaio feitos em 2026-09-30).
4. Criar rotina de backup automática (hoje só há `pg_dump` manual nos runbooks).
5. Definir o fluxo manual para corrigir valores de BM aprovado ou pago (a planilha só reporta a divergência).
6. Pré-produção, já autorizado: limpar `senha_temporaria` antiga (`UPDATE usuarios SET senha_temporaria = NULL`) e rodar `diagnose_identities.py` na planilha real.
7. Atualizar `docker-compose.prod.yml` para o Resend, `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`.

## Bloqueios
- `npm run lint` não roda (não há `eslint.config.*`). Use `npx tsc --noEmit`.
- `pytest etl/` precisa de `DATA_ENCRYPTION_KEY` (32 bytes em Base64); o `.env.test` não tem. Use uma chave aleatória só para o teste. Não exporte essa chave para o `test:targeted`: ali o Prisma carrega a chave real do `.env`, e uma chave diferente quebra a decifragem dos dados do banco de teste.
- E2E: rode sempre `npm run test:e2e:seed` antes. Sem ele, sobras da rodada anterior quebram specs do Administrativo.
- Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` apontando para um banco de teste migrado (ou carregue o `.env.test`). Os testes de banco usam `lib/prisma-test.ts` e abortam sem essas variáveis.
- O banco `medicoes_e2e` está sem as migrations de 2026-09-28 em diante; use `medicoes_e2e_bm`. Um banco de teste novo precisa de `prisma migrate deploy` e de `npm run test:e2e:seed`; sem o seed, `tests/identidade-importacao.test.ts` falha (ver [pendências](pendencias.md)).

## Cuidados operacionais
- O banco DEV local (`medicoes`) deste notebook está sem as migrations recentes (não tem `profissional_aliases`).
- Nunca usar `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.
- `npm run build` e o Playwright compartilham `.next`: rode `rm -rf .next` depois do build.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-18: T6 da P2 na pré-produção: 55/55 fornecedores no P0, deploy de 2e1a9a4, medição e smoke ok.
- 2026-10-17: E2E do financeiro com projeto próprio. O projeto arbitrário podia se chamar "DESCONTO" e transformar documentos em desconto; o E2E completo agora passa 206/206 em duas rodadas seguidas.
- 2026-10-17: T4 da P2: o app não liga mais usuário e cadastro do fornecedor pelo nome (portal, NF, listagem, inativação, exclusão, edição). Regra única em `usuariosDoFornecedor` (`lib/codigo-p0.ts`); a migração inclui os inativos. `test:targeted` 506/506, E2E 206/206.
- 2026-10-17: T3 da P2: fornecedor novo nasce com P0 (nome vira alias `CADASTRO`); identidade antiga reativada passa para o P0 do login (`lib/codigo-p0.ts`); usuário de outro fornecedor nunca é reaproveitado pelo nome. `test:targeted` 498/498, E2E de fornecedor 46/46 (2 rodadas).
- 2026-10-17: T2 da P2 (P0 como ID): migração com aplicar, medir e reverter (`lib/migracao-codigo-p0.ts`, `scripts/migrar-codigo-p0.ts`), sem mudança no ETL. `test:targeted` 493/493, `pytest etl/` 44/44.
