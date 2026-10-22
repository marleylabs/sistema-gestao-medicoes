---
atualizado: 2026-10-22
---
# Status

## Em andamento
- **Timesheet ATO**: na produção desde 2026-10-22 02:55 (UTC), com bf53ea0. Ver [spec](specs/timesheet-ato.md), [plano](specs/timesheet-ato-plano.md) e [módulo](modulos/timesheet.md). O fornecedor ATO preenche a folha 21→20 no portal; a medição acompanha, libera o preenchimento, reabre, cadastra feriados estaduais e municipais, configura o cabeçalho e exporta em XLSX ou PDF.
  - Migrations `20261022010132_timesheet_ato` e `20261022021306_timesheet_audit_index` (só criam tabelas e um índice) aplicadas na produção (10/10), no DEV e no banco de teste.
  - **Na produção, nenhum dos 62 Profissionais ativos tem `status_colaborador = 'ATO'`** (no DEV, 0 de 63). Ninguém vê a aba até a medição habilitar cada fornecedor em Timesheet → "Habilitar fornecedor".
  - Verificação antes do push: `tsc` ok, `test:targeted` 589/589 (com a correção do chat mesclada), E2E completo 223/223 (antes da mesclagem). Smoke funcional na produção: ainda não feito pelo usuário.
- **Timesheet, feriados por contrato** (2026-10-22, enviado ao GitHub, não implantado): o feriado manual pode ser geral ou de um contrato, e a aba Feriados filtra por contrato. Ver [spec](specs/timesheet-feriados-por-contrato.md). Migration nova `20261022180000_timesheet_feriado_contrato` (só acrescenta coluna e índices; os feriados atuais ficam gerais), aplicada só no banco de teste `medicoes_e2e_bm`. Verificação: `tsc` ok, `test:targeted` 590/590, E2E das duas specs do timesheet 8/8.
- **Produção** (`192.168.15.101:3020`, `/opt/sistema-gestao-medicoes`; [decisão 013](decisoes/013-servidor-unico-e-producao.md)): roda bf53ea0 desde 2026-10-22 02:55 (UTC). Só o web foi recriado; o ETL e o Postgres ficaram intactos (o ETL não muda desde f856767). Inclui layout M1 a M4, P2, as correções de 2026-10-19, o chat sem duplicata e o Timesheet ATO. O alias SSH depende do notebook: `medicoes-preprod` num, `medicoes-prod` (só pela VPN) no outro. O servidor também hospeda outros sistemas (extrato-mensal, projeto-raio, projeta-hub): recrie só os serviços do medicoes.
  - Health 200, login 200, API do timesheet 401 sem sessão, 0 linhas de erro no log do web.
  - Rollback: imagem `local/medicoes-web-rollback:20261022T025047Z` + `~/backups-medicoes/deploy_20261022T025047Z/` (`postgres.dump` com sha256 e listagem de 22 tabelas, `deploy.env` com o SHA anterior d78535d, `build.log`, `migrate.log`, `web.log`). As tabelas novas não atrapalham a imagem anterior, então o rollback do web dispensa desfazer a migration.
  - Rollbacks anteriores: d78535d → `:20261019T105612Z`; 2c3862c → `:20261019T014421Z`.
  - Ficou lá um fornecedor de teste do smoke da P0, com medição. O volume antigo `projetocrud-medio_postgres_data` não é usado (o banco está no `_v2`); avaliar a remoção fora de janela, com backup.
- **Concluídos e na produção**: layout M1 a M4 ([spec](specs/layout-tema-motion.md)), a P2 ([spec](specs/p2-vinculo-login-profissional.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md)) e o chat sem conversa duplicada entre fornecedor e equipe (d78535d; todo caminho de criação reusa `findFornecedorConversa`). As duplicatas antigas foram mescladas por `scripts/mesclar-chat-duplicado.ts`: só uma, a do RONALD (P0697780). Ver [chat](modulos/chat.md).
- **Branches**: integração em `release/2026-10-02-import-identities` (e `layout2.0`, parada em 58375bb). A `main` está mais de 85 commits atrás e nunca é base.
- **Ambiente noutra máquina**: ver [ambiente](ambiente.md).

## Próximos passos
1. **Timesheet na produção** (implantado em 2026-10-22):
   - smoke funcional pelo usuário;
   - a medição habilita os fornecedores ATO (hoje nenhum tem o status pela importação) e configura o cabeçalho de cada um.
2. **Feriados por contrato**: deploy (web + `migrate deploy`, com backup antes, como no deploy de bf53ea0). Depois, a medição define o contrato de cada fornecedor ATO na configuração; sem isso ele só recebe os feriados gerais.
3. **Timesheet, fase 2** (fora do escopo atual):
   - envio ao gestor do contrato e registro da aprovação pela plataforma;
   - lançamento do total de horas na medição/BM;
   - aviso quando um feriado é excluído depois do envio;
   - folha reaberta de ciclo passado alcançável pelo fornecedor.
