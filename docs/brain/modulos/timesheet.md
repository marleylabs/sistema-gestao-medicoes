---
atualizado: 2026-10-23
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
- Sábado, domingo e feriado têm destaque verde em todo lugar (decisão do usuário em 2026-10-22): faixa verde-clara + marcador verde à esquerda + dia da semana escrito, para não depender só da cor no P&B. Na tela usa os tokens `--success`/`--success-soft` (claro e escuro) na `TabelaDiasTimesheet` e no calendário de feriados.
- XLSX = o modelo `app-assets/templates/Timesheet_ATO.xlsx` com as células preenchidas. Nasceu da planilha oficial da VALE, limpa (só a aba `timesheet`, sem fórmulas, links externos nem dados de exemplo, sem "GAXLY" e sem o "GA") e depois restilizada no Excel com a paleta do PDF: título em verde-petróleo VALE, cabeçalho ardósia claro, bordas cinza-claro, data com dia da semana (`dd/mm/aaaa ddd`), total com linha forte e a regra condicional verde (a exportação define as linhas). Dias nas linhas 12 a 42, total na 43; a coluna "APROVAÇÃO" (decisão do fiscal, mesmo texto da tela por `textoAprovacao`, "Reprovado: motivo") é a M: o exportador encurta a mesclagem da descrição de K:M para K:L e dá à M a borda da K (o modelo continua com K:M; a assinatura K46:M46 não muda); "Data:" e os dois "em" levam a data da exportação. Trocar o modelo exige manter essas células (o exportador falha se uma faltar) e o `outputFileTracingIncludes` da rota. Para refazer o modelo: scripts `scripts/timesheet-modelo/1-limpar-modelo.ps1` e `2-restilizar-modelo.ps1` (Excel no Windows). Armadilha: o Excel em português grava a regra condicional como `'TRUE'` (texto), e aí nem a automação do Excel abre o arquivo; deixe `TRUE` no XML.
- PDF = página de impressão própria, sóbria (Manrope do app, neutros em ardósia, linhas finas, acento verde-petróleo VALE): marcas e título, grade de identificação, tabela de dias com zeros apagados ("–"), total do período, cartões de totais, legenda do verde, assinaturas e observações; A4 retrato, uma página. A coluna "Aprovação" mostra só o estado (Aprovado, Reprovado em vermelho, Pendente); os motivos vão em Observações, agrupados por motivo com os dias ("Reprovado em 31/05, 09/06: …"), porque uma seção a mais empurrava a folha para duas páginas. Logos com `loading="eager"` (lazy não carrega a tempo da impressão). O papel é fixado pela própria página (`@page { size: A4 portrait; margin: 10mm 8mm 10mm 12mm }` num `<style>`, a única CSS dela, e fundo branco no `<html>` só na impressão): sem isso o Chrome usava o papel e a escala da máquina e chegou a encolher a folha à metade. O título da página ("Folha de Apropriação de Horas") vira o nome sugerido do PDF. Teste de impressão fiel ao Chrome: `page.pdf({ preferCSSPageSize: true })` com janela larga. O `globals.css` fixa `table { font-size: 12px }` fora das camadas do Tailwind, então o tamanho vai nas células (`[&_td]:text-[8px]`). Cores com `[print-color-adjust:exact]`.
- `lib/timesheet-medicao.ts`: lado da medição (lista do ciclo, histórico, reabertura, liberação, feriados manuais, configuração por fornecedor).
- `components/timesheet/timesheet-workspace.tsx` e `timesheet-drawer.tsx`: seção "Timesheet" do painel (MEDICAO e ADMIN).
- `lib/timesheet-fiscal.ts`, `app/api/fiscal/timesheet/`, `components/timesheet/fiscal-app.tsx`: aprovação das horas pelo fiscal do contrato ([spec](../specs/timesheet-aprovacao-fiscal.md)).
- `lib/timesheet-assinatura.ts`, `lib/timesheet-assinatura-texto.ts` e `components/timesheet/assinatura.tsx`: assinatura eletrônica da folha pelo fiscal e pelo colaborador, e envio assinado ([spec](../specs/timesheet-assinatura.md), [decisão 014](../decisoes/014-assinatura-eletronica-propria.md)).
- `lib/fiscais.ts`, `components/administrativo/fiscais.tsx`: cadastro do fiscal (telefone cifrado, empresa, cargo, matrícula), edição e "Acesso ao portal" ([spec](../specs/fiscal-cadastro-acesso.md)).

**Regras e armadilhas:**
- Aprovação por dia: `TimesheetDia.aprovacao` (null = pendente, `APROVADO`, `REPROVADO` com motivo obrigatório). Só o perfil FISCAL decide (`requireFiscal`), e só para fornecedores cujo contrato da configuração tem `fiscalId` = ele; fora do escopo é 404. Pode decidir com a folha aberta ou enviada, mas só dias lançados. `salvarDia` zera a decisão quando o dia muda (regravar igual mantém). Lote: várias datas por chamada, auditoria `TIMESHEET_DIAS_APROVADOS`/`_REPROVADOS` na mesma transação. Medição e fornecedor veem a coluna "Aprovação" só leitura; a lista da medição mostra as contagens.
- Horas reprovadas pelo fiscal saem dos totais (HN, HE 50%, HE 100% e Total) da folha, da lista da medição, do XLSX e do PDF; a linha do dia continua mostrando o lançado (decisão do usuário em 2026-10-23). Aprovado e pendente contam. São dois cálculos: `carregarFolha` (`lib/timesheet.ts`) e `listarFolhasDoCiclo` (`lib/timesheet-medicao.ts`); mudou a regra, mude os dois. Corrigido pelo fornecedor, o dia volta a pendente e ao total.
- Assinatura (spec timesheet-assinatura):
  - **Colaborador:** o envio e a assinatura são um só ato (`enviarFolha` em `lib/timesheet-assinatura.ts`), e não há envio sem assinatura. Antes de assinar, ele revê a folha, com a lista dos dias úteis sem lançamento, e confirma.
  - **Fiscal:** assina a qualquer momento, e a assinatura vale o ciclo todo. Só quem assinou revoga.
  - **Reabertura:** encerra só a assinatura do colaborador.
  - **Folha alterada depois:** a assinatura continua e aparece o aviso, pelo hash.
  - **Unicidade:** uma assinatura ativa por folha e papel, garantida por um índice parcial que o Prisma não expressa (ver a migration).
  - **IP:** nunca sai na folha; só a verificação interna o mostra.
  - **Testes:** usam `tests/support/assinatura-png.ts`.
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

**Produção:** desde 2026-10-22 (bf53ea0). Nenhum fornecedor tem status ATO pela importação, então a habilitação é manual (configuração por fornecedor). Feriado por contrato (migration `20261022180000_timesheet_feriado_contrato`) e ciclo publicado do timesheet (`20261022200000_timesheet_ciclo_publicado`): ainda não implantados.

**Depende de:** [Ciclos](ciclos.md), [Portal do fornecedor](portal-fornecedor.md), [Autenticação](autenticacao.md)
