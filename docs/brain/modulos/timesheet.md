---
atualizado: 2026-10-21
tags: [modulo]
---
# Timesheet ATO

**O que faz:** é a Folha de Apropriação de Horas do fornecedor ATO. Ele preenche os horários de cada dia do ciclo (21→20) no portal. A plataforma calcula hora normal, HE 50%, HE 100% e o total, e a medição acompanha e exporta. Spec: [timesheet-ato](../specs/timesheet-ato.md); plano: [timesheet-ato-plano](../specs/timesheet-ato-plano.md).

**Onde está:** `lib/timesheet*.ts`, `lib/feriados.ts`, `app/api/colaborador/timesheet/`, `app/api/admin/timesheet/`, `components/timesheet/`

**Arquivos-chave:**
- `lib/timesheet-calculo.ts`: cálculo puro em minutos (`tipoDoDia`, `validarDia`, `calcularDia`, `somarHoras`).
- `lib/feriados.ts`: Páscoa e feriados nacionais calculados (não ficam no banco).
- `lib/timesheet.ts`: habilitação, leitura da folha com o cálculo, gravação de um dia, envio e a data de "hoje" em America/Sao_Paulo.
- `components/timesheet/folha-timesheet.tsx`: aba do portal; exporta `TabelaDiasTimesheet` e `TotaisTimesheet`, reusados pela medição.
- `lib/timesheet-export.ts` e `app/timesheet/imprimir/[profissionalId]/page.tsx`: exportação XLSX e página de impressão (PDF pelo navegador). As duas gravam `TIMESHEET_EXPORTADA`.
- `lib/timesheet-medicao.ts`: lado da medição (lista do ciclo, histórico, reabertura, liberação, feriados manuais, configuração por fornecedor).
- `components/timesheet/timesheet-workspace.tsx` e `timesheet-drawer.tsx`: seção "Timesheet" do painel (MEDICAO e ADMIN).

**Regras e armadilhas:**
- Habilitado = `TimesheetConfig.habilitado`, se a medição definiu; senão `Profissional.statusColaborador = 'ATO'`. Profissional excluído nunca é habilitado.
- O fornecedor vem só de `getColaboradorEscopo(user.usuario)`. Quem não é habilitado recebe 404 antes de qualquer validação.
- As horas não ficam gravadas: são recalculadas na leitura. Um feriado cadastrado depois muda a folha, inclusive a enviada.
- O fornecedor só lança e envia no ciclo ativo da medição; um ciclo passado dá 403. O portal mostra esse mesmo ciclo, então trocar o ciclo ativo cedo ou tarde demais muda o que o fornecedor alcança.
- Liberação por ciclo (`TimesheetCiclo`; sem linha = `DIA_A_DIA`): em `DIA_A_DIA` só vale até hoje.
- Folha `ENVIADA` recusa gravação (409) até a medição reabrir.
- A auditoria vai para `AdminAuditLog`, na mesma transação da mudança, com estes `targetType`: `TIMESHEET_FOLHA` (dias, envio, reabertura), `TIMESHEET_CICLO` (liberação), `FERIADO` e `PROFISSIONAL` (configuração).
- Rotas da medição: `requireAdmin` em todos os handlers (teste por regex em `tests/timesheet-medicao.test.ts`). O `profissionalId` da URL é validado como UUID.
- As FKs para o Profissional são `RESTRICT`. A limpeza de órfãos da exclusão de ciclo e o seed E2E apagam ou preservam o timesheet antes de tocar no Profissional.
- Excluir um feriado recalcula uma folha já enviada sem nenhum aviso; só a criação depois do envio gera aviso (`feriadoAposEnvio`).
- Não use `toISOString()` para a data de "hoje": é UTC e muda de dia às 21:00 de Brasília.

**Depende de:** [Ciclos](ciclos.md), [Portal do fornecedor](portal-fornecedor.md), [Autenticação](autenticacao.md)
