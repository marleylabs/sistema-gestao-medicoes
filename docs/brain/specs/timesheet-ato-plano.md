---
atualizado: 2026-10-21
tags: [plano]
status: concluído em 2026-10-21 (commit e94c195)
---
# Plano: Timesheet ATO

Spec: [timesheet-ato.md](timesheet-ato.md) (aprovada em 2026-10-21). As tarefas são fatias verticais: cada uma termina com algo testável. Há quatro checkpoints, e em cada um eu paro para você conferir antes de seguir.

## Decisões de implementação (tiradas do código)
- **Auditoria:**
  - Reusa `AdminAuditLog` em vez de criar uma tabela nova. O `adminId` não tem FK, então aceita também o usuário COLABORADOR como autor.
  - `targetType = "TIMESHEET_FOLHA"` e `targetId = id da folha`. As ações ficam com o prefixo `TIMESHEET_` (`TIMESHEET_DIA_SALVO`, `TIMESHEET_ENVIADA`, `TIMESHEET_REABERTA`, `TIMESHEET_EXPORTADA`, `TIMESHEET_CONFIG`, `TIMESHEET_LIBERACAO`, `FERIADO_CRIADO`, `FERIADO_EXCLUIDO`).
  - O antes/depois vai em `metadata`, e o registro é gravado com `tx.adminAuditLog.create` dentro do `prisma.$transaction`, como o código já faz.
- **Modelos novos:** `Feriado`, `TimesheetConfig` (1 por Profissional), `TimesheetCiclo` (1 por ciclo: liberação), `TimesheetFolha` (Profissional × ciclo: status, envio, reabertura) e `TimesheetDia` (Folha × data). Os horários ficam em `Int` (minutos).
- **"Hoje":**
  - A data é calculada com `Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })`.
  - O código atual usa `toISOString()` (UTC), que vira o dia às 21:00 de Brasília. Não usar isso aqui.
- **Calendário de feriados:**
  - Uma grade própria dos dias do ciclo (21→20), feita com Tailwind e botões HeroUI.
  - O projeto não usa o `Calendar` do HeroUI, que exigiria `@internationalized/date`, uma dependência nova.
- **XLSX:**
  - Usa `createWorkbookXlsx` (`lib/xlsx.ts`) do jeito que está. Ele não suporta células mescladas nem formato de hora, então as horas saem como texto `hh:mm`, como a spec previa.
  - O cabeçalho da folha sai em linhas de rótulo e valor acima da tabela (`headerRow`).
- **PDF:** página de impressão própria (Server Component com classes `print:` do Tailwind) e um botão que chama `window.print()`. Não reusa o `window.open` + `<style>` inline do boletim, porque o CLAUDE.md proíbe `style` inline.
- **Testes:**
  - A lógica fica em `lib/` com parâmetros explícitos e é testada direto no banco de teste (padrão de `tests/colaborador-alias.test.ts`).
  - As rotas recebem a checagem de guarda por regex no código-fonte, como em `tests/bm-envio-lote.test.ts`.
  - Os arquivos novos `tests/*.test.ts` entram sozinhos no `test:targeted`.
- **Seed E2E:** o seed atual não marca ninguém como ATO. O spec E2E cria o próprio fornecedor ATO e limpa no fim, no padrão de `e2e/portal-fornecedor-redesign.spec.ts`.

## Grafo de dependências
```
T1 schema ─┬─ T3 lib folha ── T4 rotas+aba portal ──┬─ T6 painel acompanhamento ── T8 XLSX ── T10 E2E medição + cérebro
T2 cálculo ┘                                       ├─ T5 feriados manuais          T9 PDF ─┘
                                                    └─ T7 configuração/cabeçalho
```

## Fase A: fundação

