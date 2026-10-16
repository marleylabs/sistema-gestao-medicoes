---
data: 2026-10-02
status: aceita
tags: [decisao]
---
# 003 Identidade do fornecedor por código e alias, nunca por CNPJ

**Contexto:** as planilhas escrevem o mesmo fornecedor de várias formas, e CNPJs são compartilhados entre cadastros distintos.

**Decisão:** a identidade operacional é `Profissional.codigo` (ou o nome legado), mais aliases explícitos (`ProfissionalAlias`). Um nome sem vínculo vira identidade pendente (`ImportacaoIdentidade`), resolvida por ADMIN. O mesmo resolver existe em TS (`lib/profissional-identidade.ts`) e no ETL.

**Alternativas descartadas:** CNPJ como chave (não é único) e match aproximado (vínculo errado expõe dados de outro fornecedor).

**Consequências:** nunca usar CNPJ para isolar dados nem colocar UNIQUE nele. Os dois resolvers precisam ficar alinhados. Fornecedor com pendência não recebe BM.
