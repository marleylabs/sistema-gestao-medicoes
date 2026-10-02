import { normalizeTipoCondicaoFixa } from "@/lib/condicao-fixa";
import { normalizeFonteMedicao } from "@/lib/fonte-medicao";

export type AcessoInfo = {
  id: string;
  usuario: string;
  perfil: string;
  ativo: boolean;
  email: string | null;
  primeiroLogin: boolean;
};

export type Funcionario = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  primeiroLogin: boolean;
  email: string | null;
  permissoesExtras: string[];
};

export type CadastroFornecedor = {
  id: string;
  cnpjNormalizado: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  razaoSocial: string;
  statusContrato: string | null;
  objetoContrato: string | null;
  cargo: string | null;
  cpf: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  tipoCt: string | null;
  tipoContrato: string | null;
  valorHora: number | null;
  valorA1Equivalente: number | null;
  valorDocumento: number | null;
  valorCondicaoFixa: number | null;
  tipoCondicaoFixa: string | null;
  valorCondicaoFixaComProducao: number | null;
  valorCondicaoFixaSemProducao: number | null;
  fonteMedicao: string | null;
  inicio: string | null;
  final: string | null;
  statusCadastro: string | null;
  primeiroAditivo: string | null;
  segundoAditivo: string | null;
  ativo: boolean;
  inativadoAt: string | null;
  diasAteVencimento: number | null;
  validadeLabel: string;
  validadeTone: "danger" | "warning" | "notice" | "success" | "neutral";
  pendencias: string[];
  updatedAt: string | null;
  acesso: AcessoInfo | null;
};

export type BadgeTone = "brand" | "primary" | "success" | "warning" | "danger" | "neutral";

/** Situação de vigência (cálculo do backend, `validadeTone`) → variante de Badge do design system. */
export const VALIDADE_BADGE: Record<CadastroFornecedor["validadeTone"], BadgeTone> = {
  danger: "danger",
  warning: "warning",
  notice: "neutral",
  success: "success",
  neutral: "neutral",
};

export function dateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

export function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

export function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function maskCnpj(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function maskCpf(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})(\d)/, "$1-$2");
}

export function maskPhone(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 11);
  if (digits.length <= 2) return digits.replace(/^(\d{0,2})/, (_, ddd) => (ddd ? `(${ddd}` : ""));
  if (digits.length <= 6) return digits.replace(/^(\d{2})(\d{0,4})/, "($1) $2");
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d{0,4})(\d{0,4})/, "($1) $2-$3");
  return digits.replace(/^(\d{2})(\d{0,5})(\d{0,4})/, "($1) $2-$3");
}

export function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function displayText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s./&()-])([\p{L}])/gu, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("pt-BR")}`)
    .replace(/\b(Ltda|Me|Epp|Sa|S\/A)\b/g, (match) => match.toLocaleUpperCase("pt-BR"))
    .replace(/\b(E|Da|Das|De|Do|Dos)\b/g, (match) => match.toLocaleLowerCase("pt-BR"));
}

export function compactId(value: string) {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

export function vigenciaLabel(inicio: string | null, final: string | null) {
  // Sem nenhuma data, mostra só "-"; com Início e sem Fim, "31/08/2026 → -" (nunca corta o texto).
  if (!inicio && !final) return "-";
  return `${fmtDate(inicio)} → ${fmtDate(final)}`;
}

export function formatCadastroInput(field: string, value: string) {
  if (field === "cnpj") return maskCnpj(value);
  if (field === "cpf") return maskCpf(value);
  if (field === "telefone") return maskPhone(value);
  if (field === "email") return value.trimStart();
  return value;
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function money(value: number | null | undefined) {
  return value === null || value === undefined ? "–" : currency.format(value);
}

export function fonteMedicaoLabel(value: string | null | undefined) {
  return normalizeFonteMedicao(value) === "DOCUMENTOS_AUXILIARES" ? "Documentos auxiliares" : "Documentos";
}

export function condicaoLabel(value: string | null | undefined) {
  return normalizeTipoCondicaoFixa(value) === "CONDICIONAL_PRODUCAO" ? "Condicional" : "Fixa";
}