### T1. Schema e migration (concluída em 2026-10-21)
- **Feito:** migration `20261022010132_timesheet_ato`, que só cria tabelas, com CHECKs de domínio (abrangência, liberação, status, minutos 0–1439). FKs do Profissional em `RESTRICT`; `lib/ciclo-cleanup.ts` passou a preservar Profissional com config ou folha de timesheet, para a exclusão de ciclo não falhar.
- **Faz:** adiciona `Feriado`, `TimesheetConfig`, `TimesheetCiclo`, `TimesheetFolha` e `TimesheetDia` ao `prisma/schema.prisma` e cria a migration com `prisma migrate dev --name timesheet_ato`, no banco local de teste.
- **Uniques:** `Feriado.data`, `TimesheetConfig.profissionalId`, `TimesheetCiclo.ciclo`, `TimesheetFolha (profissionalId, ciclo)` e `TimesheetDia (folhaId, data)`.
- **Aceite:** `migrate diff` = 0 depois de aplicar; `prisma generate` ok; nenhuma migration antiga alterada.
- **Verificação:** `npx prisma migrate deploy` no `medicoes_e2e_bm` e `npx tsc --noEmit`.

### T2. Feriados nacionais e cálculo de horas (concluída em 2026-10-21)
- **Feito:** `lib/feriados.ts` e `lib/timesheet-calculo.ts` (`tipoDoDia`, `validarDia`, `calcularDia`, `somarHoras`). A HE 50% soma o tempo depois das 17:00 nos dois períodos (manhã e tarde), o que equivale à regra da spec quando a manhã termina antes das 17:00. Testes: `tests/feriados.test.ts` e `tests/timesheet-calculo.test.ts`.
- **Faz:**
  - `lib/feriados.ts`: `pascoa(ano)` e `feriadosNacionais(ano)`, com os 10 da lei (Sexta-feira Santa = Páscoa − 2).
  - `lib/timesheet-calculo.ts`: `validarDia` (pares completos e ordem `e1 < s1 ≤ e2 < s2`), `calcularDia(dia, tipo: UTIL | SABADO | DOMINGO_FERIADO)` → `{ hn, he50, he100, total }` em minutos, e `somarCiclo`.
- **Aceite:** todos os casos da tabela da spec, incluindo as duas correções (sábado-feriado só 100%; HE 50% = tempo depois das 17:00).
- **Verificação:** `tests/timesheet-calculo.test.ts` e `tests/feriados.test.ts`. Os casos são:
  - Páscoa de 2024 a 2027;
  - os 10 feriados de 2026;
  - dia útil 08–12/13–17 = 8h HN;
  - saída às 20:00 = 8h HN + 3h HE 50% (planilha, linha 12);
  - sábado, domingo, feriado e sábado-feriado;
  - tarde começando às 18:00;
  - dia só com a manhã, dia vazio e ordem inválida.

**Checkpoint 1:** schema e cálculo revisados por você antes de qualquer tela.

## Fase B: fornecedor preenche (fatia vertical completa)

### T3. Lógica da folha com banco (concluída em 2026-10-21)
- **Feito:** `lib/timesheet.ts`. A habilitação é checada antes da validação da entrada, então quem não tem timesheet recebe 404 em qualquer requisição. A gravação faz compare-and-swap na folha (`updateMany` com `status = ABERTA`), o que trava a linha até o fim da transação; o envio concorrente espera. Testes: `tests/timesheet.test.ts`.
- **Faz:** `lib/timesheet.ts` com estas funções:
  - `hojeSaoPaulo()`;
  - `isTimesheetHabilitado(profissional, config)`: a sobrescrita vale, senão `statusColaborador = 'ATO'`, e o `deletedAt` precisa ser nulo;
  - `feriadosDoPeriodo(inicio, fim)`: nacionais + banco;
  - `carregarFolha(profissionalId, ciclo)`: dias de `cicloToDates` com o tipo, o cálculo e os totais, mais o status e a liberação;
  - `salvarDia({ profissionalId, ciclo, data, valores, ator })`, que valida:
    - a data está no ciclo;
    - a folha não está `ENVIADA`;
    - em `DIA_A_DIA`, a data é ≤ hoje;
    - o par e a ordem dos horários estão certos;
    - os textos têm no máximo 200 caracteres.

    Faz upsert e grava a auditoria na mesma transação;
  - `enviarFolha(...)`, que muda o status e grava a auditoria na mesma transação.
