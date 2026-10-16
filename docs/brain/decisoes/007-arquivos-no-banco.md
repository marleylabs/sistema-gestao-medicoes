---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 007 Arquivos (NF, comprovante, conferência, anexos) no banco

**Contexto:** o deploy é um único host Docker, sem storage de objetos.

**Decisão:** guardar os arquivos como `Bytes` (bytea) nas próprias linhas (`SgcAprovacaoMedicao`, `ChatMensagem`, avatar em `Usuario`), validando o tipo por magic bytes (`lib/file-security.ts`). Registrada retroativamente.

**Alternativas descartadas:** sistema de arquivos ou S3 (backup separado e mais infra).

**Consequências:** o backup do Postgres inclui os arquivos, mas o banco cresce. Use `select` sem os campos de bytes nas listagens.
