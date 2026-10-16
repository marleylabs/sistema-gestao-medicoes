---
atualizado: 2026-10-16
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
- `lib/cadastro-identity.ts`: escolhe o cadastro do usuário logado (primeiro por código, depois por nome).

**Regras e armadilhas:**
- Toda rota de `app/api/colaborador/**` exige COLABORADOR e filtra pela lista de aliases da sessão. O escopo nunca é por CNPJ.
- **Escopo por identidade exata** ([spec](../specs/p1-escopo-fornecedor-por-identidade.md)): a identidade vem do cadastro do usuário (login ou nome exato, falhando fechado com homônimos) resolvido para um Profissional. Só entra na lista o valor que `resolverIdentidadeOperacional` liga a esse mesmo Profissional. Sem identidade única, o escopo é só o login. Não há busca por CNPJ nem linha inteira do mapa. `getColaboradorEscopo` devolve também o Profissional e o cadastro da sessão: Documentos Medidos, conferência, Minhas Medições e os dados cadastrais exibidos (`/api/colaborador/me`, `/api/usuario/me`) usam esses ids, nunca nome ou CNPJ. O login só entra na lista se não for código/alias de nenhum Profissional.
- Não existe vínculo explícito login → Profissional (ver [pendências](../pendencias.md)). Por isso o fornecedor não altera o próprio nome ([decisão 011](../decisoes/011-nome-do-fornecedor-so-pelo-administrativo.md)).

**Depende de:** [Autenticação](autenticacao.md), [Boletim](boletim-calculo.md), [Envio do BM](envio-bm.md)
