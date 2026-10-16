---
data: 2026-09-03
status: aceita
tags: [decisao]
---
# 008 Exclusão definitiva de fornecedor preserva o histórico

**Contexto:** era preciso excluir fornecedores (LGPD/limpeza) sem perder medições, BMs e pagamentos já feitos.

**Decisão:** apagar fisicamente o `CadastroFornecedor`, fazer soft-delete do `Usuario` (o chat tem cascade) e tombstone + anonimização do `Profissional` (`deletedAt`, nome `EXCLUIDO-<uuid>`). A `Medicao` guarda um snapshot do nome. Tudo é auditado em `AdminAuditLog`. Lógica em `lib/cadastro-fornecedor.ts`.

**Alternativas descartadas:** exclusão física em cascata (perde histórico financeiro).

**Consequências:** o histórico (SGC, Medicao, Mapa, NF) nunca é tocado. Uma reimportação válida pode recriar a identidade (RECREATE_FROM_HISTORY). `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md` está desatualizado.
