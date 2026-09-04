import "server-only";
import { createHash } from "node:crypto";

import { generateTempPassword, generateUniqueInternalAccessCode, hashPassword } from "@/lib/auth";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { excelSerialToDate, parseSimpleXlsx } from "@/lib/xlsx";
import { selectCadastroForAuthenticatedUser } from "@/lib/cadastro-identity";

export const CADASTRO_FORNECEDOR_SHEET = "CONTRATOS_ATIVOS";

export type CadastroRow = {
  statusContrato?: string | null;
  responsavel: string;
  cnpj: string;
  cnpjNormalizado: string;
  razaoSocial: string;
  objetoContrato?: string | null;
  cargo?: string | null;
  cpf?: string | null;
  email?: string | null;
  telefone?: string | null;
  tipoCt?: string | null;
  tipoContrato?: string | null;
  valorHora?: number | null;
  valorA1Equivalente?: number | null;
  valorDocumento?: number | null;
  valorCondicaoFixa?: number | null;
  inicio?: Date | null;
  final?: Date | null;
  statusCadastro?: string | null;
  primeiroAditivo?: string | null;
  segundoAditivo?: string | null;
  rawPayload: Record<string, string | number | null>;
};

const HEADER_MAP: Record<string, keyof CadastroRow> = {
  "STATUS CT": "statusContrato",
  "RESPONSAVEL": "responsavel",
  "CARTAO CNPJ": "cnpj",
  "RAZAO SOCIAL": "razaoSocial",
  "OBJETO DO CONTRATO": "objetoContrato",
  "CARGO": "cargo",
  "CPF": "cpf",
  "E-MAIL": "email",
  "EMAIL": "email",
  "TELEFONE": "telefone",
  "TIPO CT": "tipoCt",
  "TIPO CONTRATO": "tipoContrato",
  "HORA": "valorHora",
  "A1 EQUIVALENTE": "valorA1Equivalente",
  "DOCUMENTO": "valorDocumento",
  "CONDICAO FIXA": "valorCondicaoFixa",
  "INICIO": "inicio",
  "FINAL": "final",
  "STATUS": "statusCadastro",
  "1 ADI": "primeiroAditivo",
  "1O ADI": "primeiroAditivo",
  "2 AD": "segundoAditivo",
  "2O AD": "segundoAditivo",
};

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function onlyDigits(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
}

export function normalizeCnpjDigits(value: string | number | null | undefined) {
  const digits = onlyDigits(value);
  if (digits.length === 13) return digits.padStart(14, "0");
  return digits;
}

