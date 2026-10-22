---
atualizado: 2026-10-22
tags: [spec]
---
# Cadastro de contratos no Administrativo

## Objetivo
A configuração do timesheet diz que o nº e o fiscal "vêm do cadastro do contrato", mas não havia tela para cadastrar contratos: a tabela `contratos` existia, e o `ContratosPanel` antigo não estava em nenhuma tela. O cadastro passa a ser uma aba "Contratos" no Administrativo, ao lado de Fornecedores e Funcionários.

## Regras (aprovadas pelo usuário em 2026-10-22)
1. Campos: Nº do contrato (`codigo`), Nome do contrato (`nome`, obrigatório e único), Gestor, Fiscal, Início, Término e Valor contratual. O fiscal assina a folha do timesheet ("Visto fiscalização da VALE").
2. Cadastram e editam: Administrativo (perfil ou permissão extra), Medição e ADMIN (`requireContratos` em `lib/admin.ts`). O Financeiro não acessa.
3. Não há exclusão: o contrato sai de uso por inativação. Inativo some das escolhas do timesheet, mas mantém histórico, feriados e configurações. A rota `DELETE` foi removida (excluir apagava os feriados do contrato por `CASCADE`).
4. Valor contratual em `Decimal(18,2)` de ponta a ponta; a tela aceita "1.234,56" ou "1234.56". Término não pode ser anterior ao início.
5. Criar, editar, inativar e reativar gravam auditoria (`CONTRATO_CRIADO`, `CONTRATO_ATUALIZADO`, `CONTRATO_INATIVADO`, `CONTRATO_REATIVADO`; `targetType` `CONTRATO`) na mesma transação, com antes e depois.

## Como
- `lib/contratos-cadastro.ts`: validação, listagem, criação e atualização parcial.
- `app/api/admin/contratos/` (GET, POST) e `[id]` (PATCH).
- `components/administrativo/contratos.tsx`: tabela, filtros e painel lateral (`AdminSidePanel`), na aba do `components/administrativo-panel.tsx`.
- O `GET` mantém a criação dos 4 contratos padrão quando a tabela está vazia (`ensureContratosPadrao`).

## Fora do escopo
- Descrição e coluna do mapa (`descricao`, `coluna_mapa`) não aparecem na tela.
- A Medição não vê o menu Administrativo; ela edita contratos só pela API (a tela de escolha do timesheet só lê).

## Verificação
- `tests/contratos-cadastro.test.ts`: valor, validações, auditoria, guarda das rotas e ausência de DELETE.
- `e2e/contratos-administrativo.spec.ts`: o Administrativo cadastra, edita e inativa; a Medição lê; o Financeiro recebe 403.
