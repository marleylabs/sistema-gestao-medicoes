export type CadastroIdentityCandidate = {
  id: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  cnpjNormalizado: string;
};

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function selectCadastroForAuthenticatedUser<T extends CadastroIdentityCandidate>(
  candidates: T[],
  usuario: string,
  usuarioNome?: string | null,
) {
  const normalizedUsuario = normalizeIdentity(usuario);
  const normalizedNome = normalizeIdentity(usuarioNome);
  const byCode = candidates.filter((candidate) => normalizeIdentity(candidate.colaboradorCodigo) === normalizedUsuario);
  if (byCode.length === 1) return { cadastro: byCode[0], error: null as string | null };
  if (byCode.length > 1) return { cadastro: null, error: "Existem múltiplos cadastros para o código deste colaborador." };

  const byName = normalizedNome
    ? candidates.filter((candidate) => normalizeIdentity(candidate.responsavel) === normalizedNome)
    : [];
  if (byName.length === 1) return { cadastro: byName[0], error: null as string | null };
  if (byName.length > 1) {
    const distinctCodes = new Set(byName.map((candidate) => normalizeIdentity(candidate.colaboradorCodigo)).filter(Boolean));
    return {
      cadastro: null,
      error: distinctCodes.size > 1
        ? "O nome do usuário está associado a mais de um colaborador."
        : "Existem múltiplos cadastros para este colaborador.",
    };
  }
  return { cadastro: null, error: "Fornecedor sem cadastro administrativo vinculado ao usuário autenticado." };
}
