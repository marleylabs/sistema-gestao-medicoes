/**
 * Equipes fixas desabilitadas: a conversa (e qualquer histórico associado) permanece no banco,
 * mas não aceita novas mensagens nem é exibida como ativa. Hoje só "Financeiro".
 */
const DISABLED_TEAM_PROFILES = new Set(["FINANCEIRO"]);

export function teamPerfilFromChave(chave: string) {
  const parts = chave.split(":");
  return parts[0] === "TEAM" ? parts[1] ?? null : null;
}

export function isDisabledTeamChave(chave: string) {
  const perfil = teamPerfilFromChave(chave);
  return !!perfil && DISABLED_TEAM_PROFILES.has(perfil);
}
