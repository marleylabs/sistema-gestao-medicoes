---
atualizado: 2026-10-17
status: aprovada em 2026-10-16 (v2); T1 a T4 implementadas em 2026-10-17, não implantada
tags: [spec]
---
# Spec: P0 como único ID do fornecedor

## Objetivo
Fazer do P0 (o login do fornecedor, `Usuario.usuario`, gerado por `generateUniqueInternalAccessCode` em `lib/auth.ts`) o único identificador do fornecedor em toda a plataforma. É a primeira P2 de [pendências](../pendencias.md).

**Diretriz do usuário (2026-10-16):** o P0 resolveu os problemas de identificação. O CNPJ não serve como ID porque fornecedores antigos compartilhavam CNPJ. Nenhum outro vínculo (campo extra, alias de login, nome) deve funcionar como código ou ID do fornecedor. A v1 desta spec recomendava `Usuario.profissionalId`; a opção foi descartada por essa diretriz.

**Hoje, o fornecedor tem dois "códigos":**
- o **P0**, no login;
- o `Profissional.codigo`, gravado em todas as tabelas de dados (BM, divergência, mapa, BM auxiliar, logs, cadastro).

Para fornecedor novo, `Profissional.codigo` é o **nome normalizado do responsável** (`resolveFornecedorIdentity` em `lib/cadastro-fornecedor.ts`: `codigoFallback = normalizePersonName(row.responsavel)`). O que liga um ao outro é o nome do usuário igual ao `responsavel` do cadastro (`lib/colaborador-alias.ts`). Por isso:
- um homônimo bloqueia o acesso;
- a [decisão 011](../decisoes/011-nome-do-fornecedor-so-pelo-administrativo.md) proibiu o fornecedor de trocar o próprio nome.

**Proposta:** o P0 passa a ser o `Profissional.codigo` e o `CadastroFornecedor.colaboradorCodigo`, e com isso o código gravado nas tabelas de dados. Login, cadastro e dados ficam com o mesmo valor. A sessão chega à identidade só pelo P0. O nome volta a ser só um rótulo.

**Sucesso:**
- Para cada um dos 55 fornecedores ativos, `login = Profissional.codigo = CadastroFornecedor.colaboradorCodigo` e o código nas tabelas de dados.
- Os 55 continuam vendo exatamente os mesmos dados de antes.
- Nenhuma busca liga usuário e fornecedor por nome.
- As planilhas que trazem o nome continuam sendo importadas.

## Por que funciona com pouco código novo
- `selectCadastroForAuthenticatedUser` (`lib/cadastro-identity.ts`) já tenta primeiro `colaboradorCodigo = login`.
- `getColaboradorEscopo` já resolve o login pelo resolver oficial: com `Profissional.codigo = P0`, o login fica RESOLVIDO.
- O ETL grava nas tabelas o código **canônico** devolvido pelo resolver (`OperationalIdentityResolver.canonical_code` em `etl/ingest_medicoes.py`), não o texto da planilha. Com o código canônico = P0, as importações novas já gravam P0.
- A grafia antiga (nome usado como código) vira `ProfissionalAlias`, e as planilhas com nome continuam resolvendo pelo alias. O resolver segue a [decisão 003](../decisoes/003-identidade-por-codigo-e-alias.md): código → alias → nome legado.

## Onde o código do fornecedor está gravado (precisa virar P0)
| Tabela.coluna | Observação |
|---|---|
| `profissionais.codigo` | Único. Passa a ser o P0. |
| `cadastros_fornecedores.colaborador_codigo` | Fonte do cadastro exibido e da NF. |
| `sgc_aprovacoes_medicao.colaborador_codigo` | BM. Único com `ciclo`; a troca é 1:1, sem colisão. Inclui BM aprovado ou pago: muda só a chave, nunca valores (decisão 3). |
| `divergencias_medicao.colaborador_codigo` | |
| `mapa_pagamento_itens.projetista_codigo` | Linhas com identidade pendente guardam o nome da planilha (`identidadeImportacaoId`) e **não** mudam. |
| `bm_aux_medicoes.responsavel_codigo` | |
| `sgc_logs.colaborador_codigo` | Histórico. Reescrever mantém o histórico visível no portal (decisão 4). |
| `admin_audit_logs.target_codigo` | Auditoria. **Não** reescrever: registra o código da época. |

`Medicao` usa FK (`idProfissional`) e não muda.

