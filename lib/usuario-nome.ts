/**
 * Validação do nome de exibição do usuário (Usuario.nome) — usada tanto no endpoint de conta
 * própria (app/api/usuario/me PATCH) quanto no frontend (components/account-menu.tsx) para dar
 * feedback imediato antes de chamar a API. Módulo puro, sem "server-only".
 */
const MIN_LENGTH = 3;
const MAX_LENGTH = 120;

export function normalizeUserDisplayName(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/** Retorna a mensagem de erro, ou null quando o nome é válido. */
export function validateUserDisplayName(raw: string | null | undefined): string | null {
  const nome = normalizeUserDisplayName(raw);
  if (!nome) return "Informe um nome.";
  if (nome.length < MIN_LENGTH) return `Informe um nome com pelo menos ${MIN_LENGTH} caracteres.`;
  if (nome.length > MAX_LENGTH) return `O nome pode ter no máximo ${MAX_LENGTH} caracteres.`;
  return null;
}

export type NomeUpdateResult =
  | { ok: true; nome: string }
  | { ok: false; error: string; status: 400 | 403 };

/**
 * Extrai e valida o único campo aceito por PATCH /api/usuario/me — proteção contra mass
 * assignment: só a chave `nome` é lida do corpo da requisição; `perfil`, `usuario`, `id`, `ativo`
 * ou qualquer outra chave presente no payload são ignorados (nunca chegam a um `data: {...body}`
 * do Prisma). A identidade de QUAL usuário é atualizado nunca vem daqui — vem sempre do
 * `user.id` da sessão autenticada, resolvido pelo chamador (app/api/usuario/me/route.ts).
 */
export function resolveNomeUpdate(body: unknown): NomeUpdateResult {
  const nomeRaw = body && typeof body === "object" && "nome" in (body as Record<string, unknown>)
    ? (body as Record<string, unknown>).nome
    : undefined;

  if (typeof nomeRaw !== "string") {
    return {
      ok: false,
      error: "Os dados cadastrais são gerenciados pelo Administrativo e não podem ser alterados manualmente.",
      status: 403,
    };
  }

  const validationError = validateUserDisplayName(nomeRaw);
  if (validationError) return { ok: false, error: validationError, status: 400 };

  return { ok: true, nome: normalizeUserDisplayName(nomeRaw) };
}
