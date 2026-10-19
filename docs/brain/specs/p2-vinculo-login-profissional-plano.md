---
atualizado: 2026-10-17
status: em andamento (T1 a T5 feitas; T6 concluída na pré-produção; falta a produção)
tags: [spec, plano]
---
# Plano: P0 como único ID do fornecedor

Spec: [p2-vinculo-login-profissional](p2-vinculo-login-profissional.md). Decisão: [012](../decisoes/012-p0-como-id-do-fornecedor.md).

## Componentes e ordem
1. **Inventário + dry-run** (só leitura): confirma onde o código está gravado e quantos fornecedores migram.
2. **Migração de dados** (`--aplicar`) no banco de teste, com testes.
3. **Fornecedor novo nasce com P0** (upsert administrativo).
4. **Fim da busca por nome** nos pontos do inventário da spec.
5. **Seed e E2E**.
6. **Ensaio com dados reais em base local** (restauração de um backup da pré-produção), depois **pré-produção e produção** e fechamento.

**Ordem combinada em 2026-10-17:** tudo é feito e testado no ambiente local (T2 a T5) antes de qualquer ambiente real. O dry-run com os dados reais roda primeiro numa cópia local do backup da pré-produção; o servidor só é tocado na T6, uma vez, com tudo pronto.

A ordem é sequencial:
- T2 usa a classificação de T1.
- T4 só pode tirar o fallback por nome depois que T2 garante que os dados de teste estão em P0.
- T3 e T4 mexem no mesmo arquivo (`lib/cadastro-fornecedor.ts`).

Nenhum passo vale rodar em paralelo.

## Riscos
- **Coluna esquecida:** um código antigo que sobra em alguma tabela some do portal. Mitigação:
  - T1 confere o schema, o SQL cru do app e o ETL;
  - a medição de T6 compara as contagens visíveis por fornecedor antes e depois.
- **Importação durante a migração** grava o código antigo depois da troca. Mitigação: janela sem importação; o script recusa rodar com importação em andamento, se houver como detectar.
- **Colisão:** o P0 de A já é código ou alias de outro Profissional. Mitigação: classificar como `CONFLITO` e não migrar.
- **Profissional com mais de um cadastro ou com mais de um usuário.** Mitigação: `CONFLITO`; caso a caso com o Administrativo.
- **Rollback depois de importação nova.** Mitigação: script reverso pelo `adminAuditLog` só até a primeira importação; depois disso, o backup.
- **`server-only`:** os scripts neutralizam o módulo como `scripts/diagnose-escopo-fornecedor.ts` já faz.

## Tarefas

- [x] **T1: inventário e dry-run (só leitura)**: feita em 2026-10-16.
  - Classificação em `lib/migracao-codigo-p0.ts` (`planejarMigracaoP0`); CLI em `scripts/migrar-codigo-p0.ts`, que recusa `--aplicar` até a T2.
  - Motivos de `CONFLITO`: `LOGIN_EM_USO`, `PROFISSIONAL_COM_VARIOS_LOGINS`, `CADASTRO_MULTIPLO`.
  - `tests/migrar-codigo-p0.test.ts`: 7 testes. `test:targeted` 485/485; `tsc` limpo.
  - No banco de teste: 17 migráveis, 4 já em P0, 29 sem identidade (usuários de teste antigos sem cadastro), 0 conflitos.
  - O dry-run com dados reais ficou para a T6 (ordem combinada em 2026-10-17).
  - Aceite:
    - Lista final das colunas com código do fornecedor (schema, `$queryRaw`/`$executeRaw` em `lib` e `app`, SQL em `etl/`), registrada na spec.
    - `scripts/migrar-codigo-p0.ts` sem flag classifica cada usuário COLABORADOR ativo (`MIGRAVEL`, `JA_E_P0`, `SEM_IDENTIDADE`, `CONFLITO`).
    - Também conta os Profissionais sem login e as linhas por tabela que seriam reescritas.
    - Conexão `READ ONLY` confirmada; a saída tem só contagens e o próprio login.
  - Verificar:
    - teste no banco de teste com A (migrável), B homônimo e um caso de conflito;
    - prova de que nada foi gravado.
  - Arquivos: `scripts/migrar-codigo-p0.ts` (novo), `tests/migrar-codigo-p0.test.ts` (novo).

