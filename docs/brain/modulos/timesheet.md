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
- Sábado, domingo e feriado têm destaque verde em todo lugar (decisão do usuário em 2026-10-22): faixa verde-clara + marcador verde à esquerda + dia da semana escrito, para não depender só da cor no P&B. Na tela usa os tokens `--success`/`--success-soft` (claro e escuro) na `TabelaDiasTimesheet` e no calendário de feriados.
- XLSX = o modelo `app-assets/templates/Timesheet_ATO.xlsx` com as células preenchidas. Nasceu da planilha oficial da VALE, limpa (só a aba `timesheet`, sem fórmulas, links externos nem dados de exemplo, sem "GAXLY" e sem o "GA") e depois restilizada no Excel com a paleta do PDF: título em verde-petróleo VALE, cabeçalho ardósia claro, bordas cinza-claro, data com dia da semana (`dd/mm/aaaa ddd`), total com linha forte e a regra condicional verde (a exportação define as linhas). Dias nas linhas 12 a 42, total na 43; "Data:" e os dois "em" levam a data da exportação. Trocar o modelo exige manter essas células (o exportador falha se uma faltar) e o `outputFileTracingIncludes` da rota. Armadilha: o Excel em português grava a regra condicional como `'TRUE'` (texto), e aí nem a automação do Excel abre o arquivo; deixe `TRUE` no XML.
- PDF = página de impressão própria, sóbria (Manrope do app, neutros em ardósia, linhas finas, acento verde-petróleo VALE): marcas e título, grade de identificação, tabela de dias com zeros apagados ("–"), total do período, cartões de totais, legenda do verde, assinaturas e observações; A4 retrato, uma página. Logos com `loading="eager"` (lazy não carrega a tempo da impressão). O `globals.css` fixa `table { font-size: 12px }` fora das camadas do Tailwind, então o tamanho vai nas células (`[&_td]:text-[8px]`). Cores com `[print-color-adjust:exact]`.

**Produção:** desde 2026-10-22 (bf53ea0). Nenhum fornecedor tem status ATO pela importação, então a habilitação é manual (configuração por fornecedor). Feriado por contrato (migration `20261022180000_timesheet_feriado_contrato`) e ciclo publicado do timesheet (`20261022200000_timesheet_ciclo_publicado`): ainda não implantados.

**Depende de:** [Ciclos](ciclos.md), [Portal do fornecedor](portal-fornecedor.md), [Autenticação](autenticacao.md)
