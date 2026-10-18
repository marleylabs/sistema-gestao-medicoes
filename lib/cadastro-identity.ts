export type CadastroIdentityCandidate = {
  id: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  cnpjNormalizado: string;
};

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Cadastro do fornecedor logado: só o cadastro cujo código é o login (P0, decisão 012). Nunca pelo
 * nome do usuário nem pelo CNPJ; mais de um cadastro com o mesmo código falha fechado.
 */
export function selectCadastroForAuthenticatedUser<T extends CadastroIdentityCandidate>(candidates: T[], usuario: string) {
  const normalizedUsuario = normalizeIdentity(usuario);
  const byCode = candidates.filter((candidate) => normalizeIdentity(candidate.colaboradorCodigo) === normalizedUsuario);
  if (byCode.length === 1) return { cadastro: byCode[0], error: null as string | null };
  if (byCode.length > 1) return { cadastro: null, error: "Existem múltiplos cadastros para o código deste colaborador." };
  return { cadastro: null, error: "Fornecedor sem cadastro administrativo vinculado ao usuário autenticado." };
}
