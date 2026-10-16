---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 010 Reimportação de ciclo preserva BMs aprovados

**Contexto:** reimportar um ciclo em andamento apagava aprovação, NF e comprovante dos BMs dos fornecedores presentes na planilha (clear_imported_collaborators em etl/ingest_medicoes.py), causando perda de dados em produção.

**Decisão:** BM aprovado pelo fornecedor ou pago é imutável para a importação: status, valores, NF e comprovante são preservados. Divergência entre a planilha e um BM aprovado é reportada, nunca sobrescrita. BMs não aprovados são atualizados normalmente. A importação roda em uma transação.

**Alternativas descartadas:** bloquear o ciclo inteiro (impediria incluir e corrigir outros fornecedores); reabrir BMs alterados (a aprovação do fornecedor já representa concordância com os valores).

**Consequências:** correção de valor em BM já aprovado deixa de ser possível pela planilha e passa a exigir um fluxo manual, ainda a definir.