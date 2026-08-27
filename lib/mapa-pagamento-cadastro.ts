import "server-only";

import { formatCnpj, onlyDigits } from "@/lib/cadastro-fornecedor";
import { decryptSensitive } from "@/lib/encryption";

export type CadastroFornecedorResumo = {
  id: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  razaoSocial: string;
  cnpjNormalizado: string;
  tipoCt: string | null;
};

export type CadastroFornecedorMatch = {
  cadastro: CadastroFornecedorResumo;
  match: "codigo" | "responsavel" | "cnpj";
};

export function normalizeCadastroMatch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function normalizedCandidates(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(normalizeCadastroMatch).filter(Boolean)));
}

const STOP_WORDS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "LTDA", "ME", "EIRELI"]);

function tokenList(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .match(/[A-Z0-9]{2,}/g)
    ?.filter((token) => !STOP_WORDS.has(token)) ?? [];
}

function editDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = left[i - 1] === right[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[left.length][right.length];
}

function similarToken(left: string, right: string) {
  if (left === right) return true;
  const minLength = Math.min(left.length, right.length);
  if (minLength < 4) return false;
  return editDistance(left, right) <= (minLength >= 8 ? 2 : 1);
}

function fuzzyNameMatch(left: string | null | undefined, right: string | null | undefined) {
  const leftTokens = tokenList(left);
  const rightTokens = tokenList(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const matches = leftTokens.filter((leftToken) => rightTokens.some((rightToken) => similarToken(leftToken, rightToken))).length;
  const required = Math.min(leftTokens.length, rightTokens.length) >= 2 ? 2 : 1;
  return matches >= required && matches / Math.min(leftTokens.length, rightTokens.length) >= 0.5;
}

function samePersonMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeCadastroMatch(left);
  const b = normalizeCadastroMatch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 8 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (fuzzyNameMatch(left, right)) return true;
  return false;
}

function cadastroOverride(result: CadastroFornecedorMatch | undefined) {
  if (!result) return null;
  const { cadastro, match } = result;
  const cpfCnpj = cadastro.cnpjNormalizado ? formatCnpj(cadastro.cnpjNormalizado) : null;
  return {
    id: cadastro.id,
    responsavel: match === "cnpj" ? null : cadastro.responsavel,
    cpfCnpj,
    razaoSocial: cadastro.razaoSocial,
    // Alocação usa sempre o Tipo CT do cadastro administrativo, mesmo quando o match veio por CNPJ,
    // pois o cadastro resolvido já é o correto para este item (colaborador_codigo/responsável tem prioridade
    // na função acima; CNPJ só decide quando é o único cadastro candidato com aquele CNPJ).
    tipoCt: cadastro.tipoCt,
  };
}

export function cadastroFornecedorByMapaItem(item: any, cadastros: CadastroFornecedorResumo[]): CadastroFornecedorMatch | undefined {
  const codigoCandidates = normalizedCandidates([item.projetistaCodigo, item.rawPayload?.projetistaCodigo]);
  const nomeCandidates = normalizedCandidates([
    item.responsavel,
    item.projetistaCodigo,
    item.rawPayload?.responsavel,
    item.rawPayload?.projetistaCodigo,
  ]);
  const cpfCnpj = onlyDigits(decryptSensitive(item.cpfCnpj));

  const byCodigo = cadastros.find((cadastro) =>
    codigoCandidates.some((codigo) => samePersonMatch(cadastro.colaboradorCodigo, codigo)),
  );
  if (byCodigo) return { cadastro: byCodigo, match: "codigo" };

  const byResponsavel = cadastros.find((cadastro) =>
    nomeCandidates.some((nome) => samePersonMatch(cadastro.responsavel, nome)),
  );
  if (byResponsavel) return { cadastro: byResponsavel, match: "responsavel" };

  const byRazaoSocialForte = cadastros.filter((cadastro) => {
    const razao = normalizeCadastroMatch(cadastro.razaoSocial);
    return nomeCandidates.some((nome) => razao && (razao === nome || razao.startsWith(nome) || nome.startsWith(razao)));
  });
  if (byRazaoSocialForte.length === 1) return { cadastro: byRazaoSocialForte[0], match: "responsavel" };

  const byRazaoSocial = cadastros.filter((cadastro) =>
    nomeCandidates.some((nome) => samePersonMatch(cadastro.razaoSocial, nome)),
  );
  if (byRazaoSocial.length === 1) return { cadastro: byRazaoSocial[0], match: "responsavel" };

  const byCnpj = cadastros.filter((cadastro) => cadastro.cnpjNormalizado && cadastro.cnpjNormalizado === cpfCnpj);
  if (byCnpj.length === 1) return { cadastro: byCnpj[0], match: "cnpj" };

  return undefined;
}

export function cadastroFornecedorOverrideForMapaItem(item: any, cadastros: CadastroFornecedorResumo[]) {
  return cadastroOverride(cadastroFornecedorByMapaItem(item, cadastros));
}
