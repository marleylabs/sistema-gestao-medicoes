---
atualizado: 2026-10-16
tags: [modulo]
---
# Conferência e divergências

**O que faz:** compara a planilha enviada pelo fornecedor com os documentos da equipe e registra as divergências para a equipe resolver.

**Onde está:** `lib/conferencia-*.ts`, `app/api/colaborador/conferencia/`, `app/api/admin/conferencia/`, `components/divergencias/`

**Arquivos-chave:**
- `lib/conferencia-medicao.ts`: lê a planilha (.xlsx, máx. 5 MB) e compara por NR VALE normalizado.
- `lib/conferencia-resolucao.ts`: Incluir (atualiza ou cria a `Medicao` da equipe) e Descartar (exige observação).
- `lib/divergencia-comparacao.ts`: agrupamento para exibição.
- `app/api/colaborador/conferencia/mascara`: modelo da planilha para o fornecedor.

**Regras e armadilhas:**
- A comparação é unilateral: documento que só a equipe tem não gera divergência.
- Números são comparados com tolerância de 0,0005.
- Sem divergências pendentes, `statusConferencia` volta a CONCLUIDA.
- Incluir/Descartar rodam em transação, mas o `SgcLog` é gravado depois dela.
- A observação do Descartar aparece para o fornecedor. O portal nunca mostra a palavra "Divergência" (`lib/portal-fornecedor.ts`).

**Depende de:** [Envio do BM](envio-bm.md)