**Inventário conferido (T1, 2026-10-16):** a lista acima está completa. Ela vale para o schema, o SQL cru do app (`lib/ciclo-cleanup.ts`, `app/api/dashboard/route.ts`) e o ETL, e fica em `COLUNAS_CODIGO_FORNECEDOR` (`lib/migracao-codigo-p0.ts`). Não guardam o código do fornecedor:
- `sgc_aprovacoes_medicao.colaborador_nome`: só rótulo;
- chaves do chat: usam ids de usuário;
- `email_logs`;
- `contratos.codigo`: código do contrato.

A comparação é `upper(trim())`, como em `lib/ciclo-cleanup.ts`.

**Atenção para a T2:** o ETL calcula o `source_row_hash` das linhas calculadas do mapa com o código (`etl/ingest_medicoes.py`, origem `calculado_documentos`). Depois da troca, a reimportação de um ciclo gera outro hash para a mesma linha. A T2 precisa confirmar que a reimportação substitui essas linhas, sem duplicar.

## Opções comparadas
| # | Opção | Atende à diretriz? | Nota |
|---|---|---|---|
| A | **Recodificar para P0** (esta spec) | sim | Um ID só, do login até os dados. Exige migração de dados única e cuidadosa. |
| B | Campo `Usuario.profissionalId` (v1) | não | É um segundo vínculo. |
| C | Login como `ProfissionalAlias` | não | É um segundo vínculo. Desativar o alias derruba o acesso, e o ETL passaria a aceitar P0 vindo da planilha como alias. |
| D | CNPJ como ID | não | Compartilhado entre fornecedores (decisão 003). |

## Regra nova
1. **Identidade da sessão** = `resolverIdentidadeOperacional(login)` RESOLVIDO. Sem isso, o escopo é mínimo, como hoje.
2. **Cadastro do fornecedor** = cadastro com `colaboradorCodigo = login`. Com mais de um cadastro, falha fechado, como hoje. Some o ramo "nome do usuário = `responsavel`" de `selectCadastroForAuthenticatedUser` e da busca em `getColaboradorEscopo` e `validateFornecedorForNfUpload`.
3. **Fornecedor novo:** o upsert administrativo gera o P0 **antes** e o usa como `colaboradorCodigo`, `Profissional.codigo` e `Profissional.nome`. O usuário é criado com esse mesmo P0, nunca reaproveitado pelo nome. O ramo CREATE deixa de usar o nome como código.
   - O nome do responsável vira alias (origem `CADASTRO`), para a planilha, que traz o nome, resolver para o P0.
   - Com um homônimo, o nome fica ambíguo e a importação pede decisão do ADMIN; nunca escolhe um dos dois.
   - "Nenhuma dessas identidades" deixa de ser recusada por colisão de nome: a identidade nova tem P0 próprio.
4. **Reimportação, reativação e `RECREATE_FROM_HISTORY`** (ajustado na T3, 2026-10-17):
   - O usuário é o do login igual ao código. Depois da migração, o código já é o P0.
   - Identidade de antes do P0 (por exemplo, fornecedor excluído antes da migração) ainda acha o usuário pelo nome, mas **nunca** o de outro fornecedor que já está em P0 (login igual ao código de outro Profissional).
   - Nesse caso, o código passa para o P0 do login na mesma transação, pela mesma rotina da migração (`trocarCodigoParaP0` em `lib/codigo-p0.ts`): o código antigo vira alias e as tabelas são atualizadas. O Profissional e o histórico continuam os mesmos; só o código muda.
5. **Inativação, exclusão definitiva e edição do cadastro:** acham o usuário pelo código (= login), não pelo nome. Renomear o `responsavel` não precisa mais renomear o usuário para manter o acesso (decisão 5).
6. **Planilhas:** o nome da planilha resolve para o P0 pelo alias criado na migração. Nome novo sem alias continua virando identidade pendente (`ImportacaoIdentidade`), resolvida pelo ADMIN.
7. O fornecedor nunca informa o próprio código: ele vem da sessão.

## Migração dos 55 fornecedores sem perder acesso
Um script único, `scripts/migrar-codigo-p0.ts`, roda em janela **sem importação** e depois de um backup (`pg_dump`).