4. Criar rotina de backup automática (hoje só há `pg_dump` manual nos runbooks).
5. Definir o fluxo manual para corrigir valores de BM aprovado ou pago (a planilha só reporta a divergência).
6. Produção, já autorizado: limpar `senha_temporaria` antiga (`UPDATE usuarios SET senha_temporaria = NULL`) e rodar `diagnose_identities.py` na planilha real.
7. Atualizar `docker-compose.prod.yml` para o Resend, `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`.
8. Revisar `docs/plano-pre-deploy-producao.md` §7: quase tudo foi feito na P2; marcar o que resta (validação do Cristiano pela área de negócio) e arquivar.

## Bloqueios
- `npm run lint` não roda (não há `eslint.config.*`). Use `npx tsc --noEmit`.
- `pytest etl/` precisa de `DATA_ENCRYPTION_KEY` (32 bytes em Base64); o `.env.test` não tem. Use uma chave aleatória só para o teste. Não exporte essa chave para o `test:targeted`: ali o Prisma carrega a chave real do `.env`, e uma chave diferente quebra a decifragem dos dados do banco de teste.
- E2E: rode sempre `npm run test:e2e:seed` antes. Sem ele, sobras da rodada anterior quebram specs do Administrativo.
- Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` apontando para um banco de teste migrado (ou carregue o `.env.test`). Os testes de banco usam `lib/prisma-test.ts` e abortam sem essas variáveis.
- O banco `medicoes_e2e` está sem as migrations de 2026-09-28 em diante; use `medicoes_e2e_bm`. Um banco de teste novo precisa de `prisma migrate deploy` e de `npm run test:e2e:seed`; sem o seed, `tests/identidade-importacao.test.ts` falha (ver [pendências](pendencias.md)).

## Cuidados operacionais
- `next dev` reescreve `tsconfig.json` (acrescenta `.next/dev/dev/types`): reverta com `git checkout -- tsconfig.json` antes de commitar. Para ver o app contra o banco de teste, use `.claude/launch.json` (`dev-banco-teste`, porta 3100), que carrega o `.env.test`.
- Banco DEV local (`medicoes`, Docker na porta 3000): migrado em 2026-10-18 (baseline + `migrate deploy`, 8/8, `migrate diff` = 0; backup em `~/backups-medicoes/dev_20261018T212154Z/`; imagens `local/medicoes-{web,etl}-rollback:20261018T212154Z`). Web e etl reconstruídos com o código de f856767; web reconstruído de novo em 2026-10-19 com 2c3862c (mesmo código da produção; rollback `local/medicoes-web-rollback:20261019T014258Z`, antes `:20261019T004641Z`, `:20261019T003403Z` e `:20261019T002350Z`). Web reconstruído em 2026-10-22 (UTC) com 0641bd8 (Timesheet ATO) e de novo com bf53ea0 (rollback `local/medicoes-web-rollback:20261022T024742Z`, backup `~/backups-medicoes/dev_20261022T024742Z/`), depois de `migrate deploy` das duas migrations novas (10/10, `migrate diff` = 0); backup antes em `~/backups-medicoes/dev_20261022T023013Z/` e rollback `local/medicoes-web-rollback:20261022T023013Z`. O etl não mudou desde f856767. Migração de códigos P0 aplicada nele em 2026-10-18 (1/1 migrado, `--medir` 1 ok; ADMIN de auditoria P0000001; backup antes em `~/backups-medicoes/dev_p0_20261018T212902Z/`, com os JSONs de aplicar e medir). O container `medicoes-web-layout` (porta 3200, banco de teste) fica fora do compose.
- Nunca usar `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.
- Ao rodar um script remoto com `ssh host 'bash -s' < script`, um `docker exec`/`docker compose exec` sem `</dev/null` consome o resto do script pela entrada, e as linhas seguintes não rodam (aconteceu no deploy de 2026-10-22, sem dano). Copie o script com `scp` e rode como arquivo, ou redirecione `</dev/null` em todo `docker`.
- `npm run build` e o Playwright compartilham `.next`: rode `rm -rf .next` depois do build.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-22: feriados do timesheet por contrato (geral ou de um contrato, filtro na aba Feriados), com migration nova; enviado ao GitHub, não implantado.
- 2026-10-22 (UTC): deploy de bf53ea0 na produção (Timesheet ATO + 2 migrations), com backup e rollback; DEV reconstruído com o mesmo commit.
- 2026-10-21: Timesheet ATO implementado (fases A a D, commit e94c195, enviado ao GitHub; produção pendente). O fornecedor ATO preenche a folha 21→20 no portal; a medição acompanha, libera o preenchimento, reabre, cadastra feriados estaduais e municipais, configura o cabeçalho e exporta em XLSX ou PDF. Ver [módulo](modulos/timesheet.md).
- 2026-10-19: chat duplicado corrigido (d78535d), implantado na produção e duplicata existente mesclada (ver Produção).
- 2026-10-19: o usuário confirmou que o servidor `192.168.15.101:3020`, chamado até aqui de pré-produção, é a produção ([decisão 013](decisoes/013-servidor-unico-e-producao.md)). Com isso, a P2 (T6) fica concluída na produção desde 2026-10-18 (UTC). Atualizados: status, plano e spec da P2, decisão 012, portal do fornecedor, pendências (P2 removida) e índice. As notas antigas mantêm o termo "pré-produção" como registro.
