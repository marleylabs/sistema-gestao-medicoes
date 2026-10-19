---
atualizado: 2026-10-17
tags: [modulo]
---
# Cadastro de fornecedores (Administrativo)

**O que faz:** importa a Consulta PJ, mantém o `CadastroFornecedor` e cuida de primeiro acesso, inativação e exclusão definitiva.

**Onde está:** `lib/cadastro-fornecedor.ts`, `app/api/admin/administrativo/`, `components/administrativo/`, `components/administrativo-panel.tsx`

**Arquivos-chave:**
- `lib/cadastro-fornecedor.ts` (~2200 linhas): lê a planilha (aba `CONTRATOS_ATIVOS`), resolve a identidade (`resolveFornecedorIdentity`: CREATE/CONFLICT/REQUIRES_REVIEW/RECREATE_FROM_HISTORY), faz o upsert, inativa e exclui.
- `lib/fornecedor-inativo.ts`: "inativo" quando o fornecedor tem cadastros e nenhum está ativo. A chave é `codigo || nome`.
- `components/administrativo/primeiro-acesso-lote-dialog.tsx`: primeiro acesso em lote.
- `lib/codigo-p0.ts`: regras do P0 ([decisão 012](../decisoes/012-p0-como-id-do-fornecedor.md)):
  - `usuariosDoFornecedor`: o usuário do fornecedor é o do login igual ao código;
  - `trocarCodigoParaP0`: troca o código antigo pelo P0 em todas as tabelas, com alias e auditoria;
  - `gerarP0Livre`: gera um P0 novo que não colide com nenhum Profissional.
- `lib/migracao-codigo-p0.ts` + `scripts/migrar-codigo-p0.ts`: migração única dos fornecedores existentes para o P0 (dry-run, aplicar, medir, reverter).

**Regras e armadilhas:**
- Acesso por `requireAdministrativo`. Status, exclusão em lote e resolução de identidade são só para ADMIN.
- O CNPJ não é identidade nem tem UNIQUE: cadastros diferentes podem compartilhar CNPJ.
- O mesmo nome com 2 ou mais sinais contraditórios (e-mail, telefone, razão social) vira CONFLICT.
- **Fornecedor novo** (CREATE ou "Nenhuma dessas identidades") nasce com o P0 como login, `Profissional.codigo`, `Profissional.nome` e código do cadastro. O nome do responsável vira alias (origem `CADASTRO`) para a planilha resolver. Com homônimo, o nome fica ambíguo e a importação pede decisão do ADMIN.
- **Usuário do fornecedor**: em importação, inativação, exclusão definitiva e edição (`sincronizarUsuarioDoFornecedor`), é sempre o do login igual ao código. O nome só vale para identidade de antes do P0, e nunca acha o usuário de outro fornecedor já em P0.
- Reativar ou recriar uma identidade de antes do P0 passa o código para o P0 do login na mesma transação. O código antigo vira alias `MIGRACAO_P0`; o Profissional e o histórico continuam os mesmos.
- A listagem e o primeiro acesso em lote acham o acesso pelo código do cadastro (`findColaboradorUsuarios`), não pelo nome.
- Ficou de propósito: a exclusão definitiva recusa excluir cadastro antigo **sem código** quando existe Profissional ou usuário com o mesmo nome. Ela só bloqueia; não liga nada.
- A inativação só desativa o usuário se não houver outro cadastro ativo com o mesmo código.
- Exclusão definitiva: ver [008](../decisoes/008-exclusao-definitiva-preserva-historico.md). `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md` está desatualizado em relação ao código.
- `Profissional.statusColaborador` tem um CHECK (ATO, PRODUÇÃO ou NULL) que não aparece no Prisma.

**Depende de:** [Identidades](identidades-importacao.md), [Autenticação](autenticacao.md)
