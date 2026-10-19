---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 011 Nome do fornecedor só pelo Administrativo

**Contexto:** não há vínculo explícito entre o login do fornecedor e o Profissional. A identidade da sessão vem do nome do usuário igual ao `responsavel` do cadastro (`lib/colaborador-alias.ts`, [spec do escopo](../specs/p1-escopo-fornecedor-por-identidade.md)). A revisão da P1 4 mostrou que o fornecedor podia trocar o próprio nome em `PATCH /api/usuario/me` para o de outro e assumir o escopo dele (BMs, NF, comprovante, chat).

**Decisão:** o fornecedor (COLABORADOR) não altera o próprio nome (`podeAlterarProprioNome` em `lib/usuario-nome.ts`; a rota devolve 403 e a tela de conta mostra o nome como somente leitura). O nome muda só quando o Administrativo edita o `responsavel` do cadastro (`app/api/admin/administrativo/fornecedores/[id]`), que renomeia o usuário na mesma transação, e só quando há exatamente um usuário com o nome antigo.

**Alternativas descartadas:** ação `set_nome` em Gestão de Usuários (deixaria nome e cadastro dessincronizados e o fornecedor perderia o acesso); manter a edição livre (permite tomar a identidade de outro).

**Consequências:** a regra é paliativa. A solução definitiva é o vínculo explícito login → Profissional ([pendências](../pendencias.md)). Usuários internos continuam editando o próprio nome.

**Atualização (2026-10-17):** com a [decisão 012](012-p0-como-id-do-fornecedor.md) (P0 como único ID), o nome deixou de ser o elo entre usuário e cadastro, e a troca de nome não é mais um risco de segurança. A regra foi mantida por decisão do usuário: o nome continua espelhando o `responsavel` do cadastro. A edição pelo Administrativo renomeia o usuário achado pelo código (`sincronizarUsuarioDoFornecedor` em `lib/cadastro-fornecedor.ts`, que desde 2026-10-18 também leva o e-mail do cadastro para o acesso). Liberar a troca de nome pelo fornecedor fica para outra entrega.