- [x] **T2: aplicar a migração (banco de teste)**: feita em 2026-10-17.
  - `aplicarMigracaoP0`, `medirMigracaoP0` e `reverterMigracaoP0` em `lib/migracao-codigo-p0.ts`; CLI com `--aplicar`, `--medir`, `--reverter` e `--login=` (o ADMIN da auditoria vem de `MIGRACAO_P0_ADMIN`).
  - Novo motivo de conflito `ALIAS_EM_USO`: o código antigo já é alias de outro Profissional, e a planilha ficaria ambígua depois da troca.
  - Cada fornecedor migra numa transação com `FOR UPDATE` no Profissional. Se o código mudou desde o planejamento, ele é pulado. A falha é reportada só pelo código do erro, sem a mensagem do Postgres.
  - A medição confere: login resolve pelo código, escopo e cadastro únicos, linhas iguais às migradas e nenhuma sobra do código antigo.
  - A reversão devolve o código nulo do Profissional legado. Linhas que tinham caixa ou espaço diferente voltam com o código antigo exato.
  - ETL: sem mudança. A reimportação apaga as linhas do mapa do Profissional pelo código e pelo nome e regrava, então o `source_row_hash` novo não duplica. Teste novo em `etl/test_operational_identity.py`.
  - `tests/migrar-codigo-p0.test.ts`: 15 testes. `test:targeted` 493/493; `pytest etl/` 44/44; `tsc` limpo.
  - Aceite: `--aplicar` faz, em uma transação por fornecedor `MIGRAVEL`:
    - cria o alias do código antigo (`MIGRACAO_P0`);
    - troca `profissionais.codigo` e as colunas do inventário (sem `admin_audit_logs`);
    - grava `adminAuditLog` `FORNECEDOR_CODIGO_P0` com o código antigo e o novo.

    Além disso:
    - BM aprovado ou pago mantém valores e status;
    - rodar de novo não muda nada;
    - `CONFLITO` não é tocado;
    - existe o modo de medição (login resolve, cadastro pelo código, contagens visíveis iguais antes e depois) e o script reverso por auditoria.
  - Verificar:
    - testes de integração, que falham antes;
    - o resolver TS (`lib/profissional-identidade.ts`) leva o nome e o código antigo ao P0;
    - `pytest etl/`: planilha com o nome antigo resolve para o P0.
  - Arquivos: `scripts/migrar-codigo-p0.ts`, `tests/migrar-codigo-p0.test.ts`, um teste novo em `etl/` (planilha com nome → P0).
  - `adminAuditLog` exige administrador: o script pede o login de um ADMIN ativo (`MIGRACAO_P0_ADMIN`).

