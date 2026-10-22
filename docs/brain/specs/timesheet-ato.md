---
atualizado: 2026-10-21
tags: [spec]
status: aprovada em 2026-10-21
---
# Spec: Timesheet ATO (Folha de Apropriação de Horas)

## Objetivo
Levar para a plataforma a "Folha de Apropriação de Horas" que os fornecedores ATO hoje preenchem no Excel (`Timesheet_ATO_Projeta_INTR 4.xlsx`).
- O fornecedor preenche, no portal, os horários de cada dia do ciclo (21 a 20).
- A plataforma calcula hora normal, HE 50%, HE 100% e o total.
- A equipe de medição acompanha quem está preenchendo, com auditoria de quem salvou o quê e quando.
- No fim do ciclo, a medição baixa a folha em XLSX ou PDF e envia ao gestor do contrato por fora da plataforma.

**Usuários:**
- **Fornecedor ATO** (perfil COLABORADOR): preenche só a própria folha.
- **Equipe de medição** (perfis MEDICAO e ADMIN, guarda `requireAdmin`): configura, acompanha, reabre, cadastra feriados e exporta.

**Fora do escopo (fase 2):**
- Envio ao gestor e registro da aprovação dentro da plataforma.
- Lançamento do total de horas na medição/BM do fornecedor.
- O fornecedor baixar a própria folha.
- Jornada que atravessa a meia-noite.
- Ponto facultativo automático (Carnaval, Corpus Christi): a medição cadastra, se valer.

## Mapa de capacidades
Ordem de construção. Cada módulo depende só dos anteriores.

| Id | Módulo | Depende de | Testável sozinho por |
|---|---|---|---|
| M1 | Calendário de feriados: nacionais automáticos + cadastro manual | — | testes de unidade (Páscoa, lista do ano) e de rota |
| M2 | Cálculo de horas de um dia | M1 | testes de unidade (casos da planilha) |
| M3 | Habilitação e cabeçalho por fornecedor (configuração da medição) | — | testes de rota e permissão |
| M4 | Preenchimento no portal: liberação, envio e trava | M1, M2, M3 | testes de rota, isolamento e E2E |
| M5 | Painel de acompanhamento + auditoria | M4 | testes de rota e E2E |
| M6 | Exportação XLSX e PDF | M4 | teste do arquivo gerado e E2E do download |

## Regras de negócio

### Ciclo e dias
- O ciclo é o YYMM da plataforma (ex.: 2606). Os dias vão de `atoInicio` a `atoFim` de `cicloToDates` (`lib/ciclo.ts`): 21/05/2026 a 20/06/2026. Nada de tabela de datas.
- O ciclo mostrado ao fornecedor por padrão é o ciclo ativo (`lib/ciclo-ativo.ts`).

### Quem preenche (M3)
- Por padrão, a folha está habilitada para todo Profissional com `statusColaborador = 'ATO'` (vindo da importação) e não excluído (`deletedAt` nulo).
- A medição pode sobrescrever por fornecedor: habilitar quem não é ATO ou desabilitar quem é. Sem sobrescrita, vale o status ATO.
- Desabilitar não apaga o que já foi preenchido. Some do portal e continua visível para a medição.

### Cabeçalho (M3)
- A medição configura por fornecedor e a configuração vale para os ciclos seguintes até ser mudada. Campos: contrato (`Contrato`, de onde vêm o nº e o fiscal), função, item da PQ, local, área/unidade (ex.: "MINA DO SALOBO"), nº da SE e doc. nº.
- Fixos da folha: "Tipo de Serviço: ATO", "Contratada: Projeta Consultoria", o nome do fornecedor e o período do ciclo.
- O fornecedor vê o cabeçalho e não o altera.

