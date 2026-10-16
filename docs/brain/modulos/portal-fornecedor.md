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
- **Escopo por identidade exata** ([spec](../specs/p1-escopo-fornecedor-por-identidade.md)): a identidade vem do cadastro do usuário (login ou nome exato, falhando fechado com homônimos) resolvido para um Profissional. Só entra na lista o valor que `resolverIdentidadeOperacional` liga a esse mesmo Profissional. Sem identidade única, o escopo é só o login. Não há busca por CNPJ nem linha inteira do mapa. Documentos Medidos do portal é buscado pelo id do Profissional (`getColaboradorEscopo`), nunca por nome.
- Não existe vínculo explícito login → Profissional (ver [pendências](../pendencias.md)).

**Depende de:** [Autenticação](autenticacao.md), [Boletim](boletim-calculo.md), [Envio do BM](envio-bm.md)