export function formatCnpj(value: string | number | null | undefined) {
  const digits = normalizeCnpjDigits(value).padStart(14, "0").slice(-14);
  if (!digits) return "";
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function normalizeHeader(value: unknown) {
  return stripAccents(String(value ?? ""))
    .trim()
    .replace(/[º°]/g, "O")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/\./g, "").replace(",", ".").trim();
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function asDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return value >= 20000 ? excelSerialToDate(value) : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normalização de NOME só para fins de COMPARAÇÃO de identidade (nunca reescreve a forma visual
 * cadastrada) — trim, colapso de espaços múltiplos, remoção de acentos/diacríticos (NFD),
 * case-insensitive (via uppercase) e descarte de qualquer caractere que não seja letra/número/
 * espaço (cobre caracteres invisíveis comuns como NBSP, zero-width space etc., que o `\s` do
 * regex de colapso já trata como espaço). Também serve como base determinística de
 * `colaboradorCodigo` quando não há Profissional existente para vincular.
 */
export function normalizePersonName(name: string | null | undefined) {
  return stripAccents(String(name ?? ""))
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function codigoFromName(name: string) {
  return normalizePersonName(name);
}

function identityNameHash(value: string) {
  return createHash("sha256").update(normalizePersonName(value)).digest("hex");
}

export async function isDeletedFornecedorIdentityName(nome: string) {
  return !!await prisma.adminAuditLog.findFirst({
    where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", metadata: { path: ["identityNameHashes"], array_contains: [identityNameHash(nome)] } },
    select: { id: true },
  });
}

export function diasAteVencimento(final: Date | string | null | undefined) {
  if (!final) return null;
  const date = final instanceof Date ? final : new Date(final);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const finalUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.ceil((finalUtc - todayUtc) / 86400000);
}

function normalizeCadastroStatus(value: string | null | undefined) {
  return stripAccents(String(value ?? ""))
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function isCadastroPendente(statusCadastro: string | null | undefined) {
  const status = normalizeCadastroStatus(statusCadastro);
  return status === "PENDENCIA" || status === "PENDENTE" || status.includes("PENDENCIA");
}

function isKnownCadastroStatus(value: string | null | undefined) {
  const status = normalizeCadastroStatus(value);
  return status === "VALIDO" || status === "VENCIDO" || status === "PENDENTE" || status.includes("PENDENCIA");
}

export function cadastroStatusVisual(final: Date | string | null | undefined, statusCadastro?: string | null) {
  const dias = diasAteVencimento(final);
  if (isCadastroPendente(statusCadastro)) return { label: "Pendência", tone: "notice", dias };
  if (dias === null) return { label: "Sem validade", tone: "neutral", dias };
  if (dias < 0) return { label: "Vencido", tone: "danger", dias };
  if (dias <= 30) return { label: `Vencendo em ${dias} ${dias === 1 ? "dia" : "dias"}`, tone: "warning", dias };
  return { label: "Válido", tone: "success", dias };
}

export function parseCadastroFornecedorWorkbook(buffer: Buffer) {
  const workbook = parseSimpleXlsx(buffer);
  const sheet = workbook[CADASTRO_FORNECEDOR_SHEET] ?? Object.values(workbook)[0];
  if (!sheet?.length) throw new Error("Nenhuma aba com dados foi encontrada.");

  const headerIndex = sheet.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "RESPONSAVEL"));
  if (headerIndex < 0) throw new Error("Cabeçalho da planilha não encontrado.");

  const headers = sheet[headerIndex].map(normalizeHeader);
  const documentoIndex = headers.findIndex((header) => header === "DOCUMENTO");
  const rows: CadastroRow[] = [];
  for (const row of sheet.slice(headerIndex + 1)) {
    const rawPayload: Record<string, string | number | null> = {};
    const record: Partial<CadastroRow> = { rawPayload };
    headers.forEach((header, index) => {
      if (!header) return;
      const value = row[index] ?? null;
      rawPayload[header] = typeof value === "number" ? value : asText(value);
      const field = HEADER_MAP[header];
      if (!field) return;
      if (field === "inicio" || field === "final") (record as any)[field] = asDate(value);
      else if (field === "valorHora" || field === "valorA1Equivalente" || field === "valorDocumento" || field === "valorCondicaoFixa") (record as any)[field] = asNumber(value);
      else (record as any)[field] = asText(value);
    });

    if (documentoIndex >= 0) {
      const dateCandidates = row
        .map((value, index) => ({ date: asDate(value), index }))
        .filter((candidate) => candidate.index > documentoIndex && candidate.date);
      if (dateCandidates.length >= 2) {
        record.inicio = dateCandidates[0].date;
        record.final = dateCandidates[1].date;
        const statusCandidate = row
          .slice(dateCandidates[1].index + 1)
          .map(asText)
          .find(isKnownCadastroStatus);
        if (statusCandidate) record.statusCadastro = statusCandidate;
      }
    }

    const responsavel = asText(record.responsavel);
    const cnpjNormalizado = normalizeCnpjDigits(record.cnpj);
    if (!responsavel || cnpjNormalizado.length !== 14) continue;
    rows.push({
      statusContrato: record.statusContrato ?? null,
      responsavel,
      cnpj: record.cnpj ?? formatCnpj(cnpjNormalizado),
      cnpjNormalizado,
      razaoSocial: record.razaoSocial ?? responsavel,
      objetoContrato: record.objetoContrato ?? null,
      cargo: record.cargo ?? null,
      cpf: record.cpf ?? null,
      email: record.email ?? null,
      telefone: record.telefone ?? null,
      tipoCt: record.tipoCt ?? null,
      tipoContrato: record.tipoContrato ?? null,
      valorHora: record.valorHora ?? null,
      valorA1Equivalente: record.valorA1Equivalente ?? null,
      valorDocumento: record.valorDocumento ?? null,
      valorCondicaoFixa: record.valorCondicaoFixa ?? null,
      inicio: record.inicio ?? null,
      final: record.final ?? null,
      statusCadastro: record.statusCadastro ?? null,
      primeiroAditivo: record.primeiroAditivo ?? null,
      segundoAditivo: record.segundoAditivo ?? null,
      rawPayload,
    });
  }
  return rows;
}

// ─── Identidade de fornecedor — resolução centralizada (importação XLSX + cadastro manual) ──────
//
// CAUSA RAIZ DA DUPLICAÇÃO (auditoria): o `existing` original exigia `cnpjNormalizado:
// row.cnpjNormalizado` como filtro OBRIGATÓRIO (AND), com colaboradorCodigo/nome só como
// condições OR *dentro* desse filtro de CNPJ. Sempre que uma linha reimportada trazia um CNPJ
// diferente do já cadastrado (o caso real do "Alexandre Augusto Gilli", que teve o CNPJ corrigido
// entre duas importações), a query simplesmente não encontrava o registro existente — e o código
// caía para `create`, gerando um segundo cadastro para a MESMA pessoa. A correção inverte a
// prioridade: identidade primeiro (colaboradorCodigo canônico, ou sinais cadastrais fortes),
// CNPJ nunca como filtro de busca.

export type IdentityCandidate = {
  cadastroId: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  email: string | null;
  telefone: string | null;
  razaoSocial: string;
  cnpjNormalizado: string;
};

/** Lançada quando a importação encontra 2+ candidatos igualmente plausíveis para uma linha — a
 * regra é NUNCA escolher arbitrariamente (nunca findFirst/"o primeiro encontrado"). O chamador
 * decide o que fazer (import: registra como conflito e segue as demais linhas; cadastro manual:
 * devolve 409 ao Administrativo). */
export class FornecedorIdentityConflictError extends Error {
  candidates: IdentityCandidate[];
  constructor(message: string, candidates: IdentityCandidate[]) {
    super(message);
    this.name = "FornecedorIdentityConflictError";
    this.candidates = candidates;
  }
}

/** Lançada quando a linha importada/cadastrada resolve para um `colaboradorCodigo` cujo
 * `Profissional` foi excluído definitivamente pelo ADMIN (`deletedAt` preenchido) — a importação
 * NUNCA reativa automaticamente uma identidade excluída (ver `resolveFornecedorIdentity`,
 * resolução `BLOCKED_DELETED`). Requer ação administrativa explícita fora deste fluxo. */
export class FornecedorIdentityDeletedError extends Error {
  colaboradorCodigo: string;
  constructor(message: string, colaboradorCodigo: string) {
    super(message);
    this.name = "FornecedorIdentityDeletedError";
    this.colaboradorCodigo = colaboradorCodigo;
  }
}

type IdentityIndex = {
  /** nome normalizado -> conjunto de colaboradorCodigo distintos encontrados em Profissional
   * (codigo/nome/nomeCompleto) — mais de um valor no Set = ambíguo, nunca escolhido sozinho. */
  profissionalCodigosByName: Map<string, Set<string>>;
  /** nome normalizado -> cadastros existentes com esse responsável (para achar sinais fortes de
   * mesma pessoa quando ainda não existe Profissional vinculado). */
  cadastrosByName: Map<string, IdentityCandidate[]>;
  /** colaboradorCodigo normalizado -> id do CadastroFornecedor já vinculado a ele (evita 1 query
   * por linha durante a importação — a maioria das linhas de um reimport é UPDATE deste tipo). */
  cadastroIdByColaboradorCodigo: Map<string, string>;
  /** colaboradorCodigo normalizado -> candidato completo (sinais cadastrais) já vinculado a ele —
   * usado para checar contradição mesmo no match por Profissional (Prioridade 1), fechando o
   * caso de homônimo real colidindo num Profissional/colaboradorCodigo já existente. */
  cadastroByColaboradorCodigo: Map<string, IdentityCandidate>;
  /** colaboradorCodigo (normalizado) de todo Profissional com `deletedAt` preenchido — usado para
   * NUNCA reativar automaticamente uma identidade excluída administrativamente ao reimportar uma
   * planilha que contenha o mesmo nome/código (ver `resolveFornecedorIdentity`, resolução
   * `BLOCKED_DELETED`). */
  deletedCodigos: Set<string>;
  deletedNameHashes?: Map<string, string>;
};

async function buildIdentityIndex(): Promise<IdentityIndex> {
  const [profissionais, cadastros, exclusoes] = await Promise.all([
    prisma.profissional.findMany({ select: { codigo: true, nome: true, nomeCompleto: true, deletedAt: true } }),
    prisma.cadastroFornecedor.findMany({
      select: { id: true, colaboradorCodigo: true, responsavel: true, email: true, telefone: true, razaoSocial: true, cnpjNormalizado: true },
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA" },
      select: { targetCodigo: true, metadata: true },
    }),
  ]);

  const profissionalCodigosByName = new Map<string, Set<string>>();
  const deletedCodigos = new Set<string>();
  for (const p of profissionais) {
    if (!p.codigo) continue; // só profissionais com código canônico já atribuído servem de identidade-alvo
    if (p.deletedAt) deletedCodigos.add(normalizePersonName(p.codigo));
    for (const raw of [p.codigo, p.nome, p.nomeCompleto]) {
      const key = normalizePersonName(raw);
      if (!key) continue;
      const set = profissionalCodigosByName.get(key) ?? new Set<string>();
      set.add(p.codigo);
      profissionalCodigosByName.set(key, set);
    }
  }

  const cadastrosByName = new Map<string, IdentityCandidate[]>();
  const cadastroIdByColaboradorCodigo = new Map<string, string>();
  const cadastroByColaboradorCodigo = new Map<string, IdentityCandidate>();
  for (const c of cadastros) {
    const candidate: IdentityCandidate = {
      cadastroId: c.id,
      colaboradorCodigo: c.colaboradorCodigo,
      responsavel: c.responsavel,
      email: decryptSensitive(c.email),
      telefone: decryptSensitive(c.telefone),
      razaoSocial: c.razaoSocial,
      cnpjNormalizado: c.cnpjNormalizado,
    };
    const nameKey = normalizePersonName(c.responsavel);
    if (nameKey) {
      const list = cadastrosByName.get(nameKey) ?? [];
      list.push(candidate);
      cadastrosByName.set(nameKey, list);
    }
    if (c.colaboradorCodigo) {
      const codigoKey = normalizePersonName(c.colaboradorCodigo);
      cadastroIdByColaboradorCodigo.set(codigoKey, c.id);
      cadastroByColaboradorCodigo.set(codigoKey, candidate);
    }
  }

  const deletedNameHashes = new Map<string, string>();
  for (const exclusao of exclusoes) {
    const hashes = (exclusao.metadata as { identityNameHashes?: unknown } | null)?.identityNameHashes;
    if (Array.isArray(hashes)) for (const hash of hashes) {
      if (typeof hash === "string") deletedNameHashes.set(hash, exclusao.targetCodigo || "IDENTIDADE_EXCLUIDA");
    }
  }
  return { profissionalCodigosByName, cadastrosByName, cadastroIdByColaboradorCodigo, cadastroByColaboradorCodigo, deletedCodigos, deletedNameHashes };
}

/** Atualiza o índice em memória com o resultado de uma escrita — sem isso, duas linhas da MESMA
 * pessoa dentro da MESMA planilha (ex.: duplicidade acidental na própria fonte) recriariam o
 * fornecedor a cada linha, porque o índice só é montado uma vez no início do import. */
function updateIdentityIndex(index: IdentityIndex, row: CadastroRow, result: { cadastroId: string; colaboradorCodigo: string }) {
  const nameKey = normalizePersonName(row.responsavel);
  const codigoKey = normalizePersonName(result.colaboradorCodigo);

  const codigos = index.profissionalCodigosByName.get(nameKey) ?? new Set<string>();
  codigos.add(result.colaboradorCodigo);
  index.profissionalCodigosByName.set(nameKey, codigos);

  index.cadastroIdByColaboradorCodigo.set(codigoKey, result.cadastroId);

  const candidate: IdentityCandidate = {
    cadastroId: result.cadastroId,
    colaboradorCodigo: result.colaboradorCodigo,
    responsavel: row.responsavel,
    email: row.email ?? null,
    telefone: row.telefone ?? null,
    razaoSocial: row.razaoSocial,
    cnpjNormalizado: row.cnpjNormalizado,
  };
  const list = index.cadastrosByName.get(nameKey) ?? [];
  const existingIdx = list.findIndex((c) => c.cadastroId === result.cadastroId);
  if (existingIdx >= 0) list[existingIdx] = candidate;
  else list.push(candidate);
  index.cadastrosByName.set(nameKey, list);
  index.cadastroByColaboradorCodigo.set(codigoKey, candidate);
}

/** Conta quantos sinais cadastrais (e-mail, telefone, razão social) CONTRADIZEM entre um
 * candidato existente e a linha importada — um sinal só conta quando os DOIS lados têm valor E
 * são diferentes; a AUSÊNCIA de dado nunca conta como contradição (planilhas antigas
 * frequentemente têm campos vazios). CNPJ NUNCA participa aqui — é evidência de apoio, nunca
 * usado para bloquear ou exigir um match. */
function countContradictingSignals(candidate: Pick<IdentityCandidate, "email" | "telefone" | "razaoSocial">, row: CadastroRow) {
  let count = 0;
  const emailA = candidate.email?.trim().toLowerCase() || "";
  const emailB = row.email?.trim().toLowerCase() || "";
  if (emailA && emailB && emailA !== emailB) count += 1;

  const telA = onlyDigits(candidate.telefone);
  const telB = onlyDigits(row.telefone);
  if (telA && telB && telA !== telB) count += 1;

  const razA = normalizePersonName(candidate.razaoSocial);
  const razB = normalizePersonName(row.razaoSocial);
  if (razA && razB && razA !== razB) count += 1;

  return count;
}

/** Usado na Prioridade 2 (ainda sem colaboradorCodigo confirmado) — qualquer contradição, mesmo
 * uma só, é suficiente para não considerar o candidato plausível (não há confirmação prévia
 * nenhuma para "perdoar" a divergência). */
function signalsContradict(candidate: Pick<IdentityCandidate, "email" | "telefone" | "razaoSocial">, row: CadastroRow) {
  return countContradictingSignals(candidate, row) >= 1;
}

type FornecedorIdentityResolution =
  | { kind: "PROFISSIONAL_MATCH"; colaboradorCodigo: string }
  | { kind: "CADASTRO_MATCH"; colaboradorCodigo: string; cadastroId: string }
  | { kind: "CREATE"; colaboradorCodigo: string }
  | { kind: "CONFLICT"; candidates: IdentityCandidate[] }
  | { kind: "BLOCKED_DELETED"; colaboradorCodigo: string };

/**
 * Hierarquia de resolução (nunca CNPJ como identidade única, nunca findFirst arbitrário):
 *
 * PRIORIDADE 1 — colaboradorCodigo canônico já existente (Profissional.codigo/nome/nomeCompleto,
 * comparação exata normalizada). Mais de um código distinto compatível = ambíguo -> CONFLICT.
 * Se o único código compatível pertence a um Profissional com `deletedAt` preenchido (excluído
 * definitivamente pelo ADMIN) -> BLOCKED_DELETED — a importação NUNCA reativa uma identidade
 * excluída automaticamente; exige ação administrativa explícita fora deste fluxo.
 *
 * PRIORIDADE 2 — quando não há Profissional ainda, procura CadastroFornecedor existente com o
 * MESMO nome normalizado e sinais cadastrais não-contraditórios (e-mail/telefone/razão social).
 * Exatamente 1 candidato plausível -> atualiza aquele. 2+ candidatos plausíveis -> CONFLICT
 * (ambiguidade real, nunca escolhida sozinha). 0 candidatos (nenhum nome igual, ou só homônimos
 * com sinais contraditórios) -> CREATE.
 */
export function resolveFornecedorIdentity(row: CadastroRow, index: IdentityIndex): FornecedorIdentityResolution {
  const target = normalizePersonName(row.responsavel);
  const codigoFallback = target;
  const deletedCodigo = index.deletedNameHashes?.get(identityNameHash(target));
  if (deletedCodigo) return { kind: "BLOCKED_DELETED", colaboradorCodigo: deletedCodigo };

  const profissionalCodigos = index.profissionalCodigosByName.get(target);
  if (profissionalCodigos && profissionalCodigos.size === 1) {
    const codigo = [...profissionalCodigos][0];
    if (index.deletedCodigos.has(normalizePersonName(codigo))) {
      return { kind: "BLOCKED_DELETED", colaboradorCodigo: codigo };
    }
    // AUDITORIA — HOMÔNIMO NA CAMADA PROFISSIONAL: `Profissional.nome` é @unique e o
    // colaboradorCodigo de um fornecedor novo é derivado deterministicamente do NOME
    // (`codigoFromName`) — então duas pessoas REAIS distintas com o nome IDENTICAMENTE escrito
    // colidiriam no MESMO Profissional/colaboradorCodigo sem este check (a Prioridade 1 confiava
    // cegamente no match por nome, nunca comparando sinais). Antes de reutilizar/atualizar o
    // cadastro já vinculado a este colaboradorCodigo, confirma que os sinais não contradizem
    // FORTEMENTE.
    //
    // Limiar deliberadamente diferente do usado na Prioridade 2 (lá, 1 única contradição já basta
    // — não há nenhuma confirmação prévia de identidade). Aqui já existe uma identidade canônica
    // CONFIRMADA (colaboradorCodigo/Profissional já existe) — atualizar UM campo de contato por
    // vez (ex.: só o e-mail mudou, caso comum e legítimo — a pessoa trocou de e-mail) não pode
    // virar CONFLICT a cada reimportação, senão a identidade canônica deixaria de ser confiável
    // para o próprio caso que ela existe para resolver. Só escalamos quando 2 OU MAIS sinais
    // independentes (e-mail, telefone, razão social) contradizem SIMULTANEAMENTE — isso é uma
    // evidência muito mais forte de que se trata de uma PESSOA DIFERENTE (homônimo real) do que de
    // uma atualização cadastral legítima de contato.
    const cadastroVinculado = index.cadastroByColaboradorCodigo.get(normalizePersonName(codigo));
    if (cadastroVinculado && countContradictingSignals(cadastroVinculado, row) >= 2) {
      // Nome bate, mas 2+ sinais independentes (e-mail/telefone/razão social) contradizem quem já
      // está cadastrado sob esse colaboradorCodigo — evidência forte de HOMÔNIMO real, não de
      // atualização cadastral. Nunca sobrescreve silenciosamente: exige resolução humana.
      return { kind: "CONFLICT", candidates: [cadastroVinculado] };
    }
    return { kind: "PROFISSIONAL_MATCH", colaboradorCodigo: codigo };
  }
  if (profissionalCodigos && profissionalCodigos.size > 1) {
    const candidatos = (index.cadastrosByName.get(target) ?? []).filter((c) => c.colaboradorCodigo && profissionalCodigos.has(c.colaboradorCodigo));
    return { kind: "CONFLICT", candidates: candidatos };
  }

  const candidatosNome = index.cadastrosByName.get(target) ?? [];
  const plausiveis = candidatosNome.filter((c) => !signalsContradict(c, row));

  if (plausiveis.length === 1) {
    const c = plausiveis[0];
    return { kind: "CADASTRO_MATCH", colaboradorCodigo: c.colaboradorCodigo ?? codigoFallback, cadastroId: c.cadastroId };
  }
  if (plausiveis.length >= 2) {
    return { kind: "CONFLICT", candidates: plausiveis };
  }

  // Nenhum candidato plausível: ou não existe ninguém com esse nome ainda, ou existe mas os
  // sinais contradizem (homônimo real — pessoa diferente, mesmo nome) — em ambos os casos, cria.
  return { kind: "CREATE", colaboradorCodigo: codigoFallback };
}

/**
 * Resolve, em lote, o `Usuario` (perfil COLABORADOR) de cada `responsavel` informado — mesma regra
 * de vínculo fornecedor↔acesso usada dentro de `upsertCadastroFornecedor` (match por nome
 * case-insensitive; não há FK real entre `CadastroFornecedor`/`Profissional` e `Usuario`).
 * Consultada em lote (uma única query) pela listagem unificada do Painel Administrativo, para não
 * fazer N+1 nem duplicar a regra de resolução em dois lugares.
 */
export async function findColaboradorUsuarios(nomes: string[]) {
  const wanted = new Set(nomes.map((n) => normalizePersonName(n)).filter(Boolean));
  const map = new Map<string, { id: string; usuario: string; perfil: string; ativo: boolean; email: string | null; primeiroLogin: boolean; senhaTemporaria: string | null }>();
  if (wanted.size === 0) return map;
  // `in` + `mode: insensitive` não é suportado pelo Prisma para filtro de string — carrega todos os
  // COLABORADOR (mesmo padrão de `buildIdentityIndex`, abaixo) e casa em memória por nome normalizado.
  const usuarios = await prisma.usuario.findMany({
    where: { perfil: "COLABORADOR", excluidoAt: null },
    select: { id: true, usuario: true, nome: true, perfil: true, ativo: true, email: true, primeiroLogin: true, senhaTemporaria: true },
  });
  for (const u of usuarios) {
    const key = normalizePersonName(u.nome);
    if (!wanted.has(key)) continue;
    map.set(key, {
      id: u.id,
      usuario: u.usuario,
      perfil: u.perfil,
      ativo: u.ativo,
      email: decryptSensitive(u.email),
      primeiroLogin: u.primeiroLogin,
      senhaTemporaria: u.primeiroLogin ? u.senhaTemporaria : null,
    });
  }
  return map;
}

/**
 * Camada de serviço única para "gravar um CadastroFornecedor" — reusada pela importação XLSX
 * (`importCadastrosFornecedores`, abaixo) E pelo cadastro manual do Painel Administrativo
 * (`POST /api/admin/administrativo/fornecedores/manual`). As duas entradas (planilha e formulário)
 * convergem para cá; a regra de identidade/duplicidade/criação de usuário nunca é reescrita duas
 * vezes. CNPJ NUNCA é usado como identidade única (mais de um fornecedor pode compartilhar o mesmo
 * CNPJ) — ver `resolveFornecedorIdentity` acima para a hierarquia real de identidade.
 *
 * `sharedIndex`: passado pela importação em lote (uma única pré-carga para a planilha inteira,
 * atualizada incrementalmente a cada linha — evita N+1). Chamadas avulsas (cadastro manual)
 * constroem e descartam um índice próprio.
 */
export async function upsertCadastroFornecedor(row: CadastroRow, sharedIndex?: IdentityIndex) {
  const index = sharedIndex ?? (await buildIdentityIndex());
  const resolution = resolveFornecedorIdentity(row, index);

  if (resolution.kind === "CONFLICT") {
    throw new FornecedorIdentityConflictError(
      `Identidade ambígua para "${row.responsavel}" — mais de um cadastro/colaborador compatível encontrado. Resolva manualmente antes de importar esta linha.`,
      resolution.candidates,
    );
  }
  if (resolution.kind === "BLOCKED_DELETED") {
    throw new FornecedorIdentityDeletedError(
      `"${row.responsavel}" corresponde a uma identidade (${resolution.colaboradorCodigo}) excluída definitivamente pelo ADMIN — a importação nunca reativa automaticamente. Requer ação administrativa explícita.`,
      resolution.colaboradorCodigo,
    );
  }

  const colaboradorCodigo = resolution.colaboradorCodigo;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const data = {
      cnpjNormalizado: row.cnpjNormalizado,
      colaboradorCodigo,
      responsavel: row.responsavel,
      razaoSocial: row.razaoSocial,
      statusContrato: row.statusContrato,
      objetoContrato: row.objetoContrato,
      cargo: row.cargo,
      cpf: encryptSensitive(row.cpf),
      cnpj: encryptSensitive(formatCnpj(row.cnpjNormalizado)),
      email: encryptSensitive(row.email),
      telefone: encryptSensitive(row.telefone),
      tipoCt: row.tipoCt,
      tipoContrato: row.tipoContrato,
      valorHora: row.valorHora,
      valorA1Equivalente: row.valorA1Equivalente,
      valorDocumento: row.valorDocumento,
      valorCondicaoFixa: row.valorCondicaoFixa,
      inicio: row.inicio,
      final: row.final,
      statusCadastro: row.statusCadastro,
      primeiroAditivo: row.primeiroAditivo,
      segundoAditivo: row.segundoAditivo,
      rawPayload: row.rawPayload,
    };

    let cadastroId: string;
    let created: boolean;
    if (resolution.kind === "CADASTRO_MATCH") {
      await tx.cadastroFornecedor.update({ where: { id: resolution.cadastroId }, data: { ...data, updatedAt: now } });
      cadastroId = resolution.cadastroId;
      created = false;
    } else {
      // PROFISSIONAL_MATCH: pode já existir um CadastroFornecedor vinculado a este colaboradorCodigo
      // (ex.: cadastro criado antes de qualquer nome bater na busca por nome — edição manual prévia).
      const linkedId = resolution.kind === "PROFISSIONAL_MATCH" ? index.cadastroIdByColaboradorCodigo.get(normalizePersonName(colaboradorCodigo)) : undefined;
      if (linkedId) {
        await tx.cadastroFornecedor.update({ where: { id: linkedId }, data: { ...data, updatedAt: now } });
        cadastroId = linkedId;
        created = false;
      } else {
        const createdRow = await tx.cadastroFornecedor.create({ data });
        cadastroId = createdRow.id;
        created = true;
      }
    }

    await tx.profissional.upsert({
      where: { nome: colaboradorCodigo },
      create: {
        nome: colaboradorCodigo,
        codigo: colaboradorCodigo,
        nomeCompleto: row.responsavel,
        cpf: encryptSensitive(row.cpf),
        cnpj: encryptSensitive(formatCnpj(row.cnpjNormalizado)),
        email: encryptSensitive(row.email),
        razaoSocial: row.razaoSocial,
        funcao: row.cargo,
      },
      update: {
        codigo: colaboradorCodigo,
        nomeCompleto: row.responsavel,
        cpf: encryptSensitive(row.cpf),
        cnpj: encryptSensitive(formatCnpj(row.cnpjNormalizado)),
        email: encryptSensitive(row.email),
        razaoSocial: row.razaoSocial,
        funcao: row.cargo,
        updatedAt: now,
      },
    });

    let usuarioCriado: { usuario: string; nome: string; senha: string; email: string | null } | null = null;
    const existingUser = await tx.usuario.findFirst({
      where: { perfil: "COLABORADOR", nome: { equals: row.responsavel, mode: "insensitive" } },
      select: { id: true, usuario: true, excluidoAt: true },
    });
    if (!existingUser) {
      const senha = generateTempPassword();
      const usuario = await generateUniqueInternalAccessCode(tx);
      await tx.usuario.create({
        data: {
          usuario,
          nome: row.responsavel,
          senhaHash: await hashPassword(senha),
          senhaTemporaria: senha,
          primeiroLogin: true,
          perfil: "COLABORADOR",
        },
      });
      usuarioCriado = { usuario, nome: row.responsavel, senha, email: row.email ?? null };
    } else if (existingUser.excluidoAt) {
      await tx.usuario.update({
        where: { id: existingUser.id },
        data: { nome: row.responsavel, ativo: true, excluidoAt: null, perfil: "COLABORADOR", updatedAt: now },
      });
    }

    return { cadastroId, colaboradorCodigo, created, usuarioCriado };
  });

  updateIdentityIndex(index, row, result);
  return result;
}

