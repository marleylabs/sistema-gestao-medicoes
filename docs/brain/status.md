---
atualizado: 2026-10-21
---
# Status

## Em andamento
- **Timesheet ATO**: implementado e enviado ao GitHub em 2026-10-21 (código e94c195; cérebro nos commits seguintes). Ver [spec](specs/timesheet-ato.md), [plano](specs/timesheet-ato-plano.md) e [módulo](modulos/timesheet.md). O fornecedor ATO preenche a folha 21→20 no portal; a medição acompanha, libera o preenchimento, reabre, cadastra feriados estaduais e municipais, configura o cabeçalho e exporta em XLSX ou PDF.
  - As migrations `20261022010132_timesheet_ato` e `20261022021306_timesheet_audit_index` só criam tabelas e um índice.
  - Aplicadas no banco de teste `medicoes_e2e_bm` e no Docker de desenvolvimento (porta 3000). **A produção ainda não tem.**
  - No DEV, nenhum dos 63 Profissionais ativos tem `status_colaborador = 'ATO'`: ninguém vê a aba até a medição habilitar o fornecedor.
  - Última verificação: `tsc` ok, `test:targeted` 586/586, E2E completo 223/223.
- **Produção** (`192.168.15.101:3020`, `/opt/sistema-gestao-medicoes`; [decisão 013](decisoes/013-servidor-unico-e-producao.md)): roda d78535d desde 2026-10-19 11:00 (UTC). Tem layout M1 a M4, P2 (P0 como único ID), as correções de 2026-10-19 e a correção do chat duplicado; o Timesheet ATO ainda não está lá. O alias SSH depende do notebook: `medicoes-preprod` num, `medicoes-prod` (só pela VPN) no outro.
  - Rollback: imagem `local/medicoes-web-rollback:20261019T105612Z` + `~/backups-medicoes/deploy_20261019T105612Z/` no servidor (dump com sha256, commit anterior e resultado da mesclagem do chat). O anterior (2c3862c) é `:20261019T014421Z` + `deploy_20261019T014421Z/`.
  - Ficou lá um fornecedor de teste do smoke da P0, com medição. O volume antigo `projetocrud-medio_postgres_data` não é usado (o banco está no `_v2`); avaliar a remoção fora de janela, com backup.
- **Concluídos e na produção**: layout M1 a M4 ([spec](specs/layout-tema-motion.md)), a P2 ([spec](specs/p2-vinculo-login-profissional.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md)) e o chat sem conversa duplicada entre fornecedor e equipe (d78535d; todo caminho de criação reusa `findFornecedorConversa`). As duplicatas antigas foram mescladas por `scripts/mesclar-chat-duplicado.ts`: só uma, a do RONALD (P0697780). Ver [chat](modulos/chat.md).
- **Branches**: integração em `release/2026-10-02-import-identities` (e `layout2.0`, parada em 58375bb). A `main` está mais de 85 commits atrás e nunca é base.
- **Ambiente noutra máquina**: ver [ambiente](ambiente.md).

## Próximos passos
1. **Timesheet na produção** (só com pedido do usuário):
   - `pg_dump` e imagens de rollback;
   - `migrate deploy` das duas migrations novas e rebuild do web;
   - conferir quantos fornecedores têm status ATO e combinar com a medição quem habilitar.
2. **Timesheet, fase 2** (fora do escopo atual):
   - envio ao gestor do contrato e registro da aprovação pela plataforma;
   - lançamento do total de horas na medição/BM;
   - aviso quando um feriado é excluído depois do envio;
   - folha reaberta de ciclo passado alcançável pelo fornecedor.
3. Criar rotina de backup automática (hoje só há `pg_dump` manual nos runbooks).
4. Definir o fluxo manual para corrigir valores de BM aprovado ou pago (a planilha só reporta a divergência).
5. Produção, já autorizado: limpar `senha_temporaria` antiga (`UPDATE usuarios SET senha_temporaria = NULL`) e rodar `diagnose_identities.py` na planilha real.
6. Atualizar `docker-compose.prod.yml` para o Resend, `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`.
7. Revisar `docs/plano-pre-deploy-producao.md` §7: quase tudo foi feito na P2; marcar o que resta (validação do Cristiano pela área de negócio) e arquivar.

