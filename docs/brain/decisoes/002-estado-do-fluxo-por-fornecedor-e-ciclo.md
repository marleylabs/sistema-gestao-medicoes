---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 002 Estado do fluxo por fornecedor e ciclo (BM), não por medição

**Contexto:** o fornecedor aprova e é pago pelo conjunto do ciclo, não por documento.

**Decisão:** as linhas `Medicao` não têm status. O fluxo inteiro (envio, conferência, aprovação, NF, pagamento) vive em `SgcAprovacaoMedicao`, único por (colaboradorCodigo, ciclo), com `status` e `statusConferencia`, e a trilha fica em `SgcLog`. Registrada retroativamente a partir do código.

**Alternativas descartadas:** status por linha de medição (não reflete a aprovação em bloco).

**Consequências:** toda regra de fluxo consulta o BM. A reimportação do ciclo pelo ETL apaga o BM dos fornecedores presentes na planilha ([ETL](../modulos/etl.md)).