- [x] **T3: fornecedor novo nasce com P0**: feita em 2026-10-17.
  - Troca de código extraída para `lib/codigo-p0.ts` (`trocarCodigoParaP0`, `gerarP0Livre`), usada pela migração e pelo upsert.
  - CREATE: P0 gerado antes, nome do responsável como alias `CADASTRO`, usuário nunca reaproveitado pelo nome. "Nenhuma dessas identidades" não é mais recusada por colisão de nome.
  - Reativação e `RECREATE_FROM_HISTORY` de identidade antiga: o código passa para o P0 do login (o aceite abaixo dizia "mantêm o código histórico"; isso deixaria login e código diferentes, e a T4 cortaria o acesso).
  - Usuário pelo nome só para identidade de antes do P0, e nunca o de outro fornecedor já em P0.
  - `tests/fornecedor-novo-p0.test.ts` (5 testes, todos falhavam antes). `scripts/test-exclusao-services.ts` ajustado à regra nova; a limpeza dele agora também apaga os usuários que criava.
  - `test:targeted` 498/498; `tsc` limpo.
  - E2E: o cenário K de `e2e/administrativo-fornecedor-dedupe.spec.ts` foi ajustado à regra nova (cada homônimo com o próprio P0). As limpezas do `scripts/seed-e2e.ts` agora também acham o Profissional pelo `nome` e apagam BM e mapa pelo código atual. Os 6 specs de fornecedor, isolamento incluído, passaram 46/46 em duas rodadas seguidas.
  - Aceite:
    - No upsert administrativo (`resolveFornecedorIdentity`/`upsertCadastroFornecedor`), o ramo CREATE gera o P0 antes e o usa como `colaboradorCodigo`, `Profissional.codigo` e `usuario`.
    - Reativação e `RECREATE_FROM_HISTORY` mantêm o código histórico.
    - O usuário existente é achado por `usuario = colaboradorCodigo`, não por nome.
    - O cadastro manual (`fornecedores/manual`) segue a mesma regra (ele chama o mesmo upsert).
  - Verificar:
    - teste em `tests/cadastro-fornecedor-identity.test.ts`: novo fornecedor com código = login; homônimo novo ganha outro P0 e não reusa o usuário do primeiro;
    - `e2e/administrativo-novo-fornecedor.spec.ts`.
  - Arquivos: `lib/cadastro-fornecedor.ts`, a rota `manual` se precisar, os testes.

- [x] **T4: fim da busca por nome**: feita em 2026-10-17.
  - Escopo do portal, NF, listagem do Administrativo, primeiro acesso em lote, resumo de candidatos e relatório de inconsistências acham usuário e cadastro só pelo código (= login).
  - `usuariosDoFornecedor` (`lib/codigo-p0.ts`) é a regra única de "usuário do fornecedor". É usada por inativação, exclusão definitiva, edição (`sincronizarUsuarioDoFornecedor`) e upsert. Ela busca pelo login; só para identidade de antes do P0 cai no nome, e nunca no usuário de outro fornecedor já em P0.
  - A migração deixou de usar o escopo do portal e lê a cadeia antiga por nome por conta própria (`profissionalAntesDoP0`). É o único lugar que precisa dela. A migração agora inclui os fornecedores **inativos**, não só os ativos: ao serem reativados, já estão em P0.
  - Ficou de propósito: a trava da exclusão definitiva que recusa excluir cadastro antigo **sem código** quando há Profissional ou usuário com o mesmo nome. Ela só bloqueia; não liga nem expõe nada.
  - Testes: `tests/fornecedor-sem-busca-por-nome.test.ts` (6, todos falhavam antes). Ajustados à regra nova: `tests/cadastro-identity.test.ts`, as fixtures de `tests/colaborador-alias.test.ts` (código = login) e o `select` fixado em `tests/temporary-password-security.test.ts`. `test:targeted` 506/506; `tsc` limpo.
  - E2E: fixtures com código = login em `e2e/isolamento-homonimos.spec.ts`, `e2e/administrativo-primeiro-acesso-lote.spec.ts` e `e2e/seguranca-senha-temporaria.spec.ts`. O `scripts/seed-e2e.ts` ganhou `limparFornecedorPorPrefixo`, que apaga BM e mapa também pelos códigos atuais (P0); antes, sobras de uma rodada quebravam a seguinte.
  - E2E completo 206/206 depois do seed. Rodando duas vezes seguidas, só `e2e/financeiro-redesign.spec.ts` (DETALHE) falha na segunda rodada. É um problema anterior, sem relação com o P0: o spec usa `prisma.projeto.findFirstOrThrow()` (um projeto qualquer do banco). Corrigido em 2026-10-17: o spec cria o próprio projeto, porque um projeto chamado "DESCONTO" fazia todo documento virar desconto (`isDocumentoDesconto` em `lib/boletim-calculo.ts`). E2E completo 206/206 em duas rodadas seguidas.
  - Aceite:
    - `selectCadastroForAuthenticatedUser` (só pelo código), `getColaboradorEscopo` e `validateFornecedorForNfUpload` deixam de buscar cadastro por `responsavel = nome`.
    - A inativação (`usuariosPorNome`), a exclusão definitiva (busca do usuário e checagem de cadastro legado) e a edição do cadastro (`fornecedores/[id]`) acham o usuário pelo código.
    - A listagem do Administrativo (`findColaboradorUsuarios` em `lib/cadastro-fornecedor.ts`) também liga cadastro e usuário pelo nome: passa para o código. Achado na T3.
    - Decisão 011 mantida: a edição continua renomeando o usuário, agora achado pelo código.
  - Verificar:
    - regressão "homônimo novo": A em P0 e B criado com o mesmo `responsavel`; A mantém escopo, cadastro e NF (falha antes);
    - inativação e exclusão não atingem o homônimo;
    - `tests/cadastro-identity.test.ts`, `tests/colaborador-alias.test.ts`, `tests/inativacao-identidade.test.ts` e `tests/portal-fornecedor.test.ts` ajustados e verdes;
    - `tsc` e `test:targeted`.
  - Arquivos: `lib/cadastro-identity.ts`, `lib/colaborador-alias.ts`, `lib/cadastro-fornecedor.ts`, `app/api/admin/administrativo/fornecedores/[id]/route.ts`, os testes.

