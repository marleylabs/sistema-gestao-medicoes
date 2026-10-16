---
atualizado: 2026-10-16
tags: [modulo]
---
# ETL de planilhas

**O que faz:** carrega a planilha de medição de um ciclo (abas Documentos/Geral, Base, MAPA PAGTO opcional e Documentos Auxiliares) no PostgreSQL.

**Onde está:** `etl/`, `pages/api/admin/etl.ts` (proxy autenticado, MEDICAO/ADMIN)

**Arquivos-chave:**
- `etl/server.py`: serviço HTTP (porta 4000). `POST /run` responde 202 e roda em thread; uma execução por vez (409 se ocupado), watchdog de 30 min. Também `GET /status` e `/health`.
- `etl/ingest_medicoes.py`: leitura, preflight de identidades, limpeza e upserts. Também tem um CLI.
- `etl/diagnose_identities.py`: diagnóstico read-only das identidades de uma planilha.
- `etl/test_*.py`: testes do ETL.

**Regras e armadilhas:**
- O preflight não grava nada: com identidade estrutural inválida ou ambígua, aborta antes de escrever. Identidades excluídas falham fechado.
- Uma linha PENDENTE é carregada sem profissional ([Identidades](identidades-importacao.md)).
- **Reimportação e BM** ([decisão 010](../decisoes/010-reimportacao-preserva-bm.md)):
  - **BM bloqueado** (`STATUS_BM_BLOQUEADO`: AGUARDANDO_NF, APROVADO, PAGO). É travado com `FOR UPDATE` no início da transação. Nada dele é apagado ou regravado: BM, NF, comprovante, trilha, medições, linha do mapa (incluindo o REV manual) e BM AUX. Isso vale mesmo para fornecedor ausente da planilha ou que só casa por nome parecido.
  - **Divergência com a planilha:** vai para o resultado (`bms_preservados`, `divergencias_bm_bloqueado`) e aparece na tela de importação (`components/medicoes-app.tsx`). A comparação é por conteúdo do documento, não por `source_row_hash`, que muda quando as linhas são reordenadas.
  - **BM não aprovado** (PENDENTE, REVISAO_SOLICITADA): é apagado e volta para "a enviar", como antes. Antes de apagar, a limpeza trava os BMs (`FOR UPDATE`) e relê o status. Se algum foi aprovado depois da trava inicial, a importação aborta com `ValueError`, que vira um erro de validação no `server.py`.
  - **Teste:** `etl/test_reimport_preserves_bm.py` cobre a aba Documentos com o mapa gerado, a aba MAPA PAGTO explícita, a aba Documentos Auxiliares, a atomicidade e a aprovação concorrente.
- **Limpeza por nome aproximado:** a limpeza dos demais fornecedores ainda casa por nome aproximado (`same_person_name`).
- **Uma transação:** trava, limpeza, carga e comparação rodam num único `engine.begin()`. Os passos anteriores só leem.
- `status_colaborador` é recalculado só para os fornecedores presentes no arquivo.
- O ETL não cria nem altera tabelas: o schema Prisma é a fonte da verdade.
- Ninguém grava em `etl_execucoes` (só há exclusões no app).

**Depende de:** [Identidades](identidades-importacao.md), [Mapa de pagamento](mapa-pagamento.md)