1. **Dry-run (padrão), só leitura.** Para cada usuário COLABORADOR não excluído (ativo ou inativo), monta o par (P0, código atual) pela cadeia de antes do P0 (cadastro pelo login ou pelo nome exato, falhando fechado; `profissionalAntesDoP0` em `lib/migracao-codigo-p0.ts`) e classifica:
   - `MIGRAVEL`;
   - `JA_E_P0`;
   - `SEM_IDENTIDADE`;
   - `CONFLITO`: dois P0 para o mesmo Profissional, ou um P0 que já é código/alias de outro.

   Também conta os Profissionais sem usuário (decisão 2) e as linhas que seriam reescritas por tabela. A saída tem só contagens e o próprio login, sem nomes nem códigos antigos. A conexão é `READ ONLY`, como em `scripts/diagnose-escopo-fornecedor.ts`. Meta: 55 `MIGRAVEL` e 0 `CONFLITO`. O diagnóstico de 2026-10-16 indica isso.
2. **`--aplicar`:** uma transação por fornecedor:
   - cria `ProfissionalAlias` com o código antigo (origem `MIGRACAO_P0`);
   - troca `profissionais.codigo` para o P0;
   - atualiza as colunas da tabela acima de `código antigo` para `P0` (comparação exata no valor gravado);
   - grava `adminAuditLog` (`FORNECEDOR_CODIGO_P0`, metadata com o código antigo e o novo, para permitir reverter).

   Só processa `MIGRAVEL`. É idempotente: `JA_E_P0` é pulado. Abortar um fornecedor não afeta os outros.
3. **Medir depois (só leitura):** para os 55, o login resolve, o cadastro é achado pelo código e a lista de aliases aponta para o mesmo Profissional de antes. O script também compara contagens de BMs, mapa e divergências visíveis antes e depois, por usuário: só iguais ou diferentes, sem dados.
4. **Deploy do código** que remove a busca por nome, logo depois da migração e sem fallback (decisão 6). O código atual já funciona com o P0 como código, porque o primeiro ramo é o login.

**Rollback:**
- até o passo 2, nada mudou;
- depois dele, um script reverso usa o `adminAuditLog` (código novo → antigo) enquanto não houver importação nova;
- em último caso, o backup.

**Pré-produção:** os passos 1 e 3 (e o 2 no ensaio) exigem a `DATABASE_URL` da pré-produção. Quem executa é o usuário, com os segredos. Esta sessão entrega os comandos e lê só a saída em contagens.

## Comandos
- Tipos: `npx tsc --noEmit`
- Testes: `npm run test:targeted`, com `.env.test` carregado e `DATABASE_URL=$DATABASE_URL_TEST` (banco `medicoes_e2e_bm` migrado e com seed).
- ETL: `pytest etl/` (testes de identidade operacional e importação pendente).
- E2E: `npm run test:e2e:seed` e `npx playwright test e2e/isolamento-homonimos.spec.ts e2e/administrativo-novo-fornecedor.spec.ts e2e/importacao-identidades.spec.ts`
- Migração: `DATABASE_URL=... npx tsx scripts/migrar-codigo-p0.ts [--aplicar]`

Sem mudança de schema prevista: só dados. Se o plano achar uma constraint que exija migration, ela entra como migration nova.

## Estrutura
- `scripts/migrar-codigo-p0.ts` (novo): dry-run, aplicar e medir.
- `lib/cadastro-fornecedor.ts`:
  - `resolveFornecedorIdentity` e upsert: P0 no CREATE e usuário pelo código;
  - inativação, exclusão definitiva e `validateFornecedorForNfUpload`: sem nome.
- `lib/cadastro-identity.ts`: sai o ramo por nome.
- `lib/colaborador-alias.ts`: sai a busca de cadastro por nome.
- `app/api/admin/administrativo/fornecedores/[id]/route.ts`: o rename não é mais o elo.
- `scripts/seed-e2e.ts`: fornecedores do seed com código = P0.
- ETL: sem mudança esperada. Testes provam que planilha com nome resolve para P0 pelo alias.

## Código
- Sem `any`. `select` só dos campos usados. Cada fornecedor migra numa `prisma.$transaction` com a auditoria. SQL parametrizado.
- Nenhum log com nome ou código de outro fornecedor.
- Sem dependência nova.

