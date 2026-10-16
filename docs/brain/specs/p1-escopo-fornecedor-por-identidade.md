---
atualizado: 2026-10-16
status: aprovada em 2026-10-16
tags: [spec]
---
# Spec: escopo do fornecedor só por identidade exata

## Objetivo
Garantir que um fornecedor logado (perfil COLABORADOR) nunca veja nem altere dados de outro fornecedor, mesmo quando os dois têm nomes iguais ou parecidos, ou compartilham CNPJ. É a P1 4 de [pendências](../pendencias.md).

Hoje `getColaboradorCodigoAliases` (`lib/colaborador-alias.ts`) monta a lista de valores que delimita os dados do fornecedor. A lista é usada por 11 rotas (`app/api/colaborador/**`, `app/api/sgc/chat/**`, `app/api/chat/_helpers.ts`). Ela pode incluir valores de **outro** fornecedor por quatro caminhos:

| # | Caminho | Risco |
|---|---|---|
| V1 | Linhas do mapa de pagamento cujo `responsavel` ou `projetistaCodigo` é igual ao nome do fornecedor (só letras e números, sem acento). Entram **as duas colunas** da linha, inclusive o `projetistaCodigo` de outro. | Um homônimo no mapa traz o código do outro para o escopo: BM, NF, comprovante e medições dele aparecem. |
| V2 | Cadastro achado por CNPJ + `responsavel` que **contém** o nome do Profissional. | CNPJ é compartilhado (decisão 003), e "contém" é casamento aproximado. |
| V3 | Nomes (`Profissional.nome`, `nomeCompleto`, `CadastroFornecedor.responsavel`) entram como aliases, e as rotas comparam esses nomes com colunas de código e de nome. | Outro Profissional com o mesmo nome entra no escopo. |
| V4 | Cadastro achado por `responsavel = nome do usuário` quando não há cadastro pelo código. | Um homônimo cadastrado vira "o cadastro" do usuário. |

**Sucesso:** todo valor da lista resolve, pelo resolver oficial, para o **mesmo** Profissional do usuário logado. Um valor que resolve para outro Profissional, que é ambíguo ou que não resolve fica fora.

## Premissas (corrija se alguma estiver errada)
1. O login do fornecedor é o código canônico (`P0XXXXXX`, `lib/usuario-format.ts`), e a identidade vem só da sessão.
2. O resolver oficial é `resolverIdentidadeOperacional` (`lib/profissional-identidade.ts`): código → alias ativo → nome legado. Ele já é o par TS do resolver do ETL (decisão 003).
3. As rotas continuam recebendo uma lista de strings: a mudança fica dentro de `lib/colaborador-alias.ts`, sem alterar as 11 rotas, exceto onde um teste mostrar que uma rota compara nome com outro fornecedor.
4. Sem mudança de schema nem de dependência.
5. Dados antigos em que `colaboradorCodigo`/`projetistaCodigo` guardam um **nome** continuam visíveis **só** se esse nome resolver para o próprio fornecedor (alias formal ou nome legado único).

## Regra nova
1. Identidade do usuário = `resolverIdentidadeOperacional(sessão.usuario)`. Se não estiver RESOLVIDO, o escopo é só o código da sessão (comportamento seguro, sem nomes).
2. Candidatos: código canônico, aliases ativos (`aliasesDaIdentidade`), `nome`/`nomeCompleto` do Profissional, `colaboradorCodigo`/`responsavel` do cadastro escolhido **pelo código** e valores do mapa do ciclo.
3. Um candidato só entra na lista se `resolverIdentidadeOperacional(candidato)` devolver RESOLVIDO com o **mesmo** `profissionalId`. Nome que resolve para outro, AMBIGUO ou NAO_RESOLVIDO fica fora.
4. Saem: a busca de cadastro por CNPJ (V2) e a escolha de cadastro por nome do usuário (V4). Do mapa (V1), só entra o valor que passa pela regra 3, nunca "a linha inteira".
5. Valor descartado não é logado com dados de outro fornecedor (CLAUDE.md). No máximo, um contador sem nomes.

