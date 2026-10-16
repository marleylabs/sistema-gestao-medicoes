---
atualizado: 2026-10-16
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
- Uma medição pendente fica com `idProfissional` nulo e `identidadeImportacaoId` preenchido; o envio do BM fica bloqueado.
- Listar: MEDICAO/ADMIN. Resolver: só ADMIN.

**Depende de:** [ETL](etl.md)
