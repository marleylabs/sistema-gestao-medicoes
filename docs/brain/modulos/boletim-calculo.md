---
atualizado: 2026-10-16
tags: [modulo]
---
# Boletim (cálculo do BM)

**O que faz:** calcula o total do BM de um fornecedor: condição fixa + acréscimos fixos + documentos medidos − descontos, e o valor a pagar (total + REV).

**Onde está:** `lib/boletim-calculo.ts`, `lib/condicao-fixa*.ts`, `lib/fonte-medicao.ts`, `app/api/admin/bm/`, `components/boletim-*.tsx`

**Arquivos-chave:**
- `lib/boletim-calculo.ts`: fonte única dos valores para a equipe e para o portal.
- `lib/condicao-fixa.ts` / `condicao-fixa-server.ts`: FIXA ou CONDICIONAL_PRODUCAO (vale só se o ciclo tem documentos com total > 0).
- `lib/fonte-medicao.ts`: DOCUMENTOS ou DOCUMENTOS_AUXILIARES.
- `lib/documentos-medidos.ts`: consulta compartilhada dos documentos do fornecedor.

**Regras e armadilhas:**
- O cálculo usa `number` arredondado a centavos (`toNumber` em `lib/format.ts`), contrariando a regra "Decimal de ponta a ponta" do CLAUDE.md.
- Um valor ausente aparece como "Não informado", nunca R$ 0.
- Na leitura, um valor desconhecido de condição/fonte cai no default; na escrita, é rejeitado.
- Testes: `tests/bm-calculo-consistencia.test.ts`.

**Depende de:** [Mapa de pagamento](mapa-pagamento.md)
