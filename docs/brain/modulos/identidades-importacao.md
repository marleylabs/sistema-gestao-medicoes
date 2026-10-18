---
atualizado: 2026-10-17
tags: [modulo]
---
# Identidades e aliases

**O que faz:** liga os nomes das planilhas a um `Profissional` canônico e trata as identidades pendentes de vínculo.

**Onde está:** `lib/profissional-identidade.ts`, `lib/identidade-*.ts`, `app/api/admin/importacao/identidades/`, `components/importacao/identidades-pendentes.tsx`

**Arquivos-chave:**
- `lib/profissional-identidade.ts`: `resolverIdentidadeOperacional` (código → alias ativo → nome legado sem código; com 2 ou mais resultados, AMBIGUO). Espelha o resolver do ETL.
- `lib/identidade-importacao.ts`: ciclo de vida da pendência (PENDENTE, VINCULADO, AUTO_VINCULADO, DESCARTADO). Vincular cria um alias global e reaponta as medições e o mapa do ciclo.
- `lib/identidade-plausivel.ts`: heurística "parece um nome" (só para exibição).
- `scripts/*-profissional-aliases.ts`, `scripts/audit-active-cadastro-identities.ts`: manutenção e auditoria.

**Regras e armadilhas:**
- Nunca cria um `Profissional`, nunca usa CNPJ e não faz match aproximado ([003](../decisoes/003-identidade-por-codigo-e-alias.md)).
- Com o P0 ([012](../decisoes/012-p0-como-id-do-fornecedor.md)), o código canônico é o login do fornecedor, e as planilhas, que trazem o nome, resolvem pelo alias:
  - origem `MIGRACAO_P0`: o código antigo, quase sempre o nome normalizado;
  - origem `CADASTRO`: o nome do responsável de fornecedor novo.
- O ETL não precisou mudar: grava o código canônico devolvido pelo resolver, que passa a ser o P0. A reimportação apaga as linhas do mapa do Profissional pelo código e pelo nome e regrava, então o `source_row_hash` novo não duplica.
- Uma medição pendente fica com `idProfissional` nulo e `identidadeImportacaoId` preenchido; o envio do BM fica bloqueado.
- Listar: MEDICAO/ADMIN. Resolver: só ADMIN.

**Depende de:** [ETL](etl.md)