- [x] **T5: seed e E2E**: feita em 2026-10-17.
  - O seed já usava código = login nos fornecedores A–D. A limpeza por prefixo (`limparFornecedorPorPrefixo`) entrou na T4.
  - `e2e/isolamento-homonimos.spec.ts`: novo caso. O Administrativo renomeia B com o **mesmo nome** de A; os dois usuários ficam homônimos e cada um vê só o próprio BM e cadastro. O comprovante de B continua 403 para A e 200 para B.
  - `e2e/importacao-identidades.spec.ts`: o fornecedor `RESOLVIDO` passa a estar no P0 (código = P0, nome como alias `CADASTRO`). Com o ETL real, a linha da planilha que traz o nome cai no Profissional do P0, e o mapa grava o P0, nunca o nome.
  - E2E completo 207/207 em duas rodadas seguidas, com seed antes de cada uma.
  - Aceite:
    - `scripts/seed-e2e.ts` cria os fornecedores com código = login.
    - `e2e/isolamento-homonimos.spec.ts` ampliado: A e B homônimos, cada um com P0, veem só os próprios dados; GET direto ao comprovante e à NF do outro dá 403/404.
    - `e2e/importacao-identidades.spec.ts`: planilha por nome cai no P0 certo.
  - Verificar: `npm run test:e2e:seed` e o E2E completo verde (hoje 206/206).
  - Arquivos: `scripts/seed-e2e.ts`, specs E2E.