export type ImportConflitoDetalhe = {
  responsavel: string;
  cnpj: string;
  motivo: string;
  candidatos: { cadastroId: string; colaboradorCodigo: string | null; email: string | null; telefone: string | null; razaoSocial: string }[];
};

export type ImportBloqueadoDetalhe = {
  responsavel: string;
  cnpj: string;
  motivo: string;
  colaboradorCodigo: string;
};

export async function importCadastrosFornecedores(buffer: Buffer) {
  const rows = parseCadastroFornecedorWorkbook(buffer);
  let atualizados = 0;
  let criados = 0;
  let usuariosCriados = 0;
  const senhasTemporarias: { usuario: string; nome: string; senha: string; email: string | null }[] = [];
  const conflitosDetalhe: ImportConflitoDetalhe[] = [];
  const bloqueadosDetalhe: ImportBloqueadoDetalhe[] = [];

  // Índice construído UMA vez para a planilha inteira (não por linha) — evita N+1 real em
  // importações com dezenas/centenas de fornecedores; atualizado em memória a cada linha
  // processada por `upsertCadastroFornecedor` (via `updateIdentityIndex`).
  const index = await buildIdentityIndex();

  for (const row of rows) {
    try {
      const resultado = await upsertCadastroFornecedor(row, index);
      if (resultado.created) criados += 1;
      else atualizados += 1;
      if (resultado.usuarioCriado) {
        usuariosCriados += 1;
        senhasTemporarias.push(resultado.usuarioCriado);
      }
    } catch (error) {
      if (error instanceof FornecedorIdentityConflictError) {
        // Ambiguidade real (2+ candidatos plausíveis, ou 2+ Profissional distintos compatíveis)
        // — a linha é PULADA (nunca escolhida arbitrariamente) e reportada para análise humana.
        conflitosDetalhe.push({
          responsavel: row.responsavel,
          cnpj: row.cnpj,
          motivo: error.message,
          candidatos: error.candidates.map((c) => ({ cadastroId: c.cadastroId, colaboradorCodigo: c.colaboradorCodigo, email: c.email, telefone: c.telefone, razaoSocial: c.razaoSocial })),
        });
        continue;
      }
      if (error instanceof FornecedorIdentityDeletedError) {
        // Identidade excluída definitivamente pelo ADMIN — a linha é PULADA (nunca reativa
        // automaticamente) e reportada separadamente dos conflitos comuns.
        bloqueadosDetalhe.push({
          responsavel: row.responsavel,
          cnpj: row.cnpj,
          motivo: error.message,
          colaboradorCodigo: error.colaboradorCodigo,
        });
        continue;
      }
      throw error;
    }
  }

  return {
    total: rows.length,
    criados,
    atualizados,
    usuariosCriados,
    conflitos: conflitosDetalhe.length,
    conflitosDetalhe,
    bloqueados: bloqueadosDetalhe.length,
    bloqueadosDetalhe,
    senhasTemporarias,
  };
}

