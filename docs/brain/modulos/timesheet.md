---
atualizado: 2026-10-22
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
- XLSX = o modelo oficial da VALE (`app-assets/templates/Timesheet_ATO.xlsx`) com as células preenchidas: logos (imagem na célula), mesclagens, estilos e impressão vêm do modelo. O modelo é a planilha original limpa no Excel: só a aba `timesheet`, sem fórmulas, links externos, nomes quebrados nem dados de exemplo; sem "GAXLY" e sem o "GA" do cabeçalho; a regra de cinza virou `TRUE`, e a exportação define as linhas (sábado, domingo e feriado). Dias nas linhas 12 a 42 (até 31), total na 43; "Data:" e os dois "em" levam a data da exportação. Trocar o modelo exige manter essas células (o exportador falha se uma faltar) e o `outputFileTracingIncludes` da rota no `next.config.ts`.
- `lib/timesheet-medicao.ts`: lado da medição (lista do ciclo, histórico, reabertura, liberação, feriados manuais, configuração por fornecedor).
- `components/timesheet/timesheet-workspace.tsx` e `timesheet-drawer.tsx`: seção "Timesheet" do painel (MEDICAO e ADMIN).

**Regras e armadilhas:**
- Habilitado = `TimesheetConfig.habilitado`, se a medição definiu; senão `Profissional.statusColaborador = 'ATO'`. Profissional excluído nunca é habilitado.
- O fornecedor vem só de `getColaboradorEscopo(user.usuario)`. Quem não é habilitado recebe 404 antes de qualquer validação.
- As horas não ficam gravadas: são recalculadas na leitura. Um feriado cadastrado depois muda a folha, inclusive a enviada.
- O fornecedor só lança e envia no ciclo publicado do timesheet (`getCicloTimesheet` em `lib/ciclo-ativo.ts`: `ativoTimesheet`, senão o ciclo publicado do portal); outro ciclo dá 403 e a folha dele fica só leitura. O portal abre nesse mesmo ciclo. A medição publica no topo do painel Timesheet, com o controle de Fornecedores (`components/fornecedores/ciclo-publicado.tsx`, variante `timesheet`), só entre ciclos cadastrados; para abrir um ciclo antes da importação, crie-o em Gerenciar ciclos. Ver [spec](../specs/timesheet-ciclo-publicado.md).
- Liberação por ciclo (`TimesheetCiclo`; sem linha = `DIA_A_DIA`): em `DIA_A_DIA` só vale até hoje.
- Folha `ENVIADA` recusa gravação (409) até a medição reabrir.
- A auditoria vai para `AdminAuditLog`, na mesma transação da mudança, com estes `targetType`: `TIMESHEET_FOLHA` (dias, envio, reabertura), `TIMESHEET_CICLO` (liberação e `TIMESHEET_CICLO_PUBLICADO`), `FERIADO` e `PROFISSIONAL` (configuração).
- Rotas da medição: `requireAdmin` em todos os handlers (teste por regex em `tests/timesheet-medicao.test.ts`). O `profissionalId` da URL é validado como UUID.
- As FKs para o Profissional são `RESTRICT`. A limpeza de órfãos da exclusão de ciclo e o seed E2E apagam ou preservam o timesheet antes de tocar no Profissional.
- Feriado manual por contrato ([spec](../specs/timesheet-feriados-por-contrato.md)): sem contrato vale para todos; com contrato, só para quem tem esse contrato em `TimesheetConfig.contratoId`. Quem não tem contrato recebe só os gerais. `feriadosDoPeriodo` devolve todos; cada folha filtra com `feriadosDoContrato`. Uma data não pode ter dois feriados que alcancem o mesmo fornecedor (409); dois contratos diferentes podem. Trocar o contrato do fornecedor muda os feriados da folha, inclusive da enviada. Excluir o contrato exclui os feriados dele (`CASCADE`).
- Excluir um feriado recalcula uma folha já enviada sem nenhum aviso; só a criação depois do envio gera aviso (`feriadoAposEnvio`).
- Não use `toISOString()` para a data de "hoje": é UTC e muda de dia às 21:00 de Brasília.

**Pendente:** a página de impressão (PDF) ainda é o layout próprio, não o do modelo.

**Produção:** desde 2026-10-22 (bf53ea0). Nenhum fornecedor tem status ATO pela importação, então a habilitação é manual (configuração por fornecedor). Feriado por contrato (migration `20261022180000_timesheet_feriado_contrato`) e ciclo publicado do timesheet (`20261022200000_timesheet_ciclo_publicado`): ainda não implantados.

**Depende de:** [Ciclos](ciclos.md), [Portal do fornecedor](portal-fornecedor.md), [Autenticação](autenticacao.md)
