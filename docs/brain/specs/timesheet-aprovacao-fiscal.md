---
atualizado: 2026-10-22
tags: [spec]
---
# Timesheet: aprovação das horas pelo fiscal

## Objetivo
O fiscal do contrato (cliente) aprova ou reprova as horas de cada dia da folha de timesheet dos fornecedores ATO do contrato dele, uma linha ou várias de uma vez. A equipe de medição acompanha as decisões, mas não aprova nem reprova.

## Regras (aprovadas pelo usuário em 2026-10-22)
1. **Perfil FISCAL.** Novo perfil de usuário, externo, com login P0 (como os demais usuários). Cadastro numa aba "Fiscais" do Administrativo, ao lado de Funcionários, com nome e e-mail; o acesso é enviado pelo mesmo fluxo de primeiro acesso (senha temporária por e-mail).
2. **Escopo pelo contrato.** No cadastro do contrato, o fiscal passa a ser escolhido entre os fiscais cadastrados. O fiscal vê só os fornecedores com timesheet habilitado cujo contrato (configuração do timesheet) tem ele como fiscal. Qualquer outro fornecedor responde 404.
3. **Quando.** O fiscal decide a qualquer momento, com a folha aberta ou enviada, mas só em dias com horas lançadas.
4. **Decisão por dia.** Cada dia lançado fica Pendente, Aprovado ou Reprovado. Reprovar exige motivo (um texto para todos os dias reprovados de uma vez). Decisões em lote: o fiscal seleciona várias linhas e aprova ou reprova todas.
5. **Correção.** Se o fornecedor altera um dia (folha aberta ou reaberta pela medição), a decisão daquele dia volta a Pendente. Dias não alterados mantêm a decisão.
6. **Permissões.** Só o FISCAL do contrato decide. Medição, ADMIN e o fornecedor veem a coluna de aprovação, mas sem ação. O fiscal não acessa Feriados, publicação de ciclo, liberação do preenchimento (Dia a dia / Ciclo todo), configuração, reabertura nem o restante do sistema.
7. **Auditoria.** Cada lote grava `TIMESHEET_DIAS_APROVADOS` ou `TIMESHEET_DIAS_REPROVADOS` (`targetType` `TIMESHEET_FOLHA`, com as datas e o motivo) na mesma transação da decisão.

## Tela do fiscal
- Entra direto no Timesheet: lista dos fornecedores dele no ciclo (busca, status, contagem de dias pendentes), seletor de ciclo e a folha de cada um.
- Na folha, uma coluna "Aprovação" ao lado de Solicitante com o estado de cada dia, caixas de seleção e uma barra com "Aprovar" e "Reprovar" para as linhas marcadas.

## Fora do escopo
- Exportação (XLSX/PDF) pelo fiscal e aprovação da folha inteira como um ato à parte; lançamento das horas aprovadas no BM.

## Segurança (achado no mapeamento)
Várias checagens tratam "não é COLABORADOR" como equipe interna. Com o perfil FISCAL, elas viram allowlist dos perfis internos: download de NF e de comprovante (`app/api/colaborador/nf/[id]`, `app/api/colaborador/comprovante/[id]`), chat (`canUseChatPerfil`), troca do próprio nome (`podeAlterarProprioNome`), `INTERNAL_PERFIS` e o roteamento da raiz (`app/page.tsx` manda o FISCAL para a tela própria, nunca para o app da medição).

## Plano
1. Perfil FISCAL: `lib/perfis.ts`, migration do CHECK de `usuarios.perfil`, e-mail obrigatório, as brechas acima, `set_perfil`.
2. Cadastro: aba "Fiscais" no Administrativo (nome, e-mail, ativo; enviar primeiro acesso), rotas em `app/api/admin/administrativo/fiscais` com `requireAdministrativo`, reusando `criarUsuarioInterno` e `rotateAndSendFirstAccess`. A aba Funcionários deixa de listar fiscais.
3. Contrato: `Contrato.fiscalId` (FK para o usuário FISCAL, `SET NULL`); o formulário escolhe entre os fiscais ativos; o nome exibido na folha vem do usuário (texto antigo como fallback).
4. Aprovação: campos de aprovação em `TimesheetDia`; `salvarDia` zera a decisão quando o dia muda; `lib/timesheet-fiscal.ts` com escopo, lista, folha e decisão em lote, com auditoria; rotas `app/api/fiscal/timesheet/*` com `requireFiscal`.
5. Tela: `FiscalApp` (só Timesheet), lista e folha com seleção e barra Aprovar/Reprovar; coluna "Aprovação" só leitura para medição e fornecedor.
6. Testes: unitários (escopo, regras, zerar ao editar, guardas das rotas, brechas fechadas) e E2E (fiscal aprova e reprova em lote; medição vê sem ação).
