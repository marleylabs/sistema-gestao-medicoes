---
atualizado: 2026-10-16
tags: [modulo]
---
# Financeiro (NF e pagamento)

**O que faz:** recebe e valida a NF do fornecedor, lista os BMs a pagar e registra o pagamento com comprovante.

**Onde está:** `app/api/colaborador/nf/`, `app/api/admin/financeiro/`, `app/api/admin/nf/`, `components/financeiro*`

**Arquivos-chave:**
- `lib/nf-document-validation.ts`: aceita só PDF com texto pesquisável, até 10 MB. Confere o CNPJ do prestador com o cadastro e o tomador com o CNPJ e a razão social da Projeta (fixos no código).
- `app/api/admin/financeiro/route.ts`: GET lista AGUARDANDO_NF, APROVADO e PAGO. POST faz APROVADO → PAGO. PATCH faz VOLTAR_BM (só MEDICAO/ADMIN).
- `app/api/admin/financeiro/exportar`: exportação (`requireFinanceiro`).
- `components/pagamento-editor.tsx`: edição de pagamento.

**Regras e armadilhas:**
- A NF e o comprovante ficam em `Bytes` na própria linha do BM ([007](../decisoes/007-arquivos-no-banco.md)).
- `requireFinanceiro` também libera MEDICAO, ADMIN e ADMINISTRATIVO.
- Os downloads de NF e comprovante do fornecedor devolvem 403 se o BM não for dele.

**Depende de:** [Envio do BM](envio-bm.md), [E-mail](email.md)
