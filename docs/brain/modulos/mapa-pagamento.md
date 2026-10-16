---
atualizado: 2026-10-16
tags: [modulo]
---
# Mapa de pagamento

**O que faz:** guarda as linhas de pagamento por fornecedor e ciclo (valor, REV, rateio por contrato) e o contexto do ciclo.

**Onde está:** `lib/mapa-pagamento*.ts`, `app/api/mapa-pagamento/`, `components/mapa-pagamento-table.tsx`

**Arquivos-chave:**
- `lib/mapa-pagamento.ts`: leitura e edição das linhas.
- `lib/mapa-pagamento-cadastro.ts`: liga as linhas ao cadastro do fornecedor.
- Modelos: `MapaPagamentoContexto` (um por ciclo, com `ativoMedicao`) e `MapaPagamentoItem`.

**Regras e armadilhas:**
- `projetistaCodigo` é resolvido para o código canônico, porque as buscas seguintes usam igualdade exata.
- Identidades excluídas são rejeitadas.
- Sem a aba MAPA PAGTO na planilha, o ETL gera o contexto a partir das medições.
- Acesso: MEDICAO/ADMIN.

**Depende de:** [ETL](etl.md), [Identidades](identidades-importacao.md)