## Testes
Cada teste de regressão abaixo falha no código atual.
- **Unitários:** `selectCadastroForAuthenticatedUser` acha o cadastro só pelo código. Um homônimo pelo nome não é escolhido.
- **Integração (banco de teste, `lib/prisma-test.ts`):**
  - **Homônimo novo:** A migrado para P0, e o Administrativo cria B com o mesmo `responsavel`. A continua com o próprio escopo; hoje perde o acesso.
  - **Fornecedor novo:** o upsert grava `colaboradorCodigo = Profissional.codigo = usuario` (P0).
  - **Migração:**
    - o dry-run não grava nada;
    - aplicar troca o código nas tabelas listadas e cria o alias;
    - BM aprovado ou pago mantém valores e status;
    - rodar duas vezes não muda nada;
    - `CONFLITO` não é migrado;
    - `admin_audit_logs` antigos não mudam.
  - **Importação TS (`lib/profissional-identidade.ts`):** o código antigo e o nome resolvem para o P0.
  - **NF, inativação e exclusão:** atingem o usuário do código e nunca o homônimo.
  - **Não regressão:** `tests/colaborador-alias.test.ts` e `tests/cadastro-identity.test.ts`, ajustados ao novo elo.
- **ETL (pytest):** planilha com o nome antigo resolve para P0 e grava P0 no mapa. Nome desconhecido continua pendente.
- **E2E:**
  - `e2e/isolamento-homonimos.spec.ts` ampliado: A e B homônimos com P0 próprio veem só os próprios dados. GET direto ao comprovante do outro dá 403/404.
  - Novo fornecedor pelo Administrativo entra no portal com o P0.
  - Importação de planilha por nome cai no fornecedor certo.

## Limites
- **Sempre:**
  - P0 como único ID; identidade pela sessão.
  - Backup e janela sem importação antes de aplicar.
  - Teste que reproduz a falha antes da correção.
  - `tsc` e `test:targeted` verdes antes de cada commit.
- **Perguntar antes:**
  - Aplicar a migração em qualquer banco que não seja o de teste.
  - Mexer no resolver ou no ETL além de testes.
  - Reescrever logs e auditoria.
  - Qualquer migration de schema.
- **Nunca:**
  - Usar CNPJ ou nome como ID ou como vínculo.
  - Alterar valores de BM aprovado ou pago (decisão 010).
  - Logar dados de outro fornecedor.
  - Deixar o fornecedor escolher o próprio código.
  - Alterar migrations aplicadas.

## Critérios de aceite
1. Os testes de regressão (homônimo novo e fornecedor novo com P0) falham antes e passam depois. Os demais passam.
2. O E2E ampliado e os specs do Administrativo e da importação passam.
3. `tsc`, `test:targeted` e `pytest etl/` verdes.
4. A migração no banco de teste: dry-run sem escrita, aplicar idempotente, saída só com contagens.
5. Na pré-produção (o usuário executa): 55 migrados, 0 conflitos, mesmos dados visíveis por fornecedor.
6. Notas atualizadas:
   - [portal do fornecedor](../modulos/portal-fornecedor.md), [autenticação](../modulos/autenticacao.md), [cadastro de fornecedores](../modulos/cadastro-fornecedores.md), [identidades](../modulos/identidades-importacao.md);
   - glossário (P0);
   - decisão 012 (P0 como ID) e revisão da 011;
   - [pendências](../pendencias.md);
   - status.

## Decisões (aprovadas em 2026-10-16)
1. **P0 como `Profissional.codigo`:** o código atual (em geral, o nome normalizado) vira alias (`MIGRACAO_P0`), só para a importação da planilha. Registrado na [decisão 012](../decisoes/012-p0-como-id-do-fornecedor.md).
2. **Profissionais sem login ficam como estão.** P0 é credencial de acesso: só recebe P0 quem tem login. O dry-run conta esses casos antes de aplicar.
3. **BM aprovado ou pago:** troca só a chave (`colaborador_codigo`) para o P0. Valores e status não mudam. A decisão 010 protege valores, não a chave.
4. **`sgc_logs` reescritos para o P0**, para o histórico continuar visível no portal. `admin_audit_logs` não muda; a troca código antigo → P0 fica registrada pela própria migração.
5. **Decisão 011 mantida por enquanto:** o nome do fornecedor só muda pelo Administrativo. Liberar a troca de nome fica para outra entrega.
6. **Ordem:** migrar os dados em janela sem importação, com backup, e fazer o deploy logo em seguida, **sem fallback por nome**. O código atual já aceita o P0 como código, então o acesso não cai entre os dois passos.

Plano: [p2-vinculo-login-profissional-plano](p2-vinculo-login-profissional-plano.md).
