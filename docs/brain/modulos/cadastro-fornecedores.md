---
atualizado: 2026-10-16
tags: [modulo]
---
# Cadastro de fornecedores (Administrativo)

**O que faz:** importa a Consulta PJ, mantém o `CadastroFornecedor` e cuida de primeiro acesso, inativação e exclusão definitiva.

**Onde está:** `lib/cadastro-fornecedor.ts`, `app/api/admin/administrativo/`, `components/administrativo/`, `components/administrativo-panel.tsx`

**Arquivos-chave:**
- `lib/cadastro-fornecedor.ts` (~2200 linhas): lê a planilha (aba `CONTRATOS_ATIVOS`), resolve a identidade (`resolveFornecedorIdentity`: CREATE/CONFLICT/REQUIRES_REVIEW/RECREATE_FROM_HISTORY), faz o upsert, inativa e exclui.
- `lib/fornecedor-inativo.ts`: "inativo" quando o fornecedor tem cadastros e nenhum está ativo. A chave é `codigo || nome`.
- `components/administrativo/primeiro-acesso-lote-dialog.tsx`: primeiro acesso em lote.

**Regras e armadilhas:**
- Acesso por `requireAdministrativo`. Status, exclusão em lote e resolução de identidade são só para ADMIN.
- O CNPJ não é identidade nem tem UNIQUE: cadastros diferentes podem compartilhar CNPJ.
- O mesmo nome com 2 ou mais sinais contraditórios (e-mail, telefone, razão social) vira CONFLICT.
- A inativação só desativa o usuário se não houver outro cadastro ativo com o mesmo código.
- Exclusão definitiva: ver [008](../decisoes/008-exclusao-definitiva-preserva-historico.md). `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md` está desatualizado em relação ao código.
- `Profissional.statusColaborador` tem um CHECK (ATO, PRODUÇÃO ou NULL) que não aparece no Prisma.

**Depende de:** [Identidades](identidades-importacao.md), [Autenticação](autenticacao.md)
