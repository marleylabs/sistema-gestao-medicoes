---
atualizado: 2026-10-16
tags: [modulo]
---
# Envio e ciclo de vida do BM

**O que faz:** leva o BM de um fornecedor num ciclo do envio até o pagamento, gravando o estado em `SgcAprovacaoMedicao`.

**Onde está:** `lib/bm-envio*.ts`, `app/api/sgc/`, `app/api/colaborador/sgc/`, `app/api/colaborador/nf/`, `app/api/admin/financeiro/`

**Arquivos-chave:**
- `lib/bm-envio.ts`: envio individual (transação + `pg_advisory_xact_lock`). Também limpa as divergências da rodada anterior.
- `lib/bm-envio-elegibilidade.ts` / `bm-envio-selecao.ts`: quem pode receber o BM.
- `lib/bm-envio-lote.ts`: envio em lote sequencial (máx. 50, intervalo de 600 ms, aceita sucesso parcial).
- `lib/bm-log.ts`: grava `SgcLog`, a trilha do BM.
- `lib/sgc-display-status.ts`: status só de exibição (PENDENTE vira DIVERGENCIA/AGUARDANDO).

**Status (`status`):** AGUARDANDO_ENVIO → PENDENTE (equipe envia) → AGUARDANDO_NF (fornecedor aprova) → APROVADO (NF enviada) → PAGO (Financeiro).
- Desvios: PENDENTE → REVISAO_SOLICITADA (fornecedor) → PENDENTE (reenvio, `revisaoNumero`+1). VOLTAR_BM devolve para AGUARDANDO_ENVIO e é bloqueado se já houver NF. CANCELADO não é gravado pelo app.

**Regras e armadilhas:**
- O reenvio após revisão só é permitido se alguma linha do mapa mudou depois do pedido de revisão.
- Fornecedor com identidade pendente não recebe BM.
- Uma falha de e-mail não desfaz a transição.
- `logBmAction` engole erros e roda fora da transação, contrariando a regra "status + auditoria na mesma transação" do CLAUDE.md.
- Só o envio tem lock. As ações de NF, pagamento e do fornecedor não fazem compare-and-swap.
- O ENVIAR do fornecedor só aprova BM PENDENTE com `statusConferencia` CONCLUIDA. A regra fica em `podeAprovarBm` (`lib/portal-fornecedor.ts`), usada pela rota `app/api/colaborador/sgc` (409 caso contrário) e espelhada na UI.

**Depende de:** [Conferência](conferencia-divergencias.md), [Boletim](boletim-calculo.md), [Financeiro](financeiro.md), [E-mail](email.md)