### Preenchimento (M4)
- Uma linha por dia: entrada (manhã), saída (almoço), entrada (volta do almoço), saída final. Além delas, Projeto/PEP, Descrição dos serviços e Solicitante, em texto livre e opcionais.
- O dia pode ter só a manhã, só a tarde ou ficar vazio (folga, falta). Os pares incompletos (entrada sem saída) são rejeitados.
- Ordem obrigatória quando os campos estão preenchidos: entrada1 < saída1 ≤ entrada2 < saída2, todos no mesmo dia (00:00–23:59).
- Os horários ficam em minutos desde 00:00 (inteiro). Não há valor monetário aqui.
- **Liberação (escolha da medição, por ciclo):**
  - `CICLO`: o fornecedor pode preencher qualquer dia do ciclo.
  - `DIA_A_DIA`: o fornecedor preenche hoje e os dias anteriores do ciclo; os dias futuros ficam bloqueados. "Hoje" é a data em America/Sao_Paulo, calculada no servidor.
  - Padrão de um ciclo novo: `DIA_A_DIA`.
- **Envio e trava:** o fornecedor clica em "Enviar folha" e a folha fica `ENVIADA`, só leitura para ele. A medição pode reabrir (volta a `ABERTA`). Enviar e reabrir pedem confirmação.
- O fornecedor só acessa a própria folha, identificada pela sessão (`getColaboradorEscopo`). Nunca por id do request.

### Cálculo de horas (M2)
Esta é a regra da planilha, com duas correções. Seja `manhã = saída1 − entrada1` e `tarde = saída2 − entrada2`, considerando só os pares completos, e `trabalhado = manhã + tarde`.

| Dia | Hora normal | HE 50% | HE 100% |
|---|---|---|---|
| Domingo ou feriado (nacional ou cadastrado) | 0 | 0 | trabalhado |
| Sábado que não é feriado | 0 | trabalhado | 0 |
| Segunda a sexta, sem feriado | trabalhado − HE 50% | tempo trabalhado depois das 17:00 | 0 |

- Total = hora normal + HE 50% + HE 100%. O total do ciclo é a soma dos dias.
- **Correção 1:** o sábado que é feriado conta uma vez só, como HE 100%. Na planilha, ele entrava em HE 50% e em HE 100% ao mesmo tempo.
- **Correção 2:** a HE 50% do dia útil conta só o tempo efetivamente trabalhado depois das 17:00, em qualquer um dos dois períodos: `max(0, saída − max(entrada, 17:00))` somado na manhã e na tarde. Na planilha, a conta era `saída2 − 17:00`, o que gera hora normal negativa quando a tarde começa depois das 17:00. A soma nos dois períodos só faz diferença quando a "manhã" lançada passa das 17:00 (ex.: 14:00–19:00 dá 2h de HE 50%). Apresentada no Checkpoint 1 e mantida.
- Entrar antes das 08:00 não gera hora extra (igual à planilha).
- As horas são calculadas na leitura, não ficam gravadas. Um feriado cadastrado depois recalcula a folha. Na folha `ENVIADA`, o painel avisa quando isso acontece (decisão 2 abaixo).

### Feriados (M1)
- **Nacionais, automáticos e calculados no código (não gravados):** 01/01, Sexta-feira Santa (Páscoa − 2 dias), 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11 e 25/12.
- **Manuais (estaduais e municipais):** a medição cadastra data, nome e abrangência (ESTADUAL ou MUNICIPAL). Pode excluir. Não há duas entradas para a mesma data. Uma data que já é feriado nacional é recusada com aviso.
- Os feriados valem para todos os fornecedores. Feriado por local ou contrato fica para depois, se for preciso.
- **Painel:** calendário do ciclo (21→20). A medição clica numa data para criar ou excluir um feriado e vê a lista dos feriados do ciclo, com a origem (nacional ou manual).