export async function validateFornecedorForNfUpload(colaboradorCodigo: string, usuarioNome?: string | null) {
  const loginCnpj = normalizeCnpjDigits(colaboradorCodigo);
  const cadastros = await prisma.cadastroFornecedor.findMany({
    where: {
      OR: [
        { colaboradorCodigo },
        ...(usuarioNome ? [{ responsavel: { equals: usuarioNome, mode: "insensitive" as const } }] : []),
        ...(loginCnpj.length === 14 && usuarioNome
          ? [{ cnpjNormalizado: loginCnpj, responsavel: { equals: usuarioNome, mode: "insensitive" as const } }]
          : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const selected = selectCadastroForAuthenticatedUser(cadastros, colaboradorCodigo, usuarioNome);
  const cadastro = selected.cadastro;
  if (!cadastro) return { ok: false, error: selected.error, cadastro: null };

  const codigoProfissional = cadastro.colaboradorCodigo;
  if (!codigoProfissional) {
    return { ok: false, error: "Upload bloqueado: cadastro administrativo sem código de colaborador.", cadastro };
  }
  const profissional = await prisma.profissional.findUnique({
    where: { codigo: codigoProfissional, deletedAt: null },
    select: { cnpj: true, nomeCompleto: true, nome: true },
  });
  if (!profissional) {
    return { ok: false, error: "Upload bloqueado: cadastro administrativo sem profissional correspondente.", cadastro };
  }
  const profissionalCnpj = onlyDigits(decryptSensitive(profissional?.cnpj));

  if (profissionalCnpj.length !== 14 || profissionalCnpj !== cadastro.cnpjNormalizado) {
    return {
      ok: false,
      error: "Upload bloqueado por divergência de CNPJ entre a medição e o cadastro administrativo. Entre em contato com a empresa pelos canais oficiais de atendimento via WhatsApp.",
      cadastro,
    };
  }

  const validade = cadastroStatusVisual(cadastro.final, cadastro.statusCadastro);
  if (validade.dias !== null && validade.dias < 0) {
    return {
      ok: false,
      error: "Upload bloqueado: cadastro do fornecedor vencido. Entre em contato com a empresa pelos canais oficiais de atendimento via WhatsApp.",
      cadastro,
    };
  }

  return { ok: true, error: null, cadastro };
}

export function serializeCadastroFornecedor(item: any) {
  const visual = cadastroStatusVisual(item.final, item.statusCadastro);
  const pendencias: string[] = [];
  if (isCadastroPendente(item.statusCadastro)) pendencias.push("Cadastro com pendência");
  if (!item.colaboradorCodigo) pendencias.push("Sem vínculo com fornecedor");
  if (!item.cnpjNormalizado) pendencias.push("CNPJ não informado");
  if (visual.dias !== null && visual.dias < 0) pendencias.push("Cadastro vencido");
  return {
    id: item.id,
    cnpjNormalizado: item.cnpjNormalizado,
    colaboradorCodigo: item.colaboradorCodigo,
    responsavel: item.responsavel,
    razaoSocial: item.razaoSocial,
    statusContrato: item.statusContrato,
    objetoContrato: item.objetoContrato,
    cargo: item.cargo,
    cpf: decryptSensitive(item.cpf),
    cnpj: decryptSensitive(item.cnpj) ?? formatCnpj(item.cnpjNormalizado),
    email: decryptSensitive(item.email),
    telefone: decryptSensitive(item.telefone),
    tipoCt: item.tipoCt,
    tipoContrato: item.tipoContrato,
    valorHora: item.valorHora === null ? null : Number(item.valorHora),
    valorA1Equivalente: item.valorA1Equivalente === null ? null : Number(item.valorA1Equivalente),
    valorDocumento: item.valorDocumento === null ? null : Number(item.valorDocumento),
    valorCondicaoFixa: item.valorCondicaoFixa === null ? null : Number(item.valorCondicaoFixa),
    inicio: item.inicio?.toISOString() ?? null,
    final: item.final?.toISOString() ?? null,
    statusCadastro: item.statusCadastro,
    primeiroAditivo: item.primeiroAditivo,
    segundoAditivo: item.segundoAditivo,
    diasAteVencimento: visual.dias,
    validadeLabel: visual.label,
    validadeTone: visual.tone,
    pendencias,
    updatedAt: item.updatedAt?.toISOString() ?? null,
  };
}

/**
 * Verifica, para um lote de `colaboradorCodigo`, quais têm histórico/relacionamentos de medição
 * que precisam ser PRESERVADOS quando o cadastro administrativo é excluído (nunca para bloquear a
 * exclusão do `CadastroFornecedor` em si — desde a revisão de política, isso é sempre permitido
 * ao ADMIN; o histórico encontrado aqui decide apenas se `Profissional` precisa ser preservado
 * como identidade histórica mínima em vez de removido — ver `deleteFornecedoresDefinitivamente`).
 *
 * Uma única consulta por tabela (com `OR` limitado ao lote pedido, nunca por linha) — evita N+1
 * mesmo com o limite máximo de fornecedores por operação de exclusão.
 */
export async function findColaboradorCodigosWithDependencies(colaboradorCodigos: string[]): Promise<Set<string>> {
  const codigos = [...new Set(colaboradorCodigos.filter(Boolean))];
  if (codigos.length === 0) return new Set();

  const orCodigo = codigos.map((c) => ({ colaboradorCodigo: { equals: c, mode: "insensitive" as const } }));
  const orProjetista = codigos.map((c) => ({ projetistaCodigo: { equals: c, mode: "insensitive" as const } }));
  const orResponsavelCodigo = codigos.map((c) => ({ responsavelCodigo: { equals: c, mode: "insensitive" as const } }));
  const orCodigoProfissional = codigos.map((c) => ({ OR: [{ codigo: { equals: c, mode: "insensitive" as const } }, { codigo: null, nome: { equals: c, mode: "insensitive" as const } }] }));

  const [sgc, mapa, divergencias, logs, bmAux, profissionaisDoLote] = await Promise.all([
    prisma.sgcAprovacaoMedicao.findMany({ where: { OR: orCodigo }, select: { colaboradorCodigo: true }, distinct: ["colaboradorCodigo"] }),
    prisma.mapaPagamentoItem.findMany({ where: { OR: orProjetista }, select: { projetistaCodigo: true }, distinct: ["projetistaCodigo"] }),
    prisma.divergenciaMedicao.findMany({ where: { OR: orCodigo }, select: { colaboradorCodigo: true }, distinct: ["colaboradorCodigo"] }),
    prisma.sgcLog.findMany({ where: { OR: orCodigo }, select: { colaboradorCodigo: true }, distinct: ["colaboradorCodigo"] }),
    // BmAuxMedicao.responsavelCodigo — mesmo padrão de identidade string, sem FK, mas é histórico
    // real de medição (auxiliar do BM) que a exclusão nunca pode deixar de resolver.
    prisma.bmAuxMedicao.findMany({ where: { OR: orResponsavelCodigo }, select: { responsavelCodigo: true }, distinct: ["responsavelCodigo"] }),
    // Medicao (documentos da medição) não é ligado por colaboradorCodigo — é ligado por FK real
    // (idProfissional/idCoordenador -> Profissional.id, com onDelete:SetNull no schema). Para
    // decidir corretamente, primeiro resolve quais Profissional.id correspondem a este lote de
    // colaboradorCodigo, depois verifica Medicao por esses ids — nunca por linha (2 queries no
    // total para todo o lote, não por fornecedor).
    prisma.profissional.findMany({ where: { OR: orCodigoProfissional }, select: { id: true, codigo: true, nome: true } }),
  ]);

  const withDeps = new Set<string>();
  for (const row of sgc) withDeps.add(normalizePersonName(row.colaboradorCodigo));
  for (const row of mapa) if (row.projetistaCodigo) withDeps.add(normalizePersonName(row.projetistaCodigo));
  for (const row of divergencias) withDeps.add(normalizePersonName(row.colaboradorCodigo));
  for (const row of logs) withDeps.add(normalizePersonName(row.colaboradorCodigo));
  for (const row of bmAux) withDeps.add(normalizePersonName(row.responsavelCodigo));

  if (profissionaisDoLote.length > 0) {
    const profissionalIds = profissionaisDoLote.map((p) => p.id);
    const medicoes = await prisma.medicao.findMany({
      where: { OR: [{ idProfissional: { in: profissionalIds } }, { idCoordenador: { in: profissionalIds } }] },
      select: { idProfissional: true, idCoordenador: true },
    });
    if (medicoes.length > 0) {
      const idParaCodigo = new Map(profissionaisDoLote.map((p) => [p.id, normalizePersonName(p.codigo || p.nome)]));
      for (const m of medicoes) {
        if (m.idProfissional && idParaCodigo.has(m.idProfissional)) withDeps.add(idParaCodigo.get(m.idProfissional)!);
        if (m.idCoordenador && idParaCodigo.has(m.idCoordenador)) withDeps.add(idParaCodigo.get(m.idCoordenador)!);
      }
    }
  }

  return withDeps;
}

/**
 * NOTA HISTÓRICA (correção encontrada só ao testar contra o banco real, antes de qualquer deploy):
 * uma versão anterior desta função tentava marcar `Profissional.statusColaborador = "EXCLUIDO"`.
 * `statusColaborador` **parecia** uma coluna livre (100% NULL em toda a produção até então), mas na
 * verdade tem uma CHECK CONSTRAINT real no banco (`database/schema.sql`, não visível no
 * `prisma/schema.prisma` — Prisma não modela CHECK constraints) que só aceita
 * `'ATO' | 'PRODUÇÃO' | NULL` — reservada para status de vínculo empregatício vindo do ETL. Gravar
 * "EXCLUIDO" ali violaria essa constraint em produção (comprovado batendo contra o banco E2E, que
 * espelha o schema real, ANTES de qualquer deploy). A versão seguinte tentou resolver limpando só
 * os campos operacionais (email/cnpj/cpf/razaoSocial/funcao) sem nenhum estado explícito — também
 * insuficiente (não dava para diferenciar "ativo" de "excluído" de forma confiável, nem bloquear o
 * seletor de Novo Pagamento sem heurística arriscada). A versão atual usa `Profissional.deletedAt`
 * — estado explícito e dedicado, nunca deduzido de campos vazios — ver doc abaixo.
 */
export type AdminDeletionSummary = {
  requested: number;
  administrativeDeleted: number;
  usersDeactivated: number;
  usersDeleted: number;
  professionalsDeleted: number;
  professionalsPreservedForHistory: number;
  measurementHistoryPreserved: number;
  errors: { id: string; error: string }[];
};

/**
 * Exclusão DEFINITIVA de fornecedor(es) pelo ADMIN.
 *
 * SEPARA duas camadas:
 *   1. DADOS ADMINISTRATIVOS/OPERACIONAIS — `CadastroFornecedor` e o acesso (`Usuario`) — o ADMIN
 *      pode remover/desativar completamente, mesmo havendo histórico de medição.
 *   2. DADOS HISTÓRICOS DE MEDIÇÃO — SgcAprovacaoMedicao, MapaPagamentoItem, DivergenciaMedicao,
 *      SgcLog, BmAuxMedicao, Medicao (NF/comprovante vivem dentro de SgcAprovacaoMedicao) — NUNCA
 *      tocados (nem valores, nem existência). Nenhum DELETE CASCADE: não existe FK de nenhuma
 *      dessas tabelas para `CadastroFornecedor.id` (verificado no schema), e a de `Medicao` para
 *      `Profissional.id` é `onDelete: SetNull` — por isso `Profissional` é preservado (nunca
 *      apagado) sempre que tiver histórico real, evitando o SetNull silencioso que apagaria a
 *      autoria da medição.
 *
 * `CadastroFornecedor`: SEMPRE removido fisicamente (nunca tem FK apontando para ele — remover não
 * corrompe nada no banco). É a linha "administrativa" propriamente dita.
 *
 * `Profissional` (só reavaliado quando este é o ÚLTIMO CadastroFornecedor daquela identidade —
 * enquanto sobrar outro cadastro para o mesmo colaboradorCodigo, a pessoa continua uma fornecedora
 * ativa e nada aqui é tocado):
 *   - SEM histórico de medição -> preservado como tombstone técnico e marcado como excluído.
 *   - COM histórico de medição -> preservado como tombstone técnico, nunca apagado, e marcado como excluído
 *     através de `deletedAt`/`deletedById`/`deletedByNome`/`deletedReason` (estado explícito e
 *     dedicado — NUNCA deduzido a partir de campos vazios). Dados operacionais/pessoais são
 *     removidos: `email`, `cnpj`, `cpf`, `razaoSocial`, `funcao`, `nomeCompleto` viram `null`.
 *     `codigo` é preservado por integridade referencial (em bases legadas pode conter um nome):
 *     `codigo` é a chave usada por `MapaPagamentoItem.projetistaCodigo`,
 *     `BmAuxMedicao.responsavelCodigo`, `SgcAprovacaoMedicao.colaboradorCodigo` e `SgcLog` para
 *     todo o histórico existente — apagá-lo quebraria esses joins. `nome` é substituído por
 *     `EXCLUIDO-<uuid>`, mantendo NOT NULL/unicidade sem preservar o nome pessoal nesse campo.
 *     Hashes dos aliases no log impedem recriação pelo nome após a anonimização, sem copiar
 *     CPF/CNPJ/e-mail nem o nome original para a auditoria. São pseudônimos, não anonimização forte.
 *
 *     ANTES de limpar `nomeCompleto`, esta função faz backfill de
 *     `Medicao.profissionalNomeSnapshot`/`coordenadorNomeSnapshot` (colunas dedicadas, adicionadas
 *     nesta tarefa) para toda `Medicao` que referencia este `Profissional` e ainda não tem
 *     snapshot — assim "Histórico de Medições"/Boletim continuam mostrando quem mediu mesmo depois
 *     do cadastro operacional ter sido anonimizado, sem depender do registro vivo de Profissional.
 *
 * `Usuario`: NUNCA apagado fisicamente — sempre DESATIVADO (`ativo:false, excluidoAt:now()`, o
 * MESMO mecanismo de soft-delete já usado em outros pontos do app, ex.: reativação de usuário em
 * `upsertCadastroFornecedor`). Motivo: `ChatMensagem.autor` e `ChatParticipante.usuario` têm
 * `onDelete: Cascade` no schema — apagar `Usuario` fisicamente apagaria em cascata as mensagens de
 * chat dessa pessoa, inclusive em conversas com OUTRAS pessoas que dependem desse histórico. Soft-
 * delete evita esse risco por completo e já é suficiente: `verifySessionToken` (lib/session.ts)
 * consulta `ativo`/`excluidoAt` no banco a CADA requisição — a sessão existente do fornecedor
 * para de ser aceita na próxima requisição, sem nenhum mecanismo adicional. `POST /api/auth/login`
 * já rejeita `excluidoAt`/`!ativo`. Não há fluxo de "esqueci minha senha" autosserviço neste app
 * (reset é sempre iniciado por ADMIN) — como o login já fica bloqueado, um reset não teria como o
 * fornecedor excluído sequer solicitar.
 *
 * `GET /api/profissionais` (seletor de Novo Pagamento), `resolveProjetistaCodigo`
 * (lib/mapa-pagamento.ts) e `resolveFornecedorEmail` (lib/email/resolve-recipients.ts) agora
 * filtram/checam `deletedAt` diretamente — estado real e explícito, não mais a heurística
 * descartada de "sem CadastroFornecedor" (que escondia 44 dos 49 Profissional reais).
 *
 * Nenhum mecanismo de restauração é criado nesta tarefa — `deletedAt` existe para integridade
 * referencial, filtro confiável e auditoria, não para uma "lixeira" reativável pela interface.
 */
export type IdentityCleanupPlan =
  | { codigoKey: string; action: "SKIP_STILL_ACTIVE" }
  | { codigoKey: string; action: "PRESERVE_PROFISSIONAL_FOR_HISTORY"; profissionalId: string | null }
  | { codigoKey: string; action: "DELETE_PROFISSIONAL"; profissionalId: string }
  | { codigoKey: string; action: "NO_PROFISSIONAL_NO_HISTORY" };

/**
 * Decide, por identidade (colaboradorCodigo) distinta entre os cadastros solicitados, o que fazer
 * com `Profissional` — função PURA (sem chamada a banco), testável diretamente. `deleteFornecedoresDefinitivamente`
 * usa este plano para decidir as escritas dentro da transação.
 */
export function planIdentityCleanup(params: {
  codigosDosCadastrosSolicitados: string[]; // colaboradorCodigo (bruto) de cada CadastroFornecedor solicitado, na ordem, com duplicatas
  restamPorCodigo: Map<string, number>; // codigoKey -> quantos CadastroFornecedor sobrevivem depois desta operação
  codigosComHistorico: Set<string>; // codigoKey
  profissionalPorCodigo: Map<string, { id: string }>; // codigoKey
}): IdentityCleanupPlan[] {
  const { codigosDosCadastrosSolicitados, restamPorCodigo, codigosComHistorico, profissionalPorCodigo } = params;
  const plans: IdentityCleanupPlan[] = [];
  const processados = new Set<string>();

  for (const codigoRaw of codigosDosCadastrosSolicitados) {
    const codigoKey = normalizePersonName(codigoRaw);
    if (!codigoKey || processados.has(codigoKey)) continue;
    processados.add(codigoKey);

    if ((restamPorCodigo.get(codigoKey) ?? 0) > 0) {
      plans.push({ codigoKey, action: "SKIP_STILL_ACTIVE" });
      continue;
    }

    const temHistorico = codigosComHistorico.has(codigoKey);
    const profissional = profissionalPorCodigo.get(codigoKey);

    if (temHistorico) {
      plans.push({
        codigoKey,
        action: "PRESERVE_PROFISSIONAL_FOR_HISTORY",
        profissionalId: profissional?.id ?? null,
      });
    } else if (profissional) {
      plans.push({ codigoKey, action: "DELETE_PROFISSIONAL", profissionalId: profissional.id });
    } else {
      plans.push({ codigoKey, action: "NO_PROFISSIONAL_NO_HISTORY" });
    }
  }

  return plans;
}

export async function deleteFornecedoresDefinitivamente(
  ids: string[],
  admin: { id: string; usuario: string; nome: string },
  reason?: string | null,
): Promise<AdminDeletionSummary> {
  const cadastros = await prisma.cadastroFornecedor.findMany({
    where: { id: { in: ids } },
    select: { id: true, colaboradorCodigo: true, responsavel: true },
  });
  const foundIds = new Set(cadastros.map((c) => c.id));
  const errors: { id: string; error: string }[] = [];
  for (const id of ids) {
    if (!foundIds.has(id)) errors.push({ id, error: "Registro não encontrado (já excluído ou inexistente)." });
  }

  const codigos = [...new Set(cadastros.map((c) => c.colaboradorCodigo).filter((c): c is string => !!c))];
  const codigoOriginalPorKey = new Map<string, string>();
  for (const c of cadastros) {
    if (c.colaboradorCodigo) codigoOriginalPorKey.set(normalizePersonName(c.colaboradorCodigo), c.colaboradorCodigo);
  }

  const [todosCadastrosDosCodigos, codigosComHistorico, profissionaisDosCodigos] = await Promise.all([
    codigos.length > 0
      ? prisma.cadastroFornecedor.findMany({
          where: { OR: codigos.map((c) => ({ colaboradorCodigo: { equals: c, mode: "insensitive" as const } })) },
          select: { id: true, colaboradorCodigo: true },
        })
      : Promise.resolve([]),
    findColaboradorCodigosWithDependencies(codigos),
    codigos.length > 0
      ? prisma.profissional.findMany({
          where: { OR: codigos.map((c) => ({ OR: [{ codigo: { equals: c, mode: "insensitive" as const } }, { codigo: null, nome: { equals: c, mode: "insensitive" as const } }] })) },
          select: { id: true, codigo: true, nome: true, nomeCompleto: true },
        })
      : Promise.resolve([]),
  ]);

  const totalPorCodigo = new Map<string, string[]>(); // codigoKey -> todos os ids de CadastroFornecedor existentes
  for (const c of todosCadastrosDosCodigos) {
    if (!c.colaboradorCodigo) continue;
    const key = normalizePersonName(c.colaboradorCodigo);
    const list = totalPorCodigo.get(key) ?? [];
    list.push(c.id);
    totalPorCodigo.set(key, list);
    if (!codigoOriginalPorKey.has(key)) codigoOriginalPorKey.set(key, c.colaboradorCodigo);
  }
  const profissionalPorCodigo = new Map(profissionaisDosCodigos.map((p) => [normalizePersonName(p.codigo || p.nome), p]));

  const requestedIdSet = new Set(ids);
  const restamPorCodigo = new Map<string, number>();
  for (const [key, allIds] of totalPorCodigo) {
    const removendo = allIds.filter((id) => requestedIdSet.has(id)).length;
    restamPorCodigo.set(key, allIds.length - removendo);
  }

  let administrativeDeleted = 0;
  let usersDeactivated = 0;
  let professionalsDeleted = 0;
  let professionalsPreservedForHistory = 0;
  let measurementHistoryPreserved = 0;

  const idsParaDeletar = cadastros.map((c) => c.id);
  const responsavelPorCodigo = new Map(cadastros.filter((c) => c.colaboradorCodigo).map((c) => [normalizePersonName(c.colaboradorCodigo!), c.responsavel]));

  const plans = planIdentityCleanup({
    codigosDosCadastrosSolicitados: cadastros.map((c) => c.colaboradorCodigo).filter((c): c is string => !!c),
    restamPorCodigo,
    codigosComHistorico,
    profissionalPorCodigo,
  });

  const reasonTrimmed = reason?.trim() || null;
  const auditEntries: { action: string; targetType: string; targetId: string | null; targetCodigo: string | null; metadata: Record<string, unknown> }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      if (profissionalPorCodigo.size !== profissionaisDosCodigos.length) {
        throw new Error("Identidade profissional ambígua: exclusão cancelada sem alterações.");
      }
      for (const cadastro of cadastros.filter((c) => !c.colaboradorCodigo)) {
        const [profissional, usuario] = await Promise.all([
          tx.profissional.findFirst({ where: { deletedAt: null, OR: [{ nome: { equals: cadastro.responsavel, mode: "insensitive" } }, { nomeCompleto: { equals: cadastro.responsavel, mode: "insensitive" } }] }, select: { id: true } }),
          tx.usuario.findFirst({ where: { perfil: "COLABORADOR", excluidoAt: null, nome: { equals: cadastro.responsavel, mode: "insensitive" } }, select: { id: true } }),
        ]);
        if (profissional || usuario) throw new Error("Cadastro legado sem código vinculado: regularize a identidade canônica antes de excluir. Nenhum dado foi alterado.");
      }
      if (idsParaDeletar.length > 0) {
        const result = await tx.cadastroFornecedor.deleteMany({ where: { id: { in: idsParaDeletar } } });
        administrativeDeleted = result.count;
      }
      for (const cadastro of cadastros.filter((c) => !c.colaboradorCodigo)) {
        auditEntries.push({ action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", targetType: "CadastroFornecedor", targetId: cadastro.id, targetCodigo: null,
          metadata: { resultado: "SEM_CODIGO_VINCULADO", identityNameHashes: [identityNameHash(cadastro.responsavel)] } });
      }

      for (const plan of plans) {
        if (plan.action === "SKIP_STILL_ACTIVE") {
          auditEntries.push({ action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", targetType: "CadastroFornecedor", targetId: null, targetCodigo: plan.codigoKey,
            metadata: { resultado: "CADASTRO_REDUNDANTE_REMOVIDO_IDENTIDADE_ATIVA" } });
          continue;
        }

        const profissionalCompleto = profissionalPorCodigo.get(plan.codigoKey);
        const profissionalNomeParaUsuario = profissionalCompleto?.nomeCompleto || profissionalCompleto?.nome || null;
        const codigoOriginal = codigoOriginalPorKey.get(plan.codigoKey) ?? plan.codigoKey;
        const cadastrosRemovidosDestaIdentidade = cadastros.filter((c) => c.colaboradorCodigo && normalizePersonName(c.colaboradorCodigo) === plan.codigoKey).length;
        const auditCountBefore = auditEntries.length;

        if (plan.action === "PRESERVE_PROFISSIONAL_FOR_HISTORY") {
          measurementHistoryPreserved += 1;
          if (plan.profissionalId) {
            const nomeParaSnapshot = profissionalNomeParaUsuario;
            // Backfill do snapshot ANTES de anonimizar Profissional.nomeCompleto — só preenche onde
            // ainda está vazio (nunca sobrescreve um snapshot já gravado por uma exclusão anterior).
            if (nomeParaSnapshot) {
              await tx.medicao.updateMany({
                where: { idProfissional: plan.profissionalId, profissionalNomeSnapshot: null },
                data: { profissionalNomeSnapshot: nomeParaSnapshot },
              });
              await tx.medicao.updateMany({
                where: { idCoordenador: plan.profissionalId, coordenadorNomeSnapshot: null },
                data: { coordenadorNomeSnapshot: nomeParaSnapshot },
              });
            }
            // Idempotente por natureza: reprocessar uma identidade já excluída (ex.: reavaliação
            // após um novo CadastroFornecedor legado apontando pra cá) só reafirma o mesmo estado.
            await tx.profissional.update({
              where: { id: plan.profissionalId },
              data: {
                nome: `EXCLUIDO-${plan.profissionalId}`,
                codigo: profissionalCompleto?.codigo || codigoOriginal,
                email: null,
                cnpj: null,
                cpf: null,
                razaoSocial: null,
                funcao: null,
                nomeCompleto: null,
                deletedAt: new Date(),
                deletedById: admin.id,
                deletedByNome: admin.nome,
                deletedReason: reasonTrimmed,
                updatedAt: new Date(),
              },
            });
            professionalsPreservedForHistory += 1;
            auditEntries.push({
              action: "FORNECEDOR_EXCLUSAO_DEFINITIVA",
              targetType: "Profissional",
              targetId: plan.profissionalId,
              targetCodigo: codigoOriginal,
              metadata: {
                resultado: "PRESERVADO_PARA_HISTORICO",
                cadastrosAdministrativosRemovidos: cadastrosRemovidosDestaIdentidade,
              },
            });
          }
        } else if (plan.action === "DELETE_PROFISSIONAL") {
          await tx.profissional.update({
            where: { id: plan.profissionalId },
            data: {
              nome: `EXCLUIDO-${plan.profissionalId}`,
              codigo: profissionalCompleto?.codigo || codigoOriginal,
              nomeCompleto: null,
              email: null,
              cnpj: null,
              cpf: null,
              razaoSocial: null,
              funcao: null,
              deletedAt: new Date(),
              deletedById: admin.id,
              deletedByNome: admin.nome,
              deletedReason: reasonTrimmed,
              updatedAt: new Date(),
            },
          });
          professionalsDeleted += 1;
          auditEntries.push({
            action: "FORNECEDOR_EXCLUSAO_DEFINITIVA",
            targetType: "Profissional",
            targetId: plan.profissionalId,
            targetCodigo: codigoOriginal,
            metadata: { resultado: "EXCLUIDO_OPERACIONALMENTE_SEM_HISTORICO", cadastrosAdministrativosRemovidos: cadastrosRemovidosDestaIdentidade },
          });
        } else {
          auditEntries.push({
            action: "FORNECEDOR_EXCLUSAO_DEFINITIVA",
            targetType: "CadastroFornecedor",
            targetId: null,
            targetCodigo: codigoOriginal,
            metadata: { resultado: "SEM_PROFISSIONAL_VINCULADO", cadastrosAdministrativosRemovidos: cadastrosRemovidosDestaIdentidade },
          });
        }

        if (auditEntries.length === auditCountBefore) {
          auditEntries.push({ action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", targetType: "CadastroFornecedor", targetId: null, targetCodigo: codigoOriginal,
            metadata: { resultado: "HISTORICO_SEM_PROFISSIONAL_VINCULADO" } });
        }
        // Usuario nunca é apagado fisicamente (ver docstring) — sempre desativado.
        const nomeParaUsuario = profissionalNomeParaUsuario || responsavelPorCodigo.get(plan.codigoKey) || "";
        if (!nomeParaUsuario) continue;
        const usuarios = await tx.usuario.findMany({
          where: { perfil: "COLABORADOR", nome: { equals: nomeParaUsuario, mode: "insensitive" }, excluidoAt: null },
          select: { id: true },
        });
        if (usuarios.length > 1) throw new Error("Identidade de acesso ambígua: exclusão cancelada para preservar outros usuários.");
        const usuario = usuarios[0];
        if (usuario) {
          await tx.usuario.update({ where: { id: usuario.id }, data: { ativo: false, excluidoAt: new Date(), email: null, senhaTemporaria: null, primeiroLogin: false, onlineAt: null, avatarArquivo: null, avatarMime: null, avatarAtualizadoAt: null } });
          usersDeactivated += 1;
          const last = auditEntries[auditEntries.length - 1];
          if (last) { last.metadata.usuarioDesativado = true; last.metadata.usuarioId = usuario.id; }
        }
      }

      if (auditEntries.length > 0) {
        await tx.adminAuditLog.createMany({
          data: auditEntries.map((entry) => ({
            action: entry.action,
            adminId: admin.id,
            adminUsuario: admin.usuario,
            adminNome: admin.nome,
            targetType: entry.targetType,
            targetId: entry.targetId,
            targetCodigo: entry.targetCodigo,
            reason: reasonTrimmed,
            metadata: {
              ...entry.metadata,
              ...(entry.targetCodigo && entry.metadata.resultado !== "CADASTRO_REDUNDANTE_REMOVIDO_IDENTIDADE_ATIVA" ? {
                identityNameHashes: [...new Set([
                  profissionalPorCodigo.get(normalizePersonName(entry.targetCodigo))?.nome,
                  profissionalPorCodigo.get(normalizePersonName(entry.targetCodigo))?.nomeCompleto,
                  entry.targetCodigo,
                  ...cadastros.filter((c) => normalizePersonName(c.colaboradorCodigo) === normalizePersonName(entry.targetCodigo)).map((c) => c.responsavel),
                ].filter((value): value is string => !!value).map(identityNameHash))],
              } : {}),
            },
          })),
        });
      }
    });
  } catch (error) {
    // Transação falhou — nada foi commitado (Prisma faz rollback automático). Nunca deixa uma
    // exclusão parcial incoerente (ex.: CadastroFornecedor removido mas Usuario ainda ativo).
    return {
      requested: ids.length,
      administrativeDeleted: 0,
      usersDeactivated: 0,
      usersDeleted: 0,
      professionalsDeleted: 0,
      professionalsPreservedForHistory: 0,
      measurementHistoryPreserved: 0,
      errors: [...errors, { id: "-", error: error instanceof Error ? error.message : "Falha na transação de exclusão — nada foi alterado." }],
    };
  }

  return {
    requested: ids.length,
    administrativeDeleted,
    usersDeactivated,
    usersDeleted: 0,
    professionalsDeleted,
    professionalsPreservedForHistory,
    measurementHistoryPreserved,
    errors,
  };
}
