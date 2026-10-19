---
atualizado: 2026-10-17
tags: [modulo]
---
# Portal do fornecedor

**O que faz:** as telas do fornecedor (perfil COLABORADOR): BM, conferência, NF, comprovante e "Minhas Medições".

**Onde está:** `components/colaborador-app.tsx`, `app/api/colaborador/`

**Arquivos-chave:**
- `app/page.tsx`: renderiza o portal quando o perfil é COLABORADOR. Atenção: `app/fornecedores/page.tsx` é a tela interna de fornecedores, não o portal.
- `lib/colaborador-alias.ts`: monta a lista de códigos e aliases que delimita os dados do fornecedor; `lib/colaborador-alias-filtro.ts` tem a regra de filtro.
- `lib/portal-fornecedor.ts`: rótulos de status para o fornecedor.
- `lib/minhas-medicoes.ts`: mostra só AGUARDANDO_NF, APROVADO e PAGO.
- `lib/cadastro-identity.ts`: escolhe o cadastro do usuário logado só pelo código igual ao login (P0); mais de um falha fechado.

**Regras e armadilhas:**
- Toda rota de `app/api/colaborador/**` exige COLABORADOR e filtra pela lista de aliases da sessão. O escopo nunca é por CNPJ.
- **Escopo por identidade exata** ([spec](../specs/p1-escopo-fornecedor-por-identidade.md)): a identidade vem do cadastro cujo código é o login (P0, [decisão 012](../decisoes/012-p0-como-id-do-fornecedor.md)), resolvido para um Profissional. Um cadastro de outro fornecedor com o mesmo nome nunca é usado. Só entra na lista o valor que `resolverIdentidadeOperacional` liga a esse mesmo Profissional. Sem identidade única, o escopo é só o login. Não há busca por CNPJ nem linha inteira do mapa. `getColaboradorEscopo` devolve também o Profissional e o cadastro da sessão: Documentos Medidos, conferência, Minhas Medições e os dados cadastrais exibidos (`/api/colaborador/me`, `/api/usuario/me`) usam esses ids, nunca nome ou CNPJ. O login só entra na lista se não for código/alias de nenhum Profissional.
- **P0 como único ID** ([decisão 012](../decisoes/012-p0-como-id-do-fornecedor.md)): login = `Profissional.codigo` = `CadastroFornecedor.colaboradorCodigo`. O nome não liga mais usuário e fornecedor. Implantado na produção em 2026-10-18 (UTC), com a migração de dados da T6 ([plano](../specs/p2-vinculo-login-profissional-plano.md), [decisão 013](../decisoes/013-servidor-unico-e-producao.md)).
- O fornecedor continua sem poder alterar o próprio nome ([decisão 011](../decisoes/011-nome-do-fornecedor-so-pelo-administrativo.md)), por decisão mantida, não mais por segurança.

**Depende de:** [Autenticação](autenticacao.md), [Boletim](boletim-calculo.md), [Envio do BM](envio-bm.md)
