/**
 * Regra de e-mail obrigatório para usuários internos ativos das equipes de notificação
 * (MEDICAO/FINANCEIRO) — usada tanto no frontend (feedback imediato) quanto no backend
 * (fonte de verdade, nunca confia só na validação do navegador). Pura, sem I/O, sem
 * dependência de Prisma/DB — pode ser importada por um componente client-side sem problema.
 */
export const EMAIL_REQUIRED_PERFIS = new Set(["MEDICAO", "FINANCEIRO"]);

export const EMAIL_REQUIRED_MESSAGE = "Para usuários ativos das equipes de Medição ou Financeiro é necessário cadastrar um e-mail.";

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** true quando este perfil, se ativo, exige e-mail cadastrado. */
export function requiresEmail(perfil: string, ativo: boolean) {
  return ativo && EMAIL_REQUIRED_PERFIS.has(perfil);
}
