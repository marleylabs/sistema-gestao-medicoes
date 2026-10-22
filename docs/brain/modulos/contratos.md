---
atualizado: 2026-10-22
tags: [modulo]
---
# Contratos

**O que faz:** cadastra os contratos (aba Contratos do Administrativo) e calcula a participação de cada fornecedor por contrato a partir dos documentos medidos no ciclo.

**Onde está:** `lib/contratos.ts`, `lib/contratos-cadastro.ts`, `lib/participacao-contratos.ts`, `app/api/admin/contratos/`, `components/administrativo/contratos.tsx`

**Arquivos-chave:**
- `lib/contratos.ts`: cadastro automático de contratos (exceto em modo read-only).
- `lib/contratos-cadastro.ts`: cadastro pela tela (validação, `Decimal` no valor, auditoria). Ver [spec](../specs/contratos-cadastro.md).
- `lib/participacao-contratos.ts`: rateio por contrato.

**Regras e armadilhas:**
- `Contrato.nome` é único.
- O rateio do mapa usa colunas `Decimal(18,8)`.
- Não há exclusão pela API nem pela tela: o contrato é inativado. Um DELETE direto no banco ainda apagaria os feriados do timesheet dele (`CASCADE`) e o tiraria da configuração dos fornecedores. Ver [Timesheet ATO](timesheet.md).
- Quem edita: Administrativo, Medição e ADMIN (`requireContratos`). O Financeiro não acessa.
- O nº, o gestor e o fiscal vão para o cabeçalho e a assinatura da folha do timesheet.

**Depende de:** [Mapa de pagamento](mapa-pagamento.md)
