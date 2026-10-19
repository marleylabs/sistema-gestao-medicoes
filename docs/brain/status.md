---
atualizado: 2026-10-18
---
# Status

## Em andamento
- **Layout: tema claro/escuro e motion** ([spec](specs/layout-tema-motion.md); planos do [M1](specs/layout-tema-motion-plano.md), [M2](specs/layout-tema-motion-m2-plano.md) e [M3](specs/layout-tema-motion-m3-plano.md)):
  - M1 (fundação) commitado em a516126; M2 (login e dashboard) em ee6d375; correção da corrida do login no E2E em 29384c5. Nada enviado ao GitHub.
  - M3 (painéis dos setores) em andamento, sem commit: T1 (painel lateral com entrada e saída) e T2 (`Modal` único, 19 modais) feitas. `test:targeted` 533/533, E2E 208/208 em duas rodadas seguidas.
  - O E2E roda com `reducedMotion: "reduce"` (`playwright.config.ts`).
  - M3 (7fb1499) e M4 (portal do fornecedor) commitados na release, sem push. As quatro etapas do layout (M1 a M4) estão concluídas.
- **P2 — P0 como único ID do fornecedor** ([spec](specs/p2-vinculo-login-profissional.md), [plano](specs/p2-vinculo-login-profissional-plano.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md)). T1 a T5 prontas e testadas no ambiente local; nada implantado. **Pré-produção migrada e implantada em 2026-10-18 (UTC)** com 2e1a9a4: 55/55 migrados, medição ok antes e depois do deploy, smoke ok ([plano, T6](specs/p2-vinculo-login-profissional-plano.md), [runbook](../runbook-p0-pre-producao.md)). Falta a produção: novo ensaio local com um backup dela, runbook ajustado, `/review` e `/ponytail-review` antes.
  - Ordem combinada em 2026-10-17: tudo no ambiente local primeiro. O ensaio com dados reais roda numa cópia local de um backup da pré-produção; o servidor só é tocado na T6.
  - Tudo enviado ao GitHub em 2026-10-17: `release/2026-10-02-import-identities` em 6fec06d (spec, T1 a T5, E2E do financeiro, ensaio e runbook). Candidato a `APPROVED_SHA` do runbook: este commit ou o seguinte, que só atualiza o status. `layout2.0` continua em 58375bb.
- Pré-produção roda 2e1a9a4 (8 migrations, dados no P0). Rollback: imagens `local/medicoes-{web,etl}-rollback:20261018T011856Z` + `~/backups-medicoes/p0_20261018T011856Z/` (dump, JSONs, logs). Ficou lá um fornecedor de teste do smoke, com medição.
- Pré-produção: o volume antigo `projetocrud-medio_postgres_data` não é usado (o banco está no `_v2`); avaliar a remoção fora de janela, com backup.
- E2E instável em 2026-10-18, depois do M2. A causa principal foi achada e corrigida:
  - `LoginPage.login` (`e2e/pages/login-page.ts`) devolvia o controle logo após o POST, mas o formulário ainda faz `window.location.assign("/")`. O `page.goto` seguinte corria contra essa navegação: dava `net::ERR_ABORTED` ou recarregava a tela no meio do teste. O login mais pesado do M2 alargou essa janela.
  - Agora o helper espera sair de `/login`, exceto em falha ou troca de senha. O teste de regressão em `e2e/login.spec.ts` falhava 3/3 antes e passa 5/5 depois. O seletor de célula do boletim em `e2e/workflow-happy-path.spec.ts` ganhou `exact: true`.
  - Resultado: 208/208, 207/208 e 208/208 em três rodadas seguidas. A falha que sobrou é outra: `ECONNRESET` num `page.request.post("/api/auth/logout")` (`hotfix-mascara-grafico-filtros.spec.ts:168`).
  - O `next dev` do webServer registra de 7 a 28 `uncaughtException: Error: aborted` (ECONNRESET) por rodada, vindos de requisições canceladas nas trocas de página (polling). Suspeita, não confirmada: o servidor de dev sob carga. Rodar o E2E contra `next build` + `next start` resolveria. Não investigado.
  - 2026-10-18: `tests/migrar-codigo-p0.test.ts` falhou uma vez no `test:targeted` (3 testes: aplicar, medir e reverter P0). Passou isolado (16/16) e em duas rodadas seguidas da suíte (537/537). Suspeita, não confirmada: o `tsx --test` roda os arquivos em paralelo e outro teste de banco mexe nas mesmas linhas. Não investigado.
  - 2026-10-18: `hotfix-mascara-grafico-filtros.spec.ts:152` (popovers de filtro dentro da viewport) falhou uma vez na suíte completa e passou isolado (4/4) e de novo junto do happy path. Na mesma rodada, `workflow-happy-path` falhou por um localizador ambíguo (`getByText(/BOLETIM DE MEDIÇÃO/i)` também casava com o título do visualizador); trocado pela célula do BM, como o outro passo do mesmo spec já fazia.
  - 2026-10-18 (checkpoint B do M4): falhas intermitentes isoladas em `portal-fornecedor-redesign:162` e `importacao-identidades:128`, uma em cada rodada; repetidos isolados, passaram (44/44 e 16/16).
