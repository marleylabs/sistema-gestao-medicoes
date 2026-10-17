---
atualizado: 2026-10-17
status: em andamento (T1 e T2 feitas no banco de teste)
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

- [ ] **T3: fornecedor novo nasce com P0**
  - Aceite:
    - No upsert administrativo (`resolveFornecedorIdentity`/`upsertCadastroFornecedor`), o ramo CREATE gera o P0 antes e o usa como `colaboradorCodigo`, `Profissional.codigo` e `usuario`.
    - Reativação e `RECREATE_FROM_HISTORY` mantêm o código histórico.
    - O usuário existente é achado por `usuario = colaboradorCodigo`, não por nome.
    - O cadastro manual (`fornecedores/manual`) segue a mesma regra.
  - Verificar:
    - teste em `tests/cadastro-fornecedor-identity.test.ts`: novo fornecedor com código = login; homônimo novo ganha outro P0 e não reusa o usuário do primeiro;
    - `e2e/administrativo-novo-fornecedor.spec.ts`.
  - Arquivos: `lib/cadastro-fornecedor.ts`, a rota `manual` se precisar, os testes.

- [ ] **T4: fim da busca por nome**
  - Aceite:
    - `selectCadastroForAuthenticatedUser` (só pelo código), `getColaboradorEscopo` e `validateFornecedorForNfUpload` deixam de buscar cadastro por `responsavel = nome`.
    - A inativação (`usuariosPorNome`), a exclusão definitiva (busca do usuário e checagem de cadastro legado) e a edição do cadastro (`fornecedores/[id]`) acham o usuário pelo código.
    - Decisão 011 mantida: a edição continua renomeando o usuário, agora achado pelo código.
  - Verificar:
    - regressão "homônimo novo": A em P0 e B criado com o mesmo `responsavel`; A mantém escopo, cadastro e NF (falha antes);
    - inativação e exclusão não atingem o homônimo;
    - `tests/cadastro-identity.test.ts`, `tests/colaborador-alias.test.ts`, `tests/inativacao-identidade.test.ts` e `tests/portal-fornecedor.test.ts` ajustados e verdes;
    - `tsc` e `test:targeted`.
  - Arquivos: `lib/cadastro-identity.ts`, `lib/colaborador-alias.ts`, `lib/cadastro-fornecedor.ts`, `app/api/admin/administrativo/fornecedores/[id]/route.ts`, os testes.

- [ ] **T5: seed e E2E**
  - Aceite:
    - `scripts/seed-e2e.ts` cria os fornecedores com código = login.
    - `e2e/isolamento-homonimos.spec.ts` ampliado: A e B homônimos, cada um com P0, veem só os próprios dados; GET direto ao comprovante e à NF do outro dá 403/404.
    - `e2e/importacao-identidades.spec.ts`: planilha por nome cai no P0 certo.
  - Verificar: `npm run test:e2e:seed` e o E2E completo verde (hoje 206/206).
  - Arquivos: `scripts/seed-e2e.ts`, specs E2E.

- [ ] **T6: ensaio local com dados reais, pré-produção e fechamento**
  - Aceite:
    0. Ensaio: restaurar um backup da pré-produção numa base **local** e rodar nela o dry-run, o `--aplicar` e a medição. Conflitos encontrados são resolvidos com o Administrativo antes de seguir.

    Depois, na pré-produção e então na produção (passos do usuário, com segredos):
    1. backup;
    2. dry-run;
    3. janela sem importação;
    4. `--aplicar`;
    5. medição com 55 migrados, 0 conflitos e contagens iguais;
    6. deploy da imagem com T3 e T4 logo em seguida.

    Fechamento: notas atualizadas (portal, autenticação, cadastro, identidades, glossário com P0, revisão da 011, pendências sem a P2, status); spec e plano como concluídos.
  - Verificar: `tsc`, `test:targeted`, `pytest etl/` e E2E verdes; `/review` e `/ponytail-review` antes do merge (CLAUDE.md).
  - Arquivos: notas do cérebro; runbook do passo a passo na pré-produção (em `docs/`).

## Pontos de verificação
- No ensaio local da T6: contagens do dry-run com os dados reais. Com `CONFLITO` ou `SEM_IDENTIDADE`, resolvemos esses casos com o Administrativo antes de tocar o servidor.
- Depois de T2: a medição no banco de teste mostra os mesmos dados visíveis antes e depois.
- Depois de T4: `test:targeted` verde e nenhuma busca de usuário ou cadastro por nome (grep).
- Antes de T6: E2E completo verde.