### Acompanhamento e auditoria (M5)
- **Lista do ciclo:** cada fornecedor habilitado, com status (Não iniciada / Em preenchimento / Enviada), dias preenchidos, data e hora do último preenchimento, total de horas (HN, HE 50%, HE 100%) e filtro por status.
- **Detalhe:** a folha do fornecedor só para leitura, mais o histórico de auditoria.
- **Auditoria:** cada salvamento de dia, envio, reabertura, mudança de liberação, configuração e feriado grava quem (usuário), quando (timestamptz) e o quê (dia, valores antes/depois). A gravação acontece na mesma transação da mudança (`prisma.$transaction`).
- Logs e respostas nunca trazem dados de outro fornecedor.

### Exportação (M6)
- **XLSX:** gerado no servidor por `lib/xlsx.ts`, sem dependência nova. Segue o layout da folha (cabeçalho, uma linha por dia, totais, campos de assinatura e visto da fiscalização). Leva valores calculados, não fórmulas. As horas saem no formato `[h]:mm`, se o `lib/xlsx.ts` suportar; senão, como texto `hh:mm` (a decidir no plano).
- **PDF:** página de impressão da folha (CSS de impressão, A4 paisagem). A medição usa "Salvar como PDF" do navegador, sem dependência nova.
- Quem exporta: a medição, por fornecedor e ciclo. A exportação também entra na auditoria.

## Comandos
- Tipos: `npx tsc --noEmit`
- Testes: `npm run test:e2e:seed`, depois `npm run test:targeted`. E2E: `npm run test:e2e`. Exporte antes `DATABASE_URL`/`DATABASE_URL_TEST` (do `.env.test`) e `E2E_DATABASE_NAME=medicoes_e2e_bm`. Nunca contra o `.env`.
- Schema: `npx prisma migrate dev --name timesheet_ato` (nova migration; nunca `db push` fora do local).
- Dev contra o banco de teste: `.claude/launch.json` → `dev-banco-teste` (porta 3100). Depois, `git checkout -- tsconfig.json`.

## Estrutura (proposta, a confirmar no plano)
- `prisma/schema.prisma` + nova migration. Modelos: `Feriado`, `TimesheetConfig` (por Profissional: sobrescrita da habilitação e cabeçalho), `TimesheetCicloConfig` (liberação por ciclo), `TimesheetFolha` (Profissional × ciclo: status, envio, reabertura), `TimesheetDia` (Folha × data: horários e textos) e `TimesheetLog` (auditoria).
- `lib/feriados.ts`: Páscoa, nacionais do ano e feriados de um intervalo (nacionais + banco).
- `lib/timesheet-calculo.ts`: cálculo puro de um dia e do ciclo, em minutos.
- `lib/timesheet.ts`: habilitação, liberação, validação de entrada e auditoria.
- `app/api/colaborador/timesheet/`: GET da folha e PUT de um dia (sessão COLABORADOR), mais o POST de envio.
- `app/api/admin/timesheet/`: lista do ciclo, detalhe, reabrir, configuração, liberação, exportação XLSX e feriados (`requireAdmin`).
- UI: nova aba "Timesheet" no portal (`components/colaborador-app.tsx`) e novo painel "Timesheet" da medição, com lista, detalhe, calendário de feriados e configuração. A página de impressão serve o PDF.

## Estilo de código
Siga o CLAUDE.md:
- TypeScript estrito, sem `any`. Use os tipos gerados pelo Prisma.
- Validação manual na borda, porque o projeto não tem biblioteca de validação.
- Componentes HeroUI e classes Tailwind. Reuse `Modal`, os painéis e as tabelas existentes.
- Server Components por padrão.
- Na UI, use a skill UI/UX Pro Max.

## Estratégia de testes
- **Unidade (`tests/`, `tsx --test`):**
  - Páscoa de anos conhecidos e lista nacional de 2026.
  - Cálculo com os casos da planilha: dia útil 08–12/13–17 = 8h HN; saída às 20:00 = 5h HN + 3h HE 50%; sábado; domingo; feriado; sábado-feriado = só 100%; tarde depois das 17:00; dia vazio; só manhã.
  - Validação de ordem e de pares.
