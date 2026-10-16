---
atualizado: 2026-10-16
tags: [modulo]
---
# Contratos

**O que faz:** cadastra os contratos e calcula a participação de cada fornecedor por contrato a partir dos documentos medidos no ciclo.

**Onde está:** `lib/contratos.ts`, `lib/participacao-contratos.ts`, `app/api/admin/contratos/`, `components/contratos-panel.tsx`

**Arquivos-chave:**
- `lib/contratos.ts`: CRUD e cadastro automático de contratos (exceto em modo read-only).
- `lib/participacao-contratos.ts`: rateio por contrato.

**Regras e armadilhas:**
- `Contrato.nome` é único.
- O rateio do mapa usa colunas `Decimal(18,8)`.

**Depende de:** [Mapa de pagamento](mapa-pagamento.md)
