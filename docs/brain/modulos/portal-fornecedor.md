---
atualizado: 2026-10-16
tags: [modulo]
---
# Portal do fornecedor

**O que faz:** as telas do fornecedor (perfil COLABORADOR): BM, conferência, NF, comprovante e "Minhas Medições".

**Onde está:** `components/colaborador-app.tsx`, `app/api/colaborador/`

**Arquivos-chave:**
- `app/page.tsx`: renderiza o portal quando o perfil é COLABORADOR. Atenção: `app/fornecedores/page.tsx` é a tela interna de fornecedores, não o portal.
- `lib/colaborador-alias.ts`: monta a lista de códigos e aliases que delimita os dados do fornecedor.
- `lib/portal-fornecedor.ts`: rótulos de status para o fornecedor.
- `lib/minhas-medicoes.ts`: mostra só AGUARDANDO_NF, APROVADO e PAGO.
- `lib/cadastro-identity.ts`: escolhe o cadastro do usuário logado (primeiro por código, depois por nome).

**Regras e armadilhas:**
- Toda rota de `app/api/colaborador/**` exige COLABORADOR e filtra pela lista de aliases da sessão. O escopo nunca é por CNPJ.
- A lista de aliases inclui `responsavel`/`projetistaCodigo` do mapa casados por nome. Um homônimo amplia o escopo; atenção ao isolamento entre fornecedores.

**Depende de:** [Autenticação](autenticacao.md), [Boletim](boletim-calculo.md), [Envio do BM](envio-bm.md)
