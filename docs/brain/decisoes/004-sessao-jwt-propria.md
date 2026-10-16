---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 004 Sessão JWT própria revalidada no banco

**Contexto:** a aplicação tem poucos perfis internos e fornecedores externos, sem provedor de identidade corporativo.

**Decisão:** usar um JWT HS256 (jose) no cookie httpOnly `medicoes_session` (8 h), com o usuário recarregado do banco a cada request (`lib/session.ts`). `proxy.ts` só autentica; o perfil é checado em cada rota (`lib/admin.ts`). Registrada retroativamente.

**Alternativas descartadas:** não registradas.

**Consequências:** desativar o usuário ou mudar o perfil vale na hora. Não há lista de revogação: logout só apaga o cookie. O rate limit é em memória (por processo).
