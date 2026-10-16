---
atualizado: 2026-10-16
status: aprovado em 2026-10-16
tags: [spec, plano]
---
# Plano: escopo do fornecedor só por identidade exata

Spec: [p1-escopo-fornecedor-por-identidade](p1-escopo-fornecedor-por-identidade.md).

## Componentes e ordem
1. **Diagnóstico** (só leitura) → mostra quem perderia acesso legítimo. Vem antes de qualquer mudança de regra, e o resultado pode exigir aliases formais antes do deploy.
2. **Filtro puro** `filtrarAliasesDaIdentidade` + testes unitários dos 4 vetores.
3. **`getColaboradorCodigoAliases`** usa o filtro e perde os caminhos V2/V4 → testes de integração no banco de teste.
4. **Documentos Medidos** casa por nome do Profissional (`lib/documentos-medidos.ts`). Mesmo com a lista filtrada, o nome legítimo de A puxaria as medições de um B homônimo que tenha código. Passa a casar nome **só** em Profissional sem código.
5. **E2E de isolamento** com dois homônimos.
6. Cérebro e fechamento.

A ordem é sequencial: o diagnóstico (1) usa o mesmo filtro (2), e 3–5 dependem de 2. Não há passo que valha a pena rodar em paralelo.

## Riscos
- **Fornecedor legado perde a visão do próprio BM** (valor guardado como nome sem alias). Mitigação: diagnóstico (T1) e alias formal antes do deploy, nunca afrouxar o filtro.
- **Custo de resolver cada candidato.** São dezenas por requisição. Se o diagnóstico mostrar listas grandes, resolver em lote numa consulta (sem mudar a regra).
- **`server-only`** impede importar `lib/colaborador-alias.ts` no `tsx`. Mitigação: regra na função pura (T2) e integração pelo E2E (T5).
- **Admin/BM** (`app/api/admin/bm/route.ts`) também usa `getDocumentosMedidos`. T4 precisa manter o comportamento interno, com teste.

## Tarefas

- [ ] **T1: diagnóstico só leitura** — script pronto e validado no banco de teste (escrita barrada pela sessão somente leitura). Os removidos são classificados pelo resultado do resolver (OUTRO_FORNECEDOR, AMBIGUO, NAO_RESOLVIDO) em vez de V1–V4: é o que decide entre vazamento e legado que precisa de alias. Falta rodar na pré-produção.
  - Aceite: script `scripts/diagnose-escopo-fornecedor.ts` que, para cada usuário COLABORADOR ativo, compara a lista atual com a lista filtrada e imprime só contagens: total de usuários, quantos perdem valores, quantos valores por vetor (V1–V4) e o código do **próprio** usuário afetado. Nenhum nome e nenhum código de terceiro. Abre conexão só de leitura (`SET TRANSACTION READ ONLY`).
  - Verificar: roda no banco de teste semeado e no DEV local. **Em pré-produção, só com você executando ou acompanhando** (preciso saber como acessar, ver pergunta abaixo).
  - Arquivos: `scripts/diagnose-escopo-fornecedor.ts`, `lib/colaborador-alias-filtro.ts` (de T2).

- [ ] **T2: filtro puro + testes dos vetores** — filtro e 4 testes unitários prontos (adiantados porque o diagnóstico usa a mesma regra); faltam os testes de integração dos vetores.
  - Aceite: `filtrarAliasesDaIdentidade(candidatos, resolver, profissionalId)` mantém só valores que o resolver liga ao mesmo Profissional. Testes V1–V4 e de não regressão (alias formal, nome legado único, linha do mapa com o próprio nome).
  - Verificar: `npx tsx --test tests/colaborador-alias.test.ts`.
  - Arquivos: `lib/colaborador-alias-filtro.ts` (novo, sem `server-only`), `tests/colaborador-alias.test.ts` (novo).

- [ ] **T3: `getColaboradorCodigoAliases` usa o filtro**
  - Aceite: identidade da sessão via `resolverIdentidadeOperacional`; sem identidade, escopo = só o código da sessão; sai a busca por CNPJ (V2) e a escolha de cadastro por nome (V4); do mapa só entra o valor aprovado pelo filtro (V1). As 11 rotas, chat incluído, não mudam.
  - Verificar: teste de integração no banco de teste (`lib/prisma-test.ts`) chamando o filtro com o resolver real; `tsc`; `test:targeted`.
  - Arquivos: `lib/colaborador-alias.ts`, `tests/colaborador-alias.test.ts`.

- [ ] **T4: Documentos Medidos sem casamento por nome de outro**
  - Aceite: `getDocumentosMedidos` casa `codigo` como hoje e `nome`/`nomeCompleto` só em Profissional **sem código**. O teste V3 (B homônimo com código) passa; o portal e o admin/BM continuam achando os documentos do próprio fornecedor.
  - Verificar: `tests/documentos-medidos.test.ts` ganha o caso do homônimo; `test:targeted`.
  - Arquivos: `lib/documentos-medidos.ts`, `tests/documentos-medidos.test.ts`.

- [ ] **T5: E2E de isolamento**
  - Aceite: dois fornecedores com o mesmo nome, cada um com BM, NF, comprovante e linha no mapa. A só vê os próprios dados no portal e em Minhas Medições; GET direto no comprovante e na NF de B devolve 403/404; o chat de A não lista conversa de B.
  - Verificar: `npx playwright test e2e/isolamento-homonimos.spec.ts`; o teste falha sem T3/T4.
  - Arquivos: `e2e/isolamento-homonimos.spec.ts` (novo).

- [ ] **T6: fechamento**
  - Aceite: [portal do fornecedor](../modulos/portal-fornecedor.md) com a regra nova; P1 4 removida de [pendências](../pendencias.md); status atualizado; spec e plano como concluídos.
  - Verificar: `npx tsc --noEmit`, `npm run test:targeted`, E2E do portal e de isolamento verdes; `/review` e `/ponytail-review` antes do merge (CLAUDE.md).
  - Arquivos: notas do cérebro.

## Pontos de verificação
- Depois de T1: você revê as contagens. Se houver fornecedor legítimo perdendo acesso, cadastramos o alias **antes** de seguir.
- Depois de T3: `test:targeted` verde.
- Depois de T5: suíte completa verde; commit por tarefa (Conventional Commits, português).

## Pergunta em aberto
- **Acesso à pré-produção para T1:** como você roda comandos lá (SSH no servidor e `docker compose exec web ...`, ou outro caminho)? Eu preparo o comando; quem executa ou autoriza cada execução é você.