- **Aceite:** recusa com erro tipado (que a rota converte em 400/403/409) para a data fora do ciclo, o dia futuro em `DIA_A_DIA`, a folha enviada e o fornecedor não habilitado.
- **Verificação:** `tests/timesheet.test.ts`, no banco de teste. Cobre:
  - salvar e ler;
  - o isolamento (a folha de A não aparece consultando por B);
  - o bloqueio de dia futuro, com "hoje" injetado;
  - a trava depois do envio;
  - a linha de auditoria criada na mesma transação (com rollback se a auditoria falhar).

### T4. Rotas do fornecedor e aba "Timesheet" no portal (concluída em 2026-10-21)
- **Feito:** rotas em `app/api/colaborador/timesheet/` e o campo `usuario.timesheetHabilitado` em `/api/colaborador/me`, que mostra ou esconde a aba. O componente fica em `components/timesheet/folha-timesheet.tsx`: a tabela é só leitura, e cada dia abre um diálogo (`PortalDialog`, agora exportado) com campos de hora nativos e o botão "Copiar do último dia preenchido". No celular, o botão do dia vem logo depois da coluna Dia. O seed E2E agora apaga o timesheet antes dos Profissionais (FK RESTRICT) e limpa o prefixo "E2E Timesheet". O guard do E2E aceita o 400 esperado de `PUT /api/colaborador/timesheet/dia`. E2E: `e2e/timesheet-fornecedor.spec.ts`.
- **Faz:**
  - Rotas em `app/api/colaborador/timesheet/`: `GET ?ciclo=` (padrão: `getCicloAtivoMedicao`), `PUT dia/` e `POST enviar/`.
  - Guarda das rotas: COLABORADOR, e o `profissionalId` vem só de `getColaboradorEscopo(user.usuario)`. Sem identidade única ou sem habilitação → 404.
  - Nova seção em `components/colaborador-app.tsx`: `Section`, `navItems` (oculto quando não habilitado), `TITLES` e o carregamento sob demanda.
  - Componente `components/timesheet/folha-timesheet.tsx`:
    - tabela dos dias com feriado/sábado/domingo destacados;
    - inputs de hora, salvos por linha;
    - totais por dia e do ciclo;
    - cabeçalho só para leitura;
    - "Enviar folha" com confirmação pelo `Modal`;
    - as linhas bloqueadas desabilitadas.
  - Skill UI/UX Pro Max.
- **Aceite:** critérios 1, 2, 3 (lado do fornecedor) e 8 da spec.
- **Verificação:**
  - teste de regex das guardas das rotas;
  - `e2e/timesheet-fornecedor.spec.ts`: o ATO preenche 2 dias, vê os totais, o dia futuro fica desabilitado, envia e as linhas ficam só leitura;
  - o fornecedor não-ATO não vê a aba;
  - um GET direto com outra sessão não traz a folha.

**Checkpoint 2:** você testa o portal no dev contra o banco de teste (porta 3100).

## Fase C: painel da medição

### T5. Feriados manuais e calendário (concluída em 2026-10-21)
- **Feito:** `lib/timesheet-medicao.ts` (`criarFeriado`, `excluirFeriado`) e as rotas `app/api/admin/timesheet/feriados/`. Nova seção "Timesheet" em `components/medicoes-app.tsx` (MEDICAO e ADMIN). A aba Feriados mostra a grade do ciclo (`components/timesheet/timesheet-workspace.tsx`): clicar numa data livre cadastra o feriado, e clicar num feriado manual o exclui; os nacionais ficam só para leitura. Um feriado duplicado ou que já é nacional dá 409.
- **Faz:**
  - Rotas `app/api/admin/timesheet/feriados/`, com `requireAdmin`:
    - GET do período do ciclo (nacionais + manuais);
    - POST `{ data, nome, abrangencia }`, que recusa data duplicada ou nacional;
    - DELETE `[id]`.
  - Todas com auditoria.
  - Nova seção "Timesheet" em `components/medicoes-app.tsx`: `Section`, `TITLES`, `VALID_SECTIONS` e `navItems` de MEDICAO e ADMIN.
  - A seção abre com a aba "Feriados": a grade 21→20, a lista do ciclo e o modal para criar ou excluir.
