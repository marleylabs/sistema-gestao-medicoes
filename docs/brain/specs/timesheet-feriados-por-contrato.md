---
atualizado: 2026-10-22
tags: [spec]
---
# Timesheet: feriados por contrato

## Objetivo
Hoje o feriado estadual ou municipal cadastrado pela medição vale para todos os fornecedores ATO. Contratos em cidades ou estados diferentes têm feriados diferentes, então a medição precisa cadastrar um feriado só para um contrato e filtrar a tela de feriados por contrato.

## Regras (aprovadas pelo usuário em 2026-10-22)
1. Um feriado manual pode ter um contrato ou nenhum. Sem contrato = "Todos os contratos". Os feriados já cadastrados ficam sem contrato e continuam valendo para todos (a migration não muda dados).
2. O contrato do fornecedor é o da configuração do timesheet (`TimesheetConfig.contratoId`). O fornecedor recebe os nacionais, os feriados sem contrato e os do contrato dele.
3. Fornecedor sem contrato na configuração recebe só os nacionais e os sem contrato.
4. Uma data não pode ter dois feriados que alcancem o mesmo fornecedor: não pode haver dois sem contrato, nem dois do mesmo contrato, nem um sem contrato junto com um de contrato (409, com o nome de quem já ocupa a data). Dois contratos diferentes podem ter feriado na mesma data.
5. Trocar o contrato de um fornecedor muda os feriados da folha dele, inclusive da enviada (as horas são recalculadas na leitura, como já acontece com feriado novo).
6. Excluir um contrato exclui os feriados dele (FK `CASCADE`). Ligar o feriado a "todos" (`SET NULL`) estenderia o feriado a quem não tem nada a ver com ele.
7. Auditoria do feriado (`FERIADO_CRIADO`/`FERIADO_EXCLUIDO`) passa a registrar o contrato.

## Tela (aba Feriados da medição)
- Filtro "Contrato" acima do calendário: "Todos os contratos" (só os feriados gerais) ou um contrato (nacionais, gerais e os do contrato).
- O feriado novo é criado para o contrato do filtro; o diálogo diz para quem ele vale.
- A lista mostra para quem vale cada feriado ("Todos os contratos" ou o nome do contrato).

## Fora do escopo
- Mais de um contrato por fornecedor no timesheet.
- Feriado para vários contratos de uma vez (cadastre um por contrato).

## Plano
1. Migration `timesheet_feriado_contrato`: coluna `contrato_id` (FK `CASCADE`), troca do único em `data` por único em (`data`, `contrato_id`) e índice único parcial em `data` quando `contrato_id` é nulo.
2. `lib/timesheet.ts`: `feriadosDoPeriodo` aceita o contrato do fornecedor; `carregarFolha` (portal, drawer, XLSX e impressão) usa o contrato da configuração.
3. `lib/timesheet-medicao.ts`: `listarFolhasDoCiclo` devolve todos os feriados com o contrato e calcula cada folha só com os que valem para ela; `criarFeriado` recebe `contratoId` e checa a regra 4.
4. Tela: filtro, diálogo e lista.
5. Testes: `tests/timesheet-medicao.test.ts` (regras 2 a 4) e `e2e/timesheet-medicao.spec.ts` (feriado de outro contrato não marca a folha).