## Comandos
- Tipos: `npx tsc --noEmit`
- Testes: `npm run test:targeted` com `.env.test` carregado e `DATABASE_URL=$DATABASE_URL_TEST`
- E2E: `npm run test:e2e:seed` e `npx playwright test e2e/<spec>` (mesmo ambiente)

## Estrutura
- `lib/colaborador-alias.ts`: única mudança de regra.
- `lib/profissional-identidade.ts`: só reutilizado; não muda.
- `tests/colaborador-alias.test.ts` (novo): integração no banco de teste via `lib/prisma-test.ts`. Como o módulo é `server-only`, o teste exercita a regra extraída (ver Código) ou roda pelo mesmo padrão dos testes que já tratam módulos `server-only`.
- `e2e/`: um spec de isolamento com dois fornecedores homônimos.

## Código
- A regra de filtro fica numa função pura (`filtrarAliasesDaIdentidade(candidatos, resolver, profissionalId)`), testável sem `server-only`. `getColaboradorCodigoAliases` só busca os candidatos e chama a função.
- `select` só dos campos usados; nada de `any`; nada de CNPJ como critério.
- Custo: uma chamada ao resolver por candidato distinto. Os candidatos são poucos (dezenas); o mapa do ciclo já é lido hoje.

## Testes
Cada vetor ganha um teste que falha no código atual:
- **V1:** fornecedor B com linha no mapa cujo `responsavel` é o nome de A → o código de B não entra na lista de A.
- **V2:** A e B com o mesmo CNPJ e nomes que se contêm → o código de B não entra.
- **V3:** outro Profissional com `nome` igual ao de A → esse nome não entra na lista de A, nem as medições dele em Documentos Medidos.
- **V4:** usuário sem cadastro pelo código e um cadastro de outro com o mesmo nome → o cadastro não é usado.
- **Não regressão:** alias formal de A, nome legado único de A e linha do mapa com o próprio nome de A continuam visíveis.
- **E2E (isolamento entre fornecedores):** com dois homônimos, o fornecedor A abre portal, NF, comprovante e Minhas Medições e só vê os próprios dados; um GET direto ao comprovante de B devolve 403/404.

## Limites
- **Sempre:** identidade pela sessão; resolver oficial; teste que reproduz cada vetor antes da correção; `tsc` e `test:targeted` verdes antes do commit.
- **Perguntar antes:** mudar qualquer uma das 11 rotas além do necessário; mudar `lib/profissional-identidade.ts`; qualquer migration; rodar diagnóstico em pré-produção.
- **Nunca:** usar CNPJ ou nome aproximado para ampliar escopo; logar nomes ou códigos de outro fornecedor; afrouxar o filtro para "fazer funcionar" um fornecedor legado (o caminho é cadastrar alias formal).

## Critérios de aceite
1. Os 4 testes de vetor falham no código atual e passam depois.
2. Os testes de não regressão passam.
3. O E2E de isolamento passa.
4. `tsc` e `test:targeted` verdes.
5. Notas atualizadas: [portal do fornecedor](../modulos/portal-fornecedor.md) (regra nova) e [pendências](../pendencias.md) (P1 4 removida).

## Decisões (aprovadas em 2026-10-16)
1. **Dados legados:** antes de implementar, rodar um diagnóstico **só leitura** que conta, por fornecedor, quantos valores da lista atual a regra nova descartaria, sem exportar nomes. Quem tiver descarte legítimo recebe alias formal antes do deploy.
2. **Usuário sem identidade resolvida:** escopo mínimo (só o código da sessão), sem tela de erro nova.
3. **Chat:** a mesma regra vale para `app/api/chat/_helpers.ts`, porque usa a mesma função.

Plano: [p1-escopo-fornecedor-por-identidade-plano](p1-escopo-fornecedor-por-identidade-plano.md).
