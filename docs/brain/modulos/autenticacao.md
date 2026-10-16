---
atualizado: 2026-10-16
tags: [modulo]
---
# Autenticação e permissões

**O que faz:** cuida do login, da sessão JWT, dos perfis, das permissões extras, do primeiro acesso e da troca de senha.

**Onde está:** `lib/`, `app/api/auth/`, `app/api/admin/usuarios/`, `proxy.ts`

**Arquivos-chave:**
- `lib/session.ts`: assina e valida o JWT (HS256, cookie `medicoes_session`, 8 h). Recarrega o usuário do banco a cada chamada.
- `lib/auth.ts`: `getCurrentUser`, hash scrypt, política de senha, bootstrap do primeiro ADMIN.
- `proxy.ts`: só exige autenticação (401 na API, redirect nas páginas). Não checa perfil.
- `lib/admin.ts`: guardas `requireAdmin` (MEDICAO + ADMIN, apesar do nome), `requireFinanceiro`, `requireAdministrativo`, `requireHistorico`.
- `lib/perfis.ts`: fonte única dos perfis. `lib/auth.ts` tem uma cópia duplicada (`INTERNAL_USER_PROFILES`).
- `lib/permissoes.ts` / `lib/permissoes-acesso.ts`: permissões extras (`UsuarioPermissao`) e `hasPermissao`.
- `lib/first-access.ts`, `lib/primeiro-acesso-*.ts`: envio de senha temporária, idempotente por requestId e com advisory lock; em lote, no máximo 50.
- `lib/rate-limit.ts`: limite em memória por processo (8 tentativas a cada 15 min), só no login. Também há bloqueio no banco após 5 falhas.

**Regras e armadilhas:**
- O fornecedor é identificado por `toColaboradorCodigo(user.usuario)` + aliases (`lib/colaborador-alias.ts`), nunca por um id do request.
- Muitas rotas fazem `user.perfil === "ADMIN"` inline depois de `requireAdmin`. Confira as duas camadas.
- A permissão extra só vale para MEDICAO/FINANCEIRO/ADMINISTRATIVO e só é gravada em `app/api/admin/usuarios/[id]` (com auditoria).
- `primeiroLogin` não é bloqueado no servidor fora da troca de senha (só na UI).
- `generateTempPassword` usa `Math.random`.
- O e-mail do usuário é cifrado (`lib/encryption.ts`, AES-256-GCM).

**Depende de:** [Identidades](identidades-importacao.md), [E-mail](email.md)