- **Aceite:** critério 6.
- **Verificação:** testes de lib e banco (duplicado, nacional recusado, auditoria); regex de `requireAdmin`.

### T6. Acompanhamento, liberação e reabertura (concluída em 2026-10-21)
- **Feito:**
  - `listarFolhasDoCiclo` lista os habilitados e também quem tem folha no ciclo, mesmo que tenha sido desabilitado depois (aparece marcado como "Desabilitado").
  - O aviso `feriadoAposEnvio` aparece quando um feriado manual foi criado depois do envio.
  - Também foram feitos `historicoDaFolha`, `reabrirFolha` (compare-and-swap `ENVIADA → ABERTA`) e `definirLiberacao`.
  - A gaveta `components/timesheet/timesheet-drawer.tsx` tem as abas Folha (só leitura, reusa `TabelaDiasTimesheet` e `TotaisTimesheet`), Histórico e Configuração.
  - `carregarFolha(..., { paraMedicao: true })` lê a folha sem exigir habilitação.
- **Faz:**
  - `GET app/api/admin/timesheet?ciclo=`: lista os habilitados com status (Não iniciada / Em preenchimento / Enviada), dias preenchidos, último preenchimento e totais.
  - `GET [profissionalId]?ciclo=`: folha + histórico de auditoria.
  - `PATCH ciclo/`: liberação `DIA_A_DIA` ou `CICLO`.
  - `POST [profissionalId]/reabrir`.
  - Todas com auditoria.
  - UI:
    - aba "Acompanhamento", com tabela, filtro por status e o seletor de liberação do ciclo;
    - painel lateral com a folha só para leitura, o histórico e o botão Reabrir;
    - aviso quando houver feriado criado depois do envio no período da folha.
- **Aceite:** critérios 3 (lado da medição) e 4.
- **Verificação:** testes no banco (a lista só traz os habilitados, reabrir volta a `ABERTA` e permite salvar, liberação `CICLO` libera os dias futuros, perfis FINANCEIRO e ADMINISTRATIVO são recusados pela guarda); regex de guarda.

### T7. Configuração por fornecedor (habilitação e cabeçalho) (concluída em 2026-10-21)
- **Feito:** `getConfig` e `salvarConfig`, que valida contrato, UUID e textos e grava a auditoria `TIMESHEET_CONFIG` com `targetType = PROFISSIONAL`. "Habilitar fornecedor" busca em `/api/profissionais` e abre a aba Configuração da gaveta. Ali a habilitação tem três estados: seguir o status ATO, habilitado ou desabilitado. Testes: `tests/timesheet-medicao.test.ts`, que também confere `requireAdmin` em todas as rotas `app/api/admin/timesheet/**`.
- **Faz:**
  - `PUT app/api/admin/timesheet/[profissionalId]/config` grava a sobrescrita da habilitação, o contrato, a função, o item da PQ, o local, a área, o nº da SE e o doc. nº, com auditoria.
  - No painel lateral, uma aba "Configuração".
  - Na lista, um botão "Habilitar fornecedor" para buscar um não-ATO.
  - O cabeçalho da folha (portal e painel) passa a usar a configuração, mais `Contrato.codigo` e `Contrato.fiscal`.
- **Aceite:** critério 5.
- **Verificação:** testes no banco (desabilitar oculta do portal e mantém os dados; habilitar um não-ATO aparece).

**Checkpoint 3:** você testa o painel da medição.

## Fase D: exportação e fechamento

### T8. Exportação XLSX (concluída em 2026-10-21)
- **Feito:** `lib/timesheet-export.ts` (`planilhaTimesheet`, com cabeçalho, uma linha por dia, TOTAL e assinaturas) e a rota `GET app/api/admin/timesheet/[profissionalId]/xlsx`, que grava a auditoria `TIMESHEET_EXPORTADA`. O teste lê o arquivo de volta com `parseSimpleXlsx`.
- **Faz:**
  - `GET app/api/admin/timesheet/[profissionalId]/xlsx?ciclo=`, com `requireAdmin`.
  - Monta a planilha com `createWorkbookXlsx`:
    - linhas de cabeçalho;
    - a tabela de dias com as colunas da folha;
    - a linha TOTAL;
    - os campos de assinatura e de visto da fiscalização.
  - Grava a auditoria `TIMESHEET_EXPORTADA`. O nome do arquivo segue `safeFilename`.
