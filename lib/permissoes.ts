/**
 * Registro central de permissões extras — mesmo padrão de lib/perfis.ts (tupla `as const` → tipo
 * derivado → labels → validador). Módulo PURO (sem "server-only"): precisa ser importável tanto
 * pelo backend (rotas/guards) quanto pelo frontend (checkboxes de "Acessos adicionais" no Painel
 * Administrativo) — as funções que tocam banco ficam em lib/permissoes-acesso.ts.
 *
 * Só existe UM valor por enquanto (o caso real que motivou esta camada); adicionar um novo módulo
 * aqui não altera nenhuma regra existente — cada novo valor precisa ser explicitamente ligado a
 * um `requireX()`/gate real antes de significar algo.
 */
export const VALID_PERMISSOES = ["ADMINISTRATIVO", "HISTORICO_MEDICOES"] as const;

export type Permissao = (typeof VALID_PERMISSOES)[number];

export const PERMISSAO_LABEL: Record<Permissao, string> = {
  ADMINISTRATIVO: "Painel Administrativo",
  HISTORICO_MEDICOES: "Histórico de Medições",
};

/** Mesmo padrão de PERFIL_LABEL_LOOSE — indexável por string livre (ex.: valor vindo de uma API). */
export const PERMISSAO_LABEL_LOOSE: Record<string, string> = PERMISSAO_LABEL;

export const PERMISSAO_DESCRICAO: Record<Permissao, string> = {
  ADMINISTRATIVO:
    "Acesso operacional ao cadastro de fornecedores/funcionários e à importação da Consulta PJ. Ações sensíveis (redefinir senha, enviar primeiro acesso, excluir, alterar perfil, resolução de identidade) continuam exclusivas do ADMIN.",
  HISTORICO_MEDICOES:
    "Permite consultar o histórico de medições (por medição, fornecedor e contrato), somente leitura. Ações de manutenção de ciclo (Novo ciclo, Publicar ciclo, Excluir ciclo — em Fornecedores) continuam restritas a quem já tem essa autorização hoje (perfil Medição/ADMIN, exclusão só ADMIN) — esta permissão nunca amplia isso.",
};

export const PERMISSAO_OPTIONS = VALID_PERMISSOES.map((value) => ({ value, label: PERMISSAO_LABEL[value] }));

export function isValidPermissao(value: unknown): value is Permissao {
  return typeof value === "string" && (VALID_PERMISSOES as readonly string[]).includes(value);
}

/**
 * Perfis elegíveis para RECEBER permissão extra. ADMIN nunca precisa (já tem tudo, item 9 do
 * pedido) — nunca aparece aqui, e o backend rejeita explicitamente se alguém tentar conceder algo
 * a um ADMIN. COLABORADOR é usuário externo (fornecedor) e nunca deve ganhar módulo interno por
 * erro de interface — princípio do menor privilégio, sem fallback "se é interno, libera".
 */
export const PERFIS_ELEGIVEIS_PERMISSAO_EXTRA = ["MEDICAO", "FINANCEIRO", "ADMINISTRATIVO"] as const;

export function isElegivelParaPermissaoExtra(perfil: string): boolean {
  return (PERFIS_ELEGIVEIS_PERMISSAO_EXTRA as readonly string[]).includes(perfil);
}

/**
 * O que cada perfil já recebe de base, sem precisar de permissão extra — usado só para a UI não
 * oferecer como "extra" algo redundante (item 11 do pedido: "não mostrar como opção os acessos que
 * o perfil já recebe automaticamente"). Não tem efeito de autorização por si só — quem decide
 * acesso real é `hasPermissao`/os guards em lib/admin.ts (lib/permissoes-acesso.ts).
 */
export const PERMISSOES_BASE_POR_PERFIL: Partial<Record<string, Permissao[]>> = {
  ADMINISTRATIVO: ["ADMINISTRATIVO"],
};
