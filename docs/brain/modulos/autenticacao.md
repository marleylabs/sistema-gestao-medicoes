---
atualizado: 2026-10-22
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
- `lib/perfis.ts`: fonte única dos perfis. `lib/auth.ts` tem uma cópia duplicada (`INTERNAL_USER_PROFILES`). Perfis externos: COLABORADOR e FISCAL (`EXTERNAL_PERFIS`); para "é equipe interna" use `isPerfilInterno` (allowlist), nunca "não é COLABORADOR".
- `lib/permissoes.ts` / `lib/permissoes-acesso.ts`: permissões extras (`UsuarioPermissao`) e `hasPermissao`.
- `lib/first-access.ts`, `lib/primeiro-acesso-*.ts`: envio de senha temporária, idempotente por requestId e com advisory lock; em lote, no máximo 50.
- `lib/rate-limit.ts`: limite em memória por processo (8 tentativas a cada 15 min), só no login. Também há bloqueio no banco após 5 falhas.

**Regras e armadilhas:**
- FISCAL (fiscal do contrato, 2026-10-22): login P0, cadastrado na aba Fiscais do Administrativo (`lib/fiscais.ts`, `requireAdministrativo`), acesso pelo mesmo primeiro acesso. `app/page.tsx` manda o FISCAL para `FiscalApp` (só Timesheet); ele não usa chat, não troca o próprio nome e não baixa NF nem comprovante (as rotas `app/api/colaborador/nf|comprovante/[id]` agora barram quem não é o fornecedor dono nem equipe interna). A aba Funcionários não lista fiscais.
- O fornecedor é identificado pelo login da sessão, que é o P0: o mesmo valor do `Profissional.codigo` e do código do cadastro ([decisão 012](../decisoes/012-p0-como-id-do-fornecedor.md)). Os aliases vêm de `lib/colaborador-alias.ts`. Nunca por um id do request nem pelo nome do usuário.
- O login do fornecedor é gerado por `generateUniqueInternalAccessCode` (`P0` + 6 dígitos). Para fornecedor novo, `gerarP0Livre` (`lib/codigo-p0.ts`) garante que ele também não é código, nome legado nem alias de nenhum Profissional.
- Muitas rotas fazem `user.perfil === "ADMIN"` inline depois de `requireAdmin`. Confira as duas camadas.
- A permissão extra só vale para MEDICAO/FINANCEIRO/ADMINISTRATIVO e só é gravada em `app/api/admin/usuarios/[id]` (com auditoria).
- `primeiroLogin` não é bloqueado no servidor fora da troca de senha (só na UI).
- `generateTempPassword` usa `Math.random`.
- O e-mail do usuário é cifrado (`lib/encryption.ts`, AES-256-GCM).

**Depende de:** [Identidades](identidades-importacao.md), [E-mail](email.md)