## Bloqueios
- `npm run lint` não roda (não há `eslint.config.*`). Use `npx tsc --noEmit`.
- `pytest etl/` precisa de `DATA_ENCRYPTION_KEY` (32 bytes em Base64); o `.env.test` não tem. Use uma chave aleatória só para o teste. Não exporte essa chave para o `test:targeted`: ali o Prisma carrega a chave real do `.env`, e uma chave diferente quebra a decifragem dos dados do banco de teste.
- E2E: rode sempre `npm run test:e2e:seed` antes. Sem ele, sobras da rodada anterior quebram specs do Administrativo.
- Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` apontando para um banco de teste migrado (ou carregue o `.env.test`). Os testes de banco usam `lib/prisma-test.ts` e abortam sem essas variáveis.
- O banco `medicoes_e2e` está sem as migrations de 2026-09-28 em diante; use `medicoes_e2e_bm`. Um banco de teste novo precisa de `prisma migrate deploy` e de `npm run test:e2e:seed`; sem o seed, `tests/identidade-importacao.test.ts` falha (ver [pendências](pendencias.md)).

## Cuidados operacionais
- `next dev` reescreve `tsconfig.json` (acrescenta `.next/dev/dev/types`): reverta com `git checkout -- tsconfig.json` antes de commitar. Para ver o app contra o banco de teste, use `.claude/launch.json` (`dev-banco-teste`, porta 3100), que carrega o `.env.test`.
- Banco DEV local (`medicoes`, Docker na porta 3000): migrado em 2026-10-18 (baseline + `migrate deploy`, 8/8, `migrate diff` = 0; backup em `~/backups-medicoes/dev_20261018T212154Z/`; imagens `local/medicoes-{web,etl}-rollback:20261018T212154Z`). Web e etl reconstruídos com o código de f856767; web reconstruído de novo em 2026-10-19 com 2c3862c (mesmo código da produção; rollback `local/medicoes-web-rollback:20261019T014258Z`, antes `:20261019T004641Z`, `:20261019T003403Z` e `:20261019T002350Z`). Web reconstruído de novo em 2026-10-22 (UTC) com 0641bd8 (Timesheet ATO), depois de `migrate deploy` das duas migrations novas (10/10, `migrate diff` = 0); backup antes em `~/backups-medicoes/dev_20261022T023013Z/` e rollback `local/medicoes-web-rollback:20261022T023013Z`. O etl não mudou desde f856767. Migração de códigos P0 aplicada nele em 2026-10-18 (1/1 migrado, `--medir` 1 ok; ADMIN de auditoria P0000001; backup antes em `~/backups-medicoes/dev_p0_20261018T212902Z/`, com os JSONs de aplicar e medir). O container `medicoes-web-layout` (porta 3200, banco de teste) fica fora do compose.
- Nunca usar `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.
- `npm run build` e o Playwright compartilham `.next`: rode `rm -rf .next` depois do build.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-21: Timesheet ATO implementado (fases A a D, commit e94c195, enviado ao GitHub; produção pendente). O fornecedor ATO preenche a folha 21→20 no portal; a medição acompanha, libera o preenchimento, reabre, cadastra feriados estaduais e municipais, configura o cabeçalho e exporta em XLSX ou PDF. Ver [módulo](modulos/timesheet.md).
- 2026-10-19: chat duplicado corrigido (d78535d), implantado na produção e duplicata existente mesclada (ver Produção).
- 2026-10-19: o usuário confirmou que o servidor `192.168.15.101:3020`, chamado até aqui de pré-produção, é a produção ([decisão 013](decisoes/013-servidor-unico-e-producao.md)). Com isso, a P2 (T6) fica concluída na produção desde 2026-10-18 (UTC). Atualizados: status, plano e spec da P2, decisão 012, portal do fornecedor, pendências (P2 removida) e índice. As notas antigas mantêm o termo "pré-produção" como registro.
- 2026-10-19: lacunas do review tratadas. `Modal` compartilhado (`components/ui.tsx`): o foco entra no diálogo, o Tab circula só nele (só o modal do topo prende) e volta ao elemento anterior ao fechar; o fundo continua sem `inert`, só `aria-modal`. No celular, Esc com um diálogo aberto não fecha mais a gaveta (`components/app-shell.tsx`). Troca do e-mail de acesso pela edição do cadastro: auditada (`EMAIL_ACESSO_ALTERADO`, sem os endereços) e com aviso na tela quando não chega ao acesso. Testes: `tests/fornecedor-sem-busca-por-nome.test.ts` e `e2e/conta-modal.spec.ts`. E2E completo 216/216, `test:targeted` 545/545.
- 2026-10-19: `/review` e `/ponytail-review` de 27a9c9c..63ff4ed feitos. Corrigido: o e-mail do cadastro só vai para o usuário achado pelo login (o achado pelo nome pode ser homônimo de outro fornecedor; teste em `tests/fornecedor-sem-busca-por-nome.test.ts`); o corpo das listas de Administrativo, Histórico e Evidências volta a ser recortado nos cantos (só a barra do popover fica sem recorte); cortes de excesso. As lacunas anteriores apontadas foram tratadas logo depois (entrada acima). E2E das telas tocadas 60/60, `test:targeted` 544/544.
