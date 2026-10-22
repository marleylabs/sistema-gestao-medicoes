---
atualizado: 2026-10-22
tags: [spec]
---
# Timesheet: ciclo publicado próprio

## Objetivo
Hoje o fornecedor só preenche o timesheet do ciclo publicado no portal (`ativoMedicao`). Esse ciclo só avança depois que o pagamento termina, então o preenchimento começa atrasado. A medição precisa publicar um ciclo para o timesheet separado do ciclo do portal: o fornecedor fica no pagamento do 2609 e preenche o timesheet do 2610.

## Regras (aprovadas pelo usuário em 2026-10-22)
1. O ciclo do timesheet é escolhido entre os ciclos cadastrados na plataforma, a mesma lista de Fornecedores. Para abrir um ciclo antes da importação, a medição cria o ciclo em Gerenciar ciclos e depois o publica no timesheet.
2. Sem ciclo publicado no timesheet, vale o ciclo publicado do portal (comportamento anterior; nada muda até a medição publicar).
3. Só o ciclo publicado do timesheet aceita lançamento e envio. A folha de um ciclo anterior ainda não enviada fica só leitura para o fornecedor; a medição continua vendo, reabrindo e exportando qualquer ciclo.
4. Publicar é MEDICAO/ADMIN, como no portal, e grava auditoria (`TIMESHEET_CICLO_PUBLICADO`, `targetType` `TIMESHEET_CICLO`) na mesma transação.
5. Excluir o ciclo publicado do timesheet faz o timesheet voltar a seguir o ciclo do portal.

## Como
- Coluna `mapa_pagamento_contexto.ativo_timesheet` (único parcial em `true`, igual a `ativo_medicao`).
- `lib/ciclo-ativo.ts`: `getCicloTimesheet()` = ciclo com `ativoTimesheet`, senão `getCicloAtivoMedicao()`. O portal (GET da folha) e a trava de lançamento/envio (`lib/timesheet.ts`) usam ele.
- `PATCH /api/ciclos` ganha a ação `set_ativo_timesheet`; `GET /api/ciclos` devolve `ativoTimesheet`.
- Tela: o controle "Ciclo publicado" de Fornecedores (`components/fornecedores/ciclo-publicado.tsx`) é reusado no topo do painel Timesheet, com textos do timesheet.

## Fora do escopo
- Seletor de ciclo no portal do fornecedor; envio de folha de ciclo anterior pelo fornecedor (continua na fase 2).

## Verificação
- `tests/timesheet.test.ts` ou `tests/timesheet-medicao.test.ts`: publicação, fallback para o portal, trava de ciclo, auditoria.
- `e2e/timesheet-fornecedor.spec.ts` ou `e2e/timesheet-medicao.spec.ts`: a medição publica e o portal mostra o ciclo publicado.