- **Rotas com banco:**
  - Fornecedor A não lê nem grava a folha de B. Não-ATO desabilitado recebe 403/404.
  - Dia futuro bloqueado em `DIA_A_DIA`. Folha `ENVIADA` recusa gravação.
  - Só a medição reabre, configura, cadastra feriado e exporta. COLABORADOR, FINANCEIRO e ADMINISTRATIVO recebem 403.
  - A auditoria é gravada junto com a mudança.
- **E2E (Playwright):**
  - O fornecedor ATO preenche alguns dias, vê os totais e envia.
  - A medição vê a folha como "Enviada", com o último preenchimento; cadastra um feriado e vê o total recalculado; reabre; baixa o XLSX.
  - Outro fornecedor não vê a aba ou não vê a folha.

## Fronteiras
- **Sempre:**
  - Sessão e perfil validados no servidor em toda rota.
  - Fornecedor identificado só pela sessão.
  - Auditoria na mesma transação.
  - Nova migration.
  - `tsc` e `test:targeted` passando antes de concluir.
- **Perguntar antes:**
  - Qualquer dependência nova (ex.: uma biblioteca de PDF, se a impressão do navegador não bastar).
  - Mudar o cálculo além das duas correções acima.
  - Commit, push e deploy.
- **Nunca:**
  - Expor a folha ou os logs de um fornecedor a outro.
  - Usar float em dinheiro (aqui só há minutos inteiros).
  - Alterar migrations aplicadas.
  - Mexer no BM ou na medição nesta fase.

## Critérios de sucesso
1. O fornecedor ATO vê a aba Timesheet com os dias 21→20 do ciclo ativo e os feriados marcados. Ele preenche os horários e textos e vê HN, HE 50%, HE 100% e o total por dia e no ciclo, iguais à planilha (com as duas correções).
2. A liberação `DIA_A_DIA` bloqueia os dias futuros no servidor, e `CICLO` libera todos.
3. Depois do envio, o fornecedor não altera mais nada. A medição reabre, e o reenvio volta a funcionar.
4. A medição vê a lista dos fornecedores habilitados no ciclo, com o status e o último preenchimento (data e hora), e abre a folha e o histórico de auditoria de cada um.
5. A medição habilita ou desabilita um fornecedor e configura o cabeçalho, e isso aparece na folha e na exportação.
6. Os feriados nacionais aparecem sozinhos. A medição cria e exclui feriados estaduais e municipais pelo calendário do ciclo, e o cálculo reflete isso.
7. A medição baixa o XLSX e imprime o PDF da folha de um fornecedor.
8. Um fornecedor nunca vê a folha de outro (teste de rota e E2E).
9. `npx tsc --noEmit`, `npm run test:targeted` e o E2E novo passam.

## Decisões das dúvidas (aprovadas em 2026-10-21)
- **Ciclo de lançamento (achado do /review, 2026-10-21):** o fornecedor só grava e envia no ciclo em andamento, que é o ciclo ativo da medição (`getCicloAtivoMedicao`). Um ciclo passado responde 403, porque a folha já foi exportada e enviada ao gestor. A medição continua lendo, reabrindo e exportando qualquer ciclo. Limite: uma folha reaberta de um ciclo passado não é alcançável pelo fornecedor; para isso a medição precisa voltar o ciclo ativo.
1. A liberação (`DIA_A_DIA` ou `CICLO`) vale por ciclo, para todos os fornecedores. A sobrescrita por fornecedor fica para depois.
2. A folha `ENVIADA` é recalculada sempre (sem congelar totais). O painel avisa quando um feriado cadastrado depois do envio cai no período dela.
3. O corte da HE 50% é 17:00 fixo para todos os contratos.
4. O cabeçalho usa "Contratada: Projeta Consultoria" fixo, e o "Visto fiscalização da VALE" vem de `Contrato.fiscal`.
