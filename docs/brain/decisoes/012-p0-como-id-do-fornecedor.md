---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 012 P0 como único ID do fornecedor

**Contexto:**
- O fornecedor tinha dois identificadores. Um é o P0 do login (`generateUniqueInternalAccessCode`, `lib/auth.ts`). O outro é o `Profissional.codigo`: para fornecedor novo, o nome normalizado do responsável. É esse segundo código que fica gravado no cadastro, nos BMs, no mapa, nas divergências e nos logs.
- O que ligava os dois era o nome do usuário. Um homônimo bloqueava o acesso, e o nome não podia mudar ([decisão 011](011-nome-do-fornecedor-so-pelo-administrativo.md)).
- O CNPJ já tinha sido tentado como ID e falhou, porque fornecedores antigos compartilhavam CNPJ ([decisão 003](003-identidade-por-codigo-e-alias.md)).

**Decisão:**
- O P0 é o único ID do fornecedor: `Usuario.usuario = Profissional.codigo = CadastroFornecedor.colaboradorCodigo`, e é o código gravado nas tabelas de dados.
- O código antigo vira `ProfissionalAlias` (origem `MIGRACAO_P0`), só para a planilha continuar resolvendo pelo nome.
- Fornecedor novo recebe o P0 como código já na criação.
- Nenhuma busca liga usuário e fornecedor por nome.
- Profissional sem login não recebe P0.

Detalhes: [spec](../specs/p2-vinculo-login-profissional.md).

**Alternativas descartadas:**
- campo `Usuario.profissionalId`;
- login como alias;
- CNPJ.

As duas primeiras criam um segundo vínculo, e o CNPJ não é único.

**Consequências:**
- Exige uma migração de dados única: troca de chave em BM, mapa, divergência, BM auxiliar, logs e cadastro, inclusive em BM aprovado ou pago, sem mudar valores nem status. Roda em janela sem importação, com backup.
- `admin_audit_logs` guarda o código da época.
- A decisão 011 continua valendo até ser revista.
