/**
 * Fonte única dos perfis de `Usuario` — evita enumerações paralelas divergentes entre as rotas
 * de administração de usuários e o frontend (Painel Administrativo, antigo Gestão de Usuários).
 */
export const VALID_PERFIS = ["ADMIN", "MEDICAO", "COLABORADOR", "FINANCEIRO", "ADMINISTRATIVO"] as const;

export type Perfil = (typeof VALID_PERFIS)[number];

/** Perfis internos (equipe própria) — excluem COLABORADOR, que é sempre fornecedor. */
export const INTERNAL_PERFIS = VALID_PERFIS.filter((p) => p !== "COLABORADOR") as Exclude<Perfil, "COLABORADOR">[];

export const PERFIL_LABEL: Record<Perfil, string> = {
  ADMIN: "Administrador",
  MEDICAO: "Medição",
  COLABORADOR: "Fornecedor",
  FINANCEIRO: "Financeiro",
  ADMINISTRATIVO: "Administrativo",
};

/** Mesmo conteúdo de `PERFIL_LABEL`, tipado para indexação com `string` livre (ex.: valor vindo de
 * uma resposta de API) — evita erro de TS ao fazer `PERFIL_LABEL_LOOSE[perfil] ?? perfil`. */
export const PERFIL_LABEL_LOOSE: Record<string, string> = PERFIL_LABEL;

export const PERFIL_OPTIONS = VALID_PERFIS.map((value) => ({ value, label: PERFIL_LABEL[value] }));

export const INTERNAL_PERFIL_OPTIONS = INTERNAL_PERFIS.map((value) => ({ value, label: PERFIL_LABEL[value] }));

export function isValidPerfil(value: unknown): value is Perfil {
  return typeof value === "string" && (VALID_PERFIS as readonly string[]).includes(value);
}