- Intermitência vista em 2026-10-18: numa rodada de `test:targeted` logo depois do E2E, 2 testes de `tests/migrar-codigo-p0.test.ts` (medir e reverter) falharam. Passaram isolados (16/16) e em duas rodadas completas seguidas (520/520). Suspeita: estado residual do E2E no banco compartilhado. Não investigado.
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
- `next dev` reescreve `tsconfig.json` (acrescenta `.next/dev/dev/types`): reverta com `git checkout -- tsconfig.json` antes de commitar. Para ver o app contra o banco de teste, use `.claude/launch.json` (`dev-banco-teste`, porta 3100), que carrega o `.env.test`.
- Banco DEV local (`medicoes`, Docker na porta 3000): migrado em 2026-10-18 (baseline + `migrate deploy`, 8/8, `migrate diff` = 0; backup em `~/backups-medicoes/dev_20261018T212154Z/`; imagens `local/medicoes-{web,etl}-rollback:20261018T212154Z`). Web e etl reconstruídos com o código de f856767. Migração de códigos P0 aplicada nele em 2026-10-18 (1/1 migrado, `--medir` 1 ok; ADMIN de auditoria P0000001; backup antes em `~/backups-medicoes/dev_p0_20261018T212902Z/`, com os JSONs de aplicar e medir). O container `medicoes-web-layout` (porta 3200, banco de teste) fica fora do compose.
- Nunca usar `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.
- `npm run build` e o Playwright compartilham `.next`: rode `rm -rf .next` depois do build.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-18: bug corrigido: com poucos resultados, o popover de Filtros de Administrativo, Histórico e Evidências era cortado pelo card da lista (`overflow-hidden`). O card agora deixa o popover sair dele; as tabelas já rolam sozinhas. Teste: "FILTROS (bug)" em `e2e/hotfix-mascara-grafico-filtros.spec.ts`. `test:targeted` 542/542. Sem commit.
- 2026-10-18: bug corrigido: editar o e-mail do fornecedor no Administrativo não atualizava o e-mail de acesso (`Usuario.email`), e "Enviar primeiro acesso" ia para o endereço antigo. A edição agora sincroniza nome e e-mail do usuário do código (`sincronizarUsuarioDoFornecedor`). E-mail apagado no cadastro não apaga o de acesso. Cadastros que já estão divergentes se corrigem ao salvar a edição de novo. Teste: `e2e/administrativo-editar-email.spec.ts`. `test:targeted` 542/542. Commit 27a9c9c (sem push).
- 2026-10-18: M4 do layout (portal do fornecedor): Minhas Medições com Modal, painel animado e realce; diálogos com saída inerte; ação pendente em destaque; títulos animados e cascata; chat com entrada animada. Achados da revisão corrigidos (valores do BM sem contagem, Esc desligado na saída).
- 2026-10-18: M3 do layout (painéis, `Modal`, abas, `Toast`, `Skeleton`, realce da linha) com os achados da revisão corrigidos. Inclui: painéis e modais ficam `inert` durante a saída, e fechar o BM durante o carregamento não reabre mais (`useVisualizadorBm`). Commit 7fb1499 (sem push).
- 2026-10-18: M2 do layout (login e dashboard) e correção da corrida do login nos testes E2E (`LoginPage.login` espera a navegação pós-login). `test:targeted` 531/531, E2E 208/208 em 2 de 3 rodadas. Sem commit.