- [ ] **T6: ensaio local com dados reais, pré-produção e fechamento**
  - Aceite:
    0. Ensaio: restaurar um backup da pré-produção numa base **local** e rodar nela o dry-run, o `--aplicar` e a medição. Conflitos encontrados são resolvidos com o Administrativo antes de seguir.
       - 2026-10-17: backup da pré-produção (`pg_dump`, 2026-10-18T01:00Z) restaurado na base local `medicoes_ensaio_p0`. Ela tem as mesmas 8 migrations do projeto, 55 fornecedores com login, 61 Profissionais e 55 cadastros.
       - **Dry-run: 55/55 migráveis, 0 conflitos, 0 sem identidade.**
       - Linhas a reescrever: 55 cadastros, 7 BMs, 62 divergências, 36 linhas do mapa, 8 do BM auxiliar e 91 logs.
       - 6 Profissionais sem login, todos sem código; ficam como estão (decisão 2).
       - `--aplicar` (auditoria por P0000001): 55 migrados, 0 falhas.
       - `--medir`: 55/55 ok. Um novo dry-run mostra os 55 como `JA_E_P0`, ou seja, rodar de novo não muda nada.
       - SQL direto: 55 aliases `MIGRACAO_P0`, 55 logins = código, 55 cadastros ligados pelo login, 0 BMs sem Profissional pelo código, 55 auditorias.
       - O mesmo dump restaurado intacto em `medicoes_ensaio_p0_original` e comparado com a cópia migrada: contagens, totais (mapa, BM auxiliar, medições, cadastros, divergências) e status dos BMs **idênticos**. Só os códigos mudaram.
       - `--reverter` (P0000001) na cópia migrada: 55 revertidos, 0 falhas; depois dele, `--medir` não acha nenhuma migração em vigor. A comparação por hash, linha a linha, com `medicoes_ensaio_p0_original` deu **idêntico** em Profissionais (código, nome, nome completo), aliases, cadastros, BMs, divergências, mapa, BM auxiliar, logs e usuários. Só sobram as 110 linhas de auditoria (55 da migração e 55 da reversão). A reversão vale como rollback até a primeira importação depois da migração.
       - As duas bases do ensaio ficam no Postgres local até o fim da T6. O dump fica fora do repositório, em `C:/Users/Anderson Marley/backups-medicoes/`.

    Pré-produção: **feita em 2026-10-18 (UTC)** pelo [runbook](../../runbook-p0-pre-producao.md), executado pelo usuário e conferido passo a passo.
       - Saiu de 7482a2d para 2e1a9a4 (`APPROVED_SHA`). Rollback: imagens `local/medicoes-{web,etl}-rollback:20261018T011856Z` e o dump `medicoes_pre_p0_20261018T011856Z.dump` (22 tabelas), em `~/backups-medicoes/p0_20261018T011856Z/` no servidor, junto com os JSONs e os logs de cada passo.
       - O diff local do `docker-compose.yml` (porta padrão 3020) foi preservado; o compose e os Dockerfiles não mudaram entre os dois SHAs.
       - Dry-run igual ao ensaio: 55/55 `MIGRAVEL`, 0 conflitos, as mesmas linhas a reescrever. `--aplicar` (P0000001): 55 migrados, 0 falhas. `--medir`: 55/55 ok, antes e depois do deploy.
       - Deploy: ETL e web `healthy`, `/api/health` ok, logs sem `P2002`, erro, traceback ou 5xx.
       - Smoke no navegador: o Administrativo mostra os acessos em P0; um fornecedor de teste criado com medição vê só o próprio BM; o Financeiro abre os BMs sem diferença.
       - Não testado: login de um fornecedor real migrado (o smoke usou um fornecedor de teste). O fornecedor de teste e a medição dele ficaram na pré-produção.
       - Rollback daqui em diante: depois da primeira importação, vale o passo 8, item B, do runbook.

    Produção (passos do usuário, com segredos), com novo ensaio local a partir de um backup da produção:
    1. backup;
    2. dry-run;
    3. janela sem importação;
    4. `--aplicar`;
    5. medição com 55 migrados, 0 conflitos e contagens iguais;
    6. deploy da imagem com T3 e T4 logo em seguida.

    Fechamento: notas atualizadas (portal, autenticação, cadastro, identidades, glossário com P0, revisão da 011, pendências sem a P2, status); spec e plano como concluídos.
  - Verificar: `tsc`, `test:targeted`, `pytest etl/` e E2E verdes; `/review` e `/ponytail-review` antes do merge (CLAUDE.md).
  - Arquivos: notas do cérebro; runbook [`docs/runbook-p0-pre-producao.md`](../../runbook-p0-pre-producao.md) (escrito em 2026-10-17). Ele cobre backup, código e imagens, janela sem importação (ETL e web parados), dry-run, aplicar, medir, deploy, smoke e rollback. Os comandos rodam pelo serviço `migrate` do compose, sem digitar senha; a rota foi validada localmente.

## Pontos de verificação
- No ensaio local da T6: contagens do dry-run com os dados reais. Com `CONFLITO` ou `SEM_IDENTIDADE`, resolvemos esses casos com o Administrativo antes de tocar o servidor.
- Depois de T2: a medição no banco de teste mostra os mesmos dados visíveis antes e depois.
- Depois de T4: `test:targeted` verde e nenhuma busca de usuário ou cadastro por nome (grep).
- Antes de T6: E2E completo verde.