- **Aceite:** critério 7 (XLSX).
- **Verificação:** teste que gera a planilha e a lê de volta com `parseSimpleXlsx`, conferindo as datas e os totais.

### T9. PDF pela impressão (concluída em 2026-10-21)
- **Feito:** a página `app/timesheet/imprimir/[profissionalId]/page.tsx` fica preto no branco nos dois temas (exceção registrada em `tests/tema-tokens.test.ts`, como o boletim), com o botão `components/timesheet/botao-imprimir.tsx`. Ela também grava a auditoria `TIMESHEET_EXPORTADA` com o formato PDF. A orientação paisagem é escolhida no diálogo de impressão, porque não há CSS de `@page`.
- **Faz:**
  - Página `app/timesheet/imprimir/[profissionalId]/page.tsx`: Server Component que valida a sessão (MEDICAO/ADMIN) e renderiza a folha em A4 paisagem com as classes `print:`.
  - Botão "Imprimir / Salvar PDF" no painel lateral.
- **Aceite:** critério 7 (PDF).
- **Verificação:** E2E abre a página e confere o cabeçalho e os totais; um COLABORADOR que acessa a página recebe redirect ou 404.

### T10. E2E da medição, revisão e cérebro (concluída em 2026-10-21)
- **Feito:** `e2e/timesheet-medicao.spec.ts` (acompanhamento e histórico, feriado com aviso, XLSX e impressão, reabrir). O `/review` teve um achado obrigatório, já corrigido: o fornecedor gravava em qualquer ciclo; agora só no ciclo em andamento. Também foram tratados:
  - o retry da primeira gravação concorrente (P2002);
  - o dia em branco, que não conta para o envio;
  - o índice `idx_admin_audit_logs_target` (migration `20261022021306_timesheet_audit_index`);
  - uma consulta a menos de feriados e uma a menos em `/api/colaborador/me`.
- **`/ponytail-review`:** helpers duplicados unificados (`erroDaApi`, `formatarData`, `diasDoCiclo`, `isoDate` e `isUuid`).
- **Ficou de fora, por decisão:**
  - não há aviso quando um feriado é *excluído* depois do envio;
  - as rotas do fornecedor usam o `getColaboradorEscopo` completo, mais caro do que precisariam;
  - o ciclo do portal segue o ciclo ativo da medição, não o calendário.
- **Faz:**
  - `e2e/timesheet-medicao.spec.ts`: a medição vê a folha enviada com o último preenchimento; cria um feriado num dia preenchido e o total migra para HE 100%; reabre; o fornecedor salva de novo; baixa o XLSX.
  - `/review` e `/ponytail-review` do diff.
  - Cérebro:
    - nota `modulos/timesheet.md`;
    - status;
    - índice;
    - decisão nova, se o reuso do `AdminAuditLog` ou o cálculo em leitura merecerem ADR.
- **Aceite:** critério 9.
- **Verificação:** `npx tsc --noEmit`, `npm run test:targeted` e `npm run test:e2e` completo (com `test:e2e:seed` antes).

**Checkpoint 4:** entrega. Commit, push e deploy só com pedido seu. O deploy tem migration, então precisa de backup e de imagens de rollback.

## Riscos
- **Migration na produção:** é a primeira migration desde a P2, e o deploy precisa de `migrate deploy` com backup antes. Ela só cria tabelas novas, sem alterar dados.
- **`statusColaborador` vazio:** pode estar vazio em boa parte da produção (uma nota antiga fala em 100% NULL). Se estiver, ninguém fica habilitado por padrão, e a T7 (habilitar manualmente) passa a ser obrigatória antes do uso. Conferir com uma consulta só de leitura antes do deploy.
- **XLSX sem formatação:** o layout fica simples (sem mescla nem formato de hora). Se o gestor exigir o visual do modelo, estender o `lib/xlsx.ts` é uma tarefa à parte.
