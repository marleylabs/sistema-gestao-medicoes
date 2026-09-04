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
  /** `undefined` (padrão, nunca preenchido pela importação em planilha — não existe essa coluna)
   * significa "não alterar o valor já gravado"; só rotas que EXPÕEM esse campo explicitamente (o
   * cadastro manual/edição no Painel Administrativo) devem passar um valor real aqui — nunca
   * `undefined` nesses fluxos, para não perder silenciosamente uma configuração condicional já
   * feita quando o mesmo fornecedor for reimportado pela planilha. */
  tipoCondicaoFixa?: string | null;
  valorCondicaoFixaComProducao?: number | null;
  valorCondicaoFixaSemProducao?: number | null;
  /** Mesmo contrato de `tipoCondicaoFixa` acima: `undefined` (padrão da importação em planilha —
   * não existe essa coluna na Consulta PJ) = não alterar; só o cadastro manual/edição administrativa
   * deve passar um valor real, para uma reimportação da planilha nunca sobrescrever silenciosamente
   * uma configuração de "Fonte da medição" já feita (item 17 do pedido). */
  fonteMedicao?: string | null;
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

/**
 * CAUSA RAIZ encontrada nesta auditoria: célula vazia (`value` null/undefined) ou só espaços virava
 * `String(value ?? "")` = `""` — e `Number("")`/`Number("   ")` é `0` em JavaScript (não `NaN`), então
 * o guard `Number.isFinite(numeric)` deixava passar como um zero "válido". Resultado real: 42
 * CadastroFornecedor no banco dev com `valorCondicaoFixa = 0` para fornecedores cuja célula
 * "CONDICAO FIXA" na planilha estava simplesmente vazia — violando a regra "ausência ≠ zero"
 * estabelecida para a condição fixa condicional. Corrigido tratando string vazia (após trim) como
 * ausência ANTES de chamar `Number(...)` — célula com "0"/"R$ 0,00" explícito continua virando 0
 * normalmente (só isso passa pelo `Number(...)`).
 */
function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/\./g, "").replace(",", ".").trim();
  if (!text) return null;
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

/**
 * "Essa identidade ESTÁ excluída AGORA?" — nunca "já foi excluída alguma vez". O registro de
 * auditoria (`identityNameHashes`) é permanente por natureza (histórico nunca se apaga), então
 * checar só a presença dele bloquearia PARA SEMPRE qualquer identidade que um dia foi excluída e
 * depois reativada por uma reimportação administrativa válida (ver
 * `resolveFornecedorIdentity`/`upsertCadastroFornecedor`, `reactivatingDeletedIdentity`) — bug real
 * encontrado ao corrigir a reimportação: e-mail, edição de pagamento e provisionamento de acesso
 * continuavam bloqueados mesmo depois do fornecedor voltar a existir normalmente. A checagem real é
 * sempre o estado ATUAL de `Profissional.deletedAt`.
 */
export async function isDeletedFornecedorIdentityName(nomeOuCodigo: string) {
  const exclusao = await prisma.adminAuditLog.findFirst({
    where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", metadata: { path: ["identityNameHashes"], array_contains: [identityNameHash(nomeOuCodigo)] } },
    select: { targetCodigo: true },
    orderBy: { createdAt: "desc" },
  });
  if (!exclusao) return false;
  // SEM_CODIGO_VINCULADO — nenhum Profissional foi vinculado no momento da exclusão, não há nada
  // para reativar; permanece bloqueado indefinidamente (mesma política de sempre para esse caso).
  if (!exclusao.targetCodigo) return true;
  const profissional = await prisma.profissional.findUnique({ where: { codigo: exclusao.targetCodigo }, select: { deletedAt: true } });
  return !!profissional?.deletedAt;
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
  /** Códigos históricos candidatos quando o conflito vem de colisão de hash de nome (ver
   * `resolveFornecedorIdentity`, Prioridade 1B) — usado pelo fluxo de resolução manual
   * (`GET .../candidatos-identidade`) para saber quais códigos buscar detalhes. */
  candidateCodigos?: string[];
  constructor(message: string, candidates: IdentityCandidate[], candidateCodigos?: string[]) {
    super(message);
    this.name = "FornecedorIdentityConflictError";
    this.candidates = candidates;
    this.candidateCodigos = candidateCodigos;
  }
}

/** Lançada quando a linha importada/cadastrada resolve para um `colaboradorCodigo` cujo
 * `Profissional` foi excluído definitivamente pelo ADMIN (`deletedAt` preenchido) — reservada para
 * um bloqueio genuíno de regra de negócio (ver `FornecedorIdentityResolution["BLOCKED_DELETED"]` —
 * não usada atualmente por `resolveFornecedorIdentity`, mantida para não remover a infraestrutura
 * de tratamento já existente). */
export class FornecedorIdentityDeletedError extends Error {
  colaboradorCodigo: string;
  constructor(message: string, colaboradorCodigo: string) {
    super(message);
    this.name = "FornecedorIdentityDeletedError";
    this.colaboradorCodigo = colaboradorCodigo;
  }
}

/** Lançada quando o nome da linha corresponde ao histórico de uma exclusão administrativa sem
 * NENHUM `colaboradorCodigo` vinculado no momento (`SEM_CODIGO_VINCULADO`) — não há identidade
 * histórica (nem sequer um código) para reaproveitar com segurança; nunca é um CREATE silencioso,
 * exige decisão humana explícita (ver `resolveFornecedorIdentity`, resolução `REQUIRES_REVIEW`). */
export class FornecedorIdentityReviewError extends Error {
  motivo: string;
  constructor(motivo: string) {
    super(motivo);
    this.name = "FornecedorIdentityReviewError";
    this.motivo = motivo;
  }
}

/** Lançada quando mais de um `Usuario` COLABORADOR com o mesmo nome normalizado é encontrado ao
 * tentar reativar/vincular acesso durante um upsert — condição 7/8 do RECREATE_FROM_HISTORY
 * (relacionar o Usuario de forma inequívoca); nunca escolhe o primeiro encontrado. */
export class FornecedorUsuarioAmbiguoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FornecedorUsuarioAmbiguoError";
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
   * marcar a resolução como reativação explícita (`reactivatingDeletedIdentity`) quando uma
   * reimportação válida da planilha administrativa encontra a mesma identidade excluída (ver
   * `resolveFornecedorIdentity`/`upsertCadastroFornecedor` — reutiliza `codigo`/Profissional/
   * Usuario e recria só o `CadastroFornecedor` ausente, nunca gera identidade nova). */
  deletedCodigos: Set<string>;
  /** hash sha256 do nome normalizado -> conjunto de `colaboradorCodigo` históricos associados a
   * ele na auditoria de exclusões. NUNCA um valor único — dois códigos históricos DISTINTOS podem
   * compartilhar o mesmo nome gravado (caso real encontrado: duas identidades, uma delas com um
   * `responsavel` histórico igual ao nome completo da outra) — se isso acontecer, a resolução tem
   * que virar CONFLICT, nunca escolher um dos dois (nem o primeiro, nem o último). Usado para
   * `RECREATE_FROM_HISTORY` (hash único, sem Profissional atual/tombstoned e sem nenhum outro
   * candidato ativo — ver `resolveFornecedorIdentity`). */
  deletedNameHashes?: Map<string, Set<string>>;
  /** hash sha256 do nome normalizado de identidades excluídas SEM NENHUM `colaboradorCodigo`
   * vinculado no momento da exclusão (`SEM_CODIGO_VINCULADO`) — não existe nenhum código histórico
   * para reaproveitar numa recriação seguindo o mesmo padrão de `Profissional.codigo`, então nunca
   * vira `RECREATE_FROM_HISTORY` nem `BLOCKED_DELETED` genérico: sinaliza `REQUIRES_REVIEW`,
   * explícito de que precisa de decisão humana (não é bloqueio de regra de negócio, é ausência de
   * dado suficiente para reconstruir a identidade com segurança). */
  noCodeExclusionHashes?: Set<string>;
  /** colaboradorCodigo (normalizado) -> configurações administrativas (fonteMedicao/
   * tipoCondicaoFixa/valorCondicaoFixaComProducao/valorCondicaoFixaSemProducao) preservadas no
   * momento da exclusão definitiva mais recente dessa identidade — restauradas quando o upsert
   * recria o CadastroFornecedor (RECREATE_FROM_HISTORY ou reativação de Profissional excluído) e a
   * linha reimportada não traz esses campos explicitamente (ver `upsertCadastroFornecedor`). */
  administrativeConfigSnapshots?: Map<string, AdministrativeConfigSnapshot>;
};

async function buildIdentityIndex(): Promise<IdentityIndex> {
  const [profissionais, cadastros, exclusoes] = await Promise.all([
    prisma.profissional.findMany({ select: { codigo: true, nome: true, nomeCompleto: true, deletedAt: true } }),
    prisma.cadastroFornecedor.findMany({
      select: { id: true, colaboradorCodigo: true, responsavel: true, email: true, telefone: true, razaoSocial: true, cnpjNormalizado: true },
    }),
    prisma.adminAuditLog.findMany({
      where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA" },
      select: { targetCodigo: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "asc" },
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

  const deletedNameHashes = new Map<string, Set<string>>();
  const noCodeExclusionHashes = new Set<string>();
  // Última exclusão (a query já vem ordenada por createdAt asc) com snapshot vence — se a mesma
  // identidade foi excluída/recriada/excluída de novo mais de uma vez, só a config mais recente
  // importa.
  const administrativeConfigSnapshots = new Map<string, AdministrativeConfigSnapshot>();
  for (const exclusao of exclusoes) {
    const metadata = exclusao.metadata as { identityNameHashes?: unknown; administrativeConfigSnapshot?: unknown } | null;
    if (exclusao.targetCodigo && metadata?.administrativeConfigSnapshot && typeof metadata.administrativeConfigSnapshot === "object") {
      administrativeConfigSnapshots.set(normalizePersonName(exclusao.targetCodigo), metadata.administrativeConfigSnapshot as AdministrativeConfigSnapshot);
    }

    const hashes = metadata?.identityNameHashes;
    if (!Array.isArray(hashes)) continue;
    if (!exclusao.targetCodigo) {
      // SEM_CODIGO_VINCULADO — sem código histórico nenhum para reaproveitar.
      for (const hash of hashes) if (typeof hash === "string") noCodeExclusionHashes.add(hash);
      continue;
    }
    for (const hash of hashes) {
      if (typeof hash !== "string") continue;
      const set = deletedNameHashes.get(hash) ?? new Set<string>();
      set.add(exclusao.targetCodigo);
      deletedNameHashes.set(hash, set);
    }
  }
  return { profissionalCodigosByName, cadastrosByName, cadastroIdByColaboradorCodigo, cadastroByColaboradorCodigo, deletedCodigos, deletedNameHashes, noCodeExclusionHashes, administrativeConfigSnapshots };
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
  | { kind: "PROFISSIONAL_MATCH"; colaboradorCodigo: string; reactivatingDeletedIdentity?: boolean }
  | { kind: "CADASTRO_MATCH"; colaboradorCodigo: string; cadastroId: string }
  | { kind: "CREATE"; colaboradorCodigo: string }
  | { kind: "RECREATE_FROM_HISTORY"; colaboradorCodigo: string }
  | { kind: "CONFLICT"; candidates: IdentityCandidate[]; reason?: string; candidateCodigos?: string[] }
  | { kind: "REQUIRES_REVIEW"; motivo: string }
  /** Reservado para um bloqueio genuíno de regra de negócio (não usado atualmente por
   * `resolveFornecedorIdentity` — toda ambiguidade vira `CONFLICT`, toda identidade sem código
   * histórico suficiente vira `REQUIRES_REVIEW`). Mantido no tipo para não remover a
   * infraestrutura de tratamento já existente (`FornecedorIdentityDeletedError`,
   * `bloqueadosDetalhe`) caso uma regra de negócio real precise dele no futuro. */
  | { kind: "BLOCKED_DELETED"; colaboradorCodigo: string };

/**
 * Hierarquia de resolução (nunca CNPJ como identidade única, nunca findFirst arbitrário):
 *
 * PRIORIDADE 1 — colaboradorCodigo canônico já existente (Profissional.codigo/nome/nomeCompleto,
 * comparação exata normalizada). Mais de um código distinto compatível = ambíguo -> CONFLICT.
 * Se o único código compatível pertence a um Profissional com `deletedAt` preenchido (excluído
 * definitivamente pelo ADMIN), a linha resolve para PROFISSIONAL_MATCH com
 * `reactivatingDeletedIdentity: true` — uma reimportação válida da planilha administrativa
 * (Consulta PJ) É uma ação administrativa explícita, e reutiliza `codigo`/`Profissional`/`Usuario`
 * já existentes, recriando apenas o `CadastroFornecedor` que estava ausente (nunca gera novo
 * código, nunca duplica Profissional/Usuario). Ver `upsertCadastroFornecedor` para a reativação em
 * si.
 *
 * PRIORIDADE 1B — REATIVAÇÃO POR HASH DE NOME. A exclusão administrativa anonimiza
 * `Profissional.nome`/`nomeCompleto` (viram `EXCLUIDO-<uuid>`/`null`) — isso quebra a Prioridade 1
 * quando `codigo` é um código técnico DISTINTO do nome (ex.: `P0123456` atribuído pelo ETL do lado
 * de medição, nunca derivado do nome) e a planilha, como sempre, identifica a linha pelo NOME, não
 * pelo código. `deletedNameHashes` guarda hash(nome-original) -> conjunto de `colaboradorCodigo`
 * históricos associados a ele:
 *   - conjunto com 2+ códigos DISTINTOS -> CONFLICT imediato (nunca escolhe um dos dois — caso real
 *     encontrado: duas identidades diferentes, uma com um `responsavel` histórico igual ao nome
 *     completo da outra, produzindo o mesmo hash apontando pra ambas).
 *   - conjunto com exatamente 1 código, e esse código AINDA tem um Profissional tombstoned real
 *     (`deletedCodigos`) -> reativa (mesma lógica da Prioridade 1).
 *   - conjunto com exatamente 1 código, mas SEM nenhum Profissional (nem ativo nem tombstoned) para
 *     esse código -> candidato a `RECREATE_FROM_HISTORY` (ver Prioridade 2, abaixo — só resolve
 *     depois de confirmar que também não há candidato por CadastroFornecedor residual).
 *
 * PRIORIDADE 2 — quando não há Profissional ainda, procura CadastroFornecedor existente com o
 * MESMO nome normalizado e sinais cadastrais não-contraditórios (e-mail/telefone/razão social).
 * Exatamente 1 candidato plausível -> atualiza aquele. 2+ candidatos plausíveis -> CONFLICT
 * (ambiguidade real, nunca escolhida sozinha). 0 candidatos:
 *   - se a Prioridade 1B identificou um único código histórico reaproveitável sem Profissional
 *     nenhum -> `RECREATE_FROM_HISTORY` (recria Profissional com esse MESMO código, nunca gera um
 *     novo — ver `upsertCadastroFornecedor`).
 *   - se o hash aponta para uma exclusão SEM NENHUM colaboradorCodigo vinculado no momento
 *     (`SEM_CODIGO_VINCULADO` — não existe nenhum código histórico para reaproveitar) ->
 *     `REQUIRES_REVIEW`: não é bloqueio de regra de negócio (por isso nunca mais retorna
 *     `BLOCKED_DELETED` genérico aqui), é ausência de dado suficiente para reconstruir a
 *     identidade com segurança — decisão humana explícita.
 *   - caso contrário (nenhum nome igual, ou só homônimos com sinais contraditórios) -> CREATE.
 */
export function resolveFornecedorIdentity(row: CadastroRow, index: IdentityIndex): FornecedorIdentityResolution {
  const target = normalizePersonName(row.responsavel);
  const codigoFallback = target;
  const hash = identityNameHash(target);
  const hashedCodigos = index.deletedNameHashes?.get(hash);
  if (hashedCodigos && hashedCodigos.size > 1) {
    const candidateCodigos = [...hashedCodigos].sort();
    return {
      kind: "CONFLICT",
      candidates: [],
      candidateCodigos,
      reason: `O nome "${row.responsavel}" corresponde ao histórico de exclusão de mais de uma identidade distinta (${candidateCodigos.join(", ")}) — nunca escolhido automaticamente.`,
    };
  }
  const hashedCodigo = hashedCodigos ? [...hashedCodigos][0] : undefined;

  const profissionalCodigos = index.profissionalCodigosByName.get(target);
  if (profissionalCodigos && profissionalCodigos.size === 1) {
    const codigo = [...profissionalCodigos][0];
    if (index.deletedCodigos.has(normalizePersonName(codigo))) {
      return { kind: "PROFISSIONAL_MATCH", colaboradorCodigo: codigo, reactivatingDeletedIdentity: true };
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

  // PRIORIDADE 1B — ver docstring acima. Só chega aqui quando o nome não bate mais com nenhum
  // Profissional ATIVO (a Prioridade 1 já teria resolvido) — cobre o caso do `codigo` ser um valor
  // técnico distinto do nome (ex.: P0123456), onde a anonimização do nome quebrou a Prioridade 1.
  if (hashedCodigo && index.deletedCodigos.has(normalizePersonName(hashedCodigo))) {
    return { kind: "PROFISSIONAL_MATCH", colaboradorCodigo: hashedCodigo, reactivatingDeletedIdentity: true };
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

  // Chegou até aqui sem NENHUM Profissional (ativo ou tombstoned) e sem NENHUM CadastroFornecedor
  // compatível — condições 1, 3, 4 e 6 do RECREATE_FROM_HISTORY já satisfeitas por construção
  // (existe evidência histórica única — `hashedCodigo` computado acima já garantiu 2 do multimap
  // -> CONFLICT antes de chegar aqui; sem Profissional atual/tombstoned; sem homônimo ativo, já que
  // nem Prioridade 1 nem 2 encontraram absolutamente nada para este nome). Condições 2/5 (hash
  // aponta para exatamente 1 código) e 7/8 (Usuario inequívoco, sem violar homônimo) são
  // confirmadas em `upsertCadastroFornecedor` no momento da escrita (única camada com acesso real
  // ao banco — esta função é pura).
  if (hashedCodigo) return { kind: "RECREATE_FROM_HISTORY", colaboradorCodigo: hashedCodigo };

  // Hash aponta para uma exclusão SEM NENHUM colaboradorCodigo vinculado no momento
  // (`SEM_CODIGO_VINCULADO`) — não existe nenhum código histórico para reaproveitar numa recriação
  // (nem sequer um `codigo` pra atribuir ao Profissional novo). Não é bloqueio de regra de negócio:
  // é ausência de dado suficiente para reconstruir a identidade com segurança — exige decisão
  // humana explícita, nunca um CREATE silencioso que perderia esse histórico de exclusão.
  if (index.noCodeExclusionHashes?.has(hash)) {
    return { kind: "REQUIRES_REVIEW", motivo: `"${row.responsavel}" corresponde ao histórico de uma exclusão administrativa sem nenhum código vinculado — não há identidade histórica para reaproveitar automaticamente.` };
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
export async function upsertCadastroFornecedor(
  row: CadastroRow,
  sharedIndex?: IdentityIndex,
  /** Usado exclusivamente pelo fluxo de resolução manual de identidade
   * (`resolverIdentidadeManualmente`, abaixo) — quando o ADMIN já escolheu explicitamente qual
   * identidade histórica esta linha representa, a decisão dele tem prioridade sobre a inferência
   * automática: `resolveFornecedorIdentity` nem chega a ser chamada. NUNCA aceitar um valor aqui
   * vindo direto do cliente sem validação prévia (ver `resolverIdentidadeManualmente`, que só
   * constrói este objeto depois de confirmar que o código pertence a um candidato real). */
  overrideResolution?: FornecedorIdentityResolution,
) {
  const index = sharedIndex ?? (await buildIdentityIndex());
  const resolution = overrideResolution ?? resolveFornecedorIdentity(row, index);

  if (resolution.kind === "CONFLICT") {
    throw new FornecedorIdentityConflictError(
      resolution.reason ?? `Identidade ambígua para "${row.responsavel}" — mais de um cadastro/colaborador compatível encontrado. Resolva manualmente antes de importar esta linha.`,
      resolution.candidates,
      resolution.candidateCodigos,
    );
  }
  if (resolution.kind === "REQUIRES_REVIEW") {
    throw new FornecedorIdentityReviewError(resolution.motivo);
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
      // undefined (padrão da importação em planilha) = Prisma ignora o campo, nunca sobrescreve
      // uma configuração condicional já feita manualmente para este fornecedor (ver comentário em
      // CadastroRow.tipoCondicaoFixa acima).
      tipoCondicaoFixa: row.tipoCondicaoFixa,
      valorCondicaoFixaComProducao: row.valorCondicaoFixaComProducao,
      valorCondicaoFixaSemProducao: row.valorCondicaoFixaSemProducao,
      // Mesma proteção: undefined nunca sobrescreve "Fonte da medição" já configurada.
      fonteMedicao: row.fonteMedicao,
      inicio: row.inicio,
      final: row.final,
      statusCadastro: row.statusCadastro,
      primeiroAditivo: row.primeiroAditivo,
      segundoAditivo: row.segundoAditivo,
      rawPayload: row.rawPayload,
    };

    let cadastroId: string;
    let created: boolean;
    let administrativeConfigRestored = false;
    let administrativeConfigSnapshotMalformed = false;
    if (resolution.kind === "CADASTRO_MATCH") {
      await tx.cadastroFornecedor.update({ where: { id: resolution.cadastroId }, data: { ...data, updatedAt: now } });
      cadastroId = resolution.cadastroId;
      created = false;
    } else {
      // PROFISSIONAL_MATCH: pode já existir um CadastroFornecedor vinculado a este colaboradorCodigo
      // (ex.: cadastro criado antes de qualquer nome bater na busca por nome — edição manual prévia).
      // Quando `reactivatingDeletedIdentity` é true, o CadastroFornecedor NUNCA está vinculado (foi
      // removido pela exclusão administrativa) — a linha abaixo sempre CRIA um novo, recriando
      // apenas o cadastro administrativo (nunca duplica Profissional/Usuario, ver upsert abaixo).
      const linkedId = resolution.kind === "PROFISSIONAL_MATCH" ? index.cadastroIdByColaboradorCodigo.get(normalizePersonName(colaboradorCodigo)) : undefined;
      if (linkedId) {
        await tx.cadastroFornecedor.update({ where: { id: linkedId }, data: { ...data, updatedAt: now } });
        cadastroId = linkedId;
        created = false;
      } else {
        // Recriando uma identidade que já foi excluída definitivamente (RECREATE_FROM_HISTORY, ou
        // reativação de um Profissional excluído) — a linha reimportada NUNCA traz
        // fonteMedicao/tipoCondicaoFixa/valorCondicaoFixaCom(Sem)Producao (não existem na Consulta
        // PJ), então `row.*` chega `undefined` aqui. Restaura do snapshot preservado na exclusão
        // (ver `buildAdministrativeConfigSnapshot`) SOMENTE os campos que a linha atual não trouxe —
        // dado cadastral novo da planilha (CNPJ, razão social, e-mail, valorCondicaoFixa comum etc.)
        // sempre prevalece, nunca é sobrescrito por aqui. Sem snapshot -> permanece no default
        // (`administrativeConfigRestored` abaixo sinaliza quando não havia nada para restaurar).
        const snapshot = index.administrativeConfigSnapshots?.get(normalizePersonName(colaboradorCodigo));
        administrativeConfigRestored = !!snapshot;
        // Defesa em profundidade: o snapshot vem de um campo JSON livre (AdminAuditLog.metadata) —
        // nunca confiar cegamente nele. `tipoCondicaoFixa`/`fonteMedicao` passam pela mesma
        // normalização defensiva de LEITURA usada para qualquer dado legado (nunca a validação
        // estrita de escrita — não é isso que o ADMIN está digitando agora); um snapshot com tipo
        // inválido cai no comportamento legado seguro (FIXA/DOCUMENTOS) em vez de gravar lixo, e
        // isso é sinalizado, nunca vira erro de importação da Consulta PJ.
        const snapshotTipoCondicaoFixaValido = snapshot ? snapshot.tipoCondicaoFixa === null || snapshot.tipoCondicaoFixa === "FIXA" || snapshot.tipoCondicaoFixa === "CONDICIONAL_PRODUCAO" : true;
        const snapshotFonteMedicaoValido = snapshot ? snapshot.fonteMedicao === null || snapshot.fonteMedicao === "DOCUMENTOS" || snapshot.fonteMedicao === "DOCUMENTOS_AUXILIARES" : true;
        administrativeConfigSnapshotMalformed = !!snapshot && (!snapshotTipoCondicaoFixaValido || !snapshotFonteMedicaoValido);
        const dataForCreate = snapshot
          ? {
              ...data,
              // NULL é um valor LEGÍTIMO do snapshot (fornecedor nunca teve tipoCondicaoFixa
              // configurado) — preservado como NULL, nunca promovido para o literal "FIXA"
              // (equivalentes em leitura via normalizeTipoCondicaoFixa, mas não é o mesmo dado).
              // Só um valor GENUINAMENTE desconhecido (nem null, nem "FIXA", nem
              // "CONDICIONAL_PRODUCAO" — snapshot corrompido/adulterado) cai no fallback seguro.
              tipoCondicaoFixa: data.tipoCondicaoFixa === undefined
                ? (snapshotTipoCondicaoFixaValido ? snapshot.tipoCondicaoFixa : null)
                : data.tipoCondicaoFixa,
              valorCondicaoFixaComProducao: data.valorCondicaoFixaComProducao === undefined
                ? (typeof snapshot.valorCondicaoFixaComProducao === "number" && Number.isFinite(snapshot.valorCondicaoFixaComProducao) ? snapshot.valorCondicaoFixaComProducao : null)
                : data.valorCondicaoFixaComProducao,
              valorCondicaoFixaSemProducao: data.valorCondicaoFixaSemProducao === undefined
                ? (typeof snapshot.valorCondicaoFixaSemProducao === "number" && Number.isFinite(snapshot.valorCondicaoFixaSemProducao) ? snapshot.valorCondicaoFixaSemProducao : null)
                : data.valorCondicaoFixaSemProducao,
              fonteMedicao: data.fonteMedicao === undefined
                ? (snapshotFonteMedicaoValido ? snapshot.fonteMedicao : null)
                : data.fonteMedicao,
            }
          : data;
        const createdRow = await tx.cadastroFornecedor.create({ data: dataForCreate });
        cadastroId = createdRow.id;
        created = true;
      }
    }

    const reactivating = resolution.kind === "PROFISSIONAL_MATCH" && resolution.reactivatingDeletedIdentity === true;
    // Chave de busca é `codigo`, NUNCA `nome` — depois de uma exclusão administrativa definitiva
    // (lib/cadastro-fornecedor.ts:deleteFornecedoresDefinitivamente), `Profissional.nome` vira
    // `EXCLUIDO-<uuid>` (anonimizado) enquanto `codigo` permanece estável como identidade técnica
    // real. Buscar por `nome: colaboradorCodigo` nunca encontraria a linha tombstoned e faria o
    // upsert tentar CRIAR uma segunda linha, que colidiria na constraint única de `codigo` — bug
    // real que impedia a reimportação de recriar o cadastro depois de uma exclusão.
    await tx.profissional.upsert({
      where: { codigo: colaboradorCodigo },
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
        // Reativação: restaura o `nome` para a convenção padrão (nome === codigo) e limpa o estado
        // de exclusão — uma reimportação válida da planilha administrativa é ação explícita do
        // ADMIN, não reativação silenciosa por coincidência de nome.
        ...(reactivating ? { nome: colaboradorCodigo, deletedAt: null, deletedById: null, deletedByNome: null, deletedReason: null } : {}),
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
    let usuarioReativado: { usuario: string; nome: string; senha: string | null; email: string | null } | null = null;
    // `findMany` (nunca `findFirst`) — condição 7/8 do RECREATE_FROM_HISTORY (Usuario precisa ser
    // relacionado de forma INEQUÍVOCA): mais de um Usuario COLABORADOR não-excluído com o MESMO
    // nome normalizado é uma identidade de acesso ambígua real, nunca resolvida escolhendo o
    // primeiro encontrado.
    const existingUsers = await tx.usuario.findMany({
      where: { perfil: "COLABORADOR", nome: { equals: row.responsavel, mode: "insensitive" } },
      select: { id: true, usuario: true, excluidoAt: true, senhaTemporaria: true },
    });
    if (existingUsers.length > 1) {
      throw new FornecedorUsuarioAmbiguoError(`Identidade de acesso ambígua para "${row.responsavel}" — mais de um Usuario compatível encontrado. Resolva manualmente antes de importar esta linha.`);
    }
    const existingUser = existingUsers[0];
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
      // A exclusão administrativa limpa `senhaTemporaria`/`primeiroLogin` (ver
      // deleteFornecedoresDefinitivamente) — se a pessoa nunca tinha completado o primeiro login
      // antes de ser excluída, reativar só `ativo`/`excluidoAt` deixaria a conta sem nenhuma senha
      // recuperável. Gera uma nova senha temporária SOMENTE nesse caso (nunca sobrescreve uma senha
      // real já definida pela pessoa). De qualquer forma, isso continua sendo REATIVAÇÃO, nunca
      // criação — o registro já existia (ver `usuariosReativados`, nunca `usuariosCriados`).
      let senhaReativacao: string | null = null;
      if (!existingUser.senhaTemporaria) {
        senhaReativacao = generateTempPassword();
      }
      await tx.usuario.update({
        where: { id: existingUser.id },
        data: {
          nome: row.responsavel,
          ativo: true,
          excluidoAt: null,
          perfil: "COLABORADOR",
          updatedAt: now,
          ...(senhaReativacao ? { senhaHash: await hashPassword(senhaReativacao), senhaTemporaria: senhaReativacao, primeiroLogin: true } : {}),
        },
      });
      usuarioReativado = { usuario: existingUser.usuario, nome: row.responsavel, senha: senhaReativacao, email: row.email ?? null };
    }

    const recreated = created && (reactivating || resolution.kind === "RECREATE_FROM_HISTORY");
    return {
      cadastroId,
      colaboradorCodigo,
      created,
      recreated,
      // true = havia snapshot administrativo preservado e foi restaurado nesta recriação.
      administrativeConfigRestored,
      // true = é uma recriação, mas não havia snapshot (exclusão antiga sem essa preservação, ou
      // identidade nunca teve configuração administrativa nenhuma) — configuração administrativa
      // anterior, se existiu, não pôde ser recuperada; sempre false quando `recreated` é false.
      administrativeConfigUnrecoverable: recreated && !administrativeConfigRestored,
      // true = havia snapshot, mas tipoCondicaoFixa/fonteMedicao dentro dele não eram um valor
      // reconhecido (JSON livre corrompido/adulterado) — caiu no default legado seguro (FIXA/
      // DOCUMENTOS) em vez de gravar o valor bruto do snapshot.
      administrativeConfigSnapshotMalformed,
      usuarioCriado,
      usuarioReativado,
    };
  });

  updateIdentityIndex(index, row, result);
  return result;
}

/** Lançada quando a resolução manual não pode prosseguir — código escolhido não é um dos
 * candidatos reais da linha, linha não está mais em conflito, ou criar uma identidade nova
 * colidiria com um código já existente. O chamador (rota HTTP) devolve 400/409 conforme o caso. */
export class FornecedorResolucaoInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FornecedorResolucaoInvalidaError";
  }
}

export type IdentityManualChoice = { tipo: "USAR_CANDIDATO"; codigo: string } | { tipo: "NENHUMA_IDENTIDADE" };

/**
 * Recalcula, DIRETO no servidor (nunca confia em nada vindo do cliente além do nome), quais
 * códigos históricos são candidatos legítimos para um nome — usado pelo modal "Resolver
 * identidade" para saber quais candidatos buscar detalhes antes de o ADMIN decidir.
 */
export async function getCandidateCodigosForRow(responsavel: string): Promise<{ kind: FornecedorIdentityResolution["kind"]; candidateCodigos: string[]; motivo?: string }> {
  const index = await buildIdentityIndex();
  const minimalRow: CadastroRow = { responsavel, cnpj: "", cnpjNormalizado: "", razaoSocial: "", rawPayload: {} };
  const resolution = resolveFornecedorIdentity(minimalRow, index);
  if (resolution.kind === "CONFLICT") return { kind: "CONFLICT", candidateCodigos: resolution.candidateCodigos ?? [] };
  if (resolution.kind === "REQUIRES_REVIEW") return { kind: "REQUIRES_REVIEW", candidateCodigos: [], motivo: resolution.motivo };
  return { kind: resolution.kind, candidateCodigos: [] };
}

/**
 * Resolve manualmente UMA linha que ficou em CONFLICT (colisão de hash — 2+ identidades históricas
 * compatíveis) ou REQUIRES_REVIEW (identidade excluída sem nenhum código vinculado) — fluxo do
 * Painel Administrativo (modal "Resolver identidade"). Reaproveita `upsertCadastroFornecedor`
 * (nunca duplica a lógica de escrita), passando um `overrideResolution` construído aqui DEPOIS de
 * validar a escolha do ADMIN contra os candidatos REAIS recalculados no servidor — nunca confia em
 * candidatos/códigos enviados pelo cliente sem essa revalidação.
 */
export async function resolverIdentidadeManualmente(
  row: CadastroRow,
  escolha: IdentityManualChoice,
  admin: { id: string; usuario: string; nome: string },
) {
  const index = await buildIdentityIndex();
  const resolution = resolveFornecedorIdentity(row, index);

  if (resolution.kind !== "CONFLICT" && resolution.kind !== "REQUIRES_REVIEW") {
    throw new FornecedorResolucaoInvalidaError(
      `"${row.responsavel}" não está mais em conflito/revisão — reimporte esta linha normalmente em vez de resolver manualmente.`,
    );
  }

  if (escolha.tipo === "USAR_CANDIDATO") {
    if (resolution.kind !== "CONFLICT" || !resolution.candidateCodigos?.length) {
      throw new FornecedorResolucaoInvalidaError(`"${row.responsavel}" não tem nenhum código histórico candidato para usar — só a opção "Nenhuma dessas identidades" é válida aqui.`);
    }
    const alvoNormalizado = normalizePersonName(escolha.codigo);
    const codigoReal = resolution.candidateCodigos.find((c) => normalizePersonName(c) === alvoNormalizado);
    if (!codigoReal) {
      throw new FornecedorResolucaoInvalidaError(`O código "${escolha.codigo}" não está entre os candidatos apresentados para "${row.responsavel}" (${resolution.candidateCodigos.join(", ")}).`);
    }
    const overrideResolution: FornecedorIdentityResolution = index.deletedCodigos.has(alvoNormalizado)
      ? { kind: "PROFISSIONAL_MATCH", colaboradorCodigo: codigoReal, reactivatingDeletedIdentity: true }
      : { kind: "RECREATE_FROM_HISTORY", colaboradorCodigo: codigoReal };
    const resultado = await upsertCadastroFornecedor(row, index, overrideResolution);
    await prisma.adminAuditLog.create({
      data: {
        action: "IDENTITY_MANUAL_RESOLUTION",
        adminId: admin.id,
        adminUsuario: admin.usuario,
        adminNome: admin.nome,
        targetType: "CadastroFornecedor",
        targetCodigo: codigoReal,
        metadata: { responsavelImportado: row.responsavel, candidatos: resolution.candidateCodigos, codigoEscolhido: codigoReal },
      },
    });
    return resultado;
  }

  // NENHUMA_IDENTIDADE — só é segura quando o código que SERIA gerado para esta linha não colide
  // com nenhuma identidade já existente (ativa ou tombstoned), incluindo os próprios candidatos
  // rejeitados — nunca inventa um código que já pertence a outra pessoa real.
  const codigoNovo = codigoFromName(row.responsavel);
  const codigoNovoKey = normalizePersonName(codigoNovo);
  const candidatosRejeitados = new Set((resolution.kind === "CONFLICT" ? resolution.candidateCodigos ?? [] : []).map((c) => normalizePersonName(c)));
  if (candidatosRejeitados.has(codigoNovoKey) || index.profissionalCodigosByName.has(codigoNovoKey) || index.deletedCodigos.has(codigoNovoKey)) {
    throw new FornecedorResolucaoInvalidaError(
      `Não é possível criar uma identidade nova para "${row.responsavel}" — o código que seria gerado (${codigoNovo}) já corresponde a uma identidade histórica existente. Escolha um dos candidatos apresentados.`,
    );
  }
  const overrideResolution: FornecedorIdentityResolution = { kind: "CREATE", colaboradorCodigo: codigoNovo };
  const resultado = await upsertCadastroFornecedor(row, index, overrideResolution);
  await prisma.adminAuditLog.create({
    data: {
      action: "IDENTITY_MANUAL_RESOLUTION",
      adminId: admin.id,
      adminUsuario: admin.usuario,
      adminNome: admin.nome,
      targetType: "CadastroFornecedor",
      targetCodigo: codigoNovo,
      metadata: {
        responsavelImportado: row.responsavel,
        candidatos: resolution.kind === "CONFLICT" ? resolution.candidateCodigos ?? [] : [],
        codigoEscolhido: "NENHUMA_IDENTIDADE_NOVA",
      },
    },
  });
  return resultado;
}

export type ImportConflitoDetalhe = {
  responsavel: string;
  cnpj: string;
  motivo: string;
  candidatos: { cadastroId: string; colaboradorCodigo: string | null; email: string | null; telefone: string | null; razaoSocial: string }[];
  /** Códigos históricos candidatos quando o conflito vem de colisão de hash de nome — usado pelo
   * fluxo de resolução manual de identidade para buscar os detalhes de cada um. */
  candidateCodigos?: string[];
  /** Linha original da planilha — permite ao ADMIN resolver SÓ esta linha depois (via
   * `resolverIdentidadeManualmente`), sem precisar reimportar a planilha inteira. */
  linha: CadastroRow;
};

export type ImportBloqueadoDetalhe = {
  responsavel: string;
  cnpj: string;
  motivo: string;
  colaboradorCodigo: string;
};

export type ImportRevisaoDetalhe = {
  responsavel: string;
  cnpj: string;
  motivo: string;
  linha: CadastroRow;
};

export async function importCadastrosFornecedores(buffer: Buffer) {
  const rows = parseCadastroFornecedorWorkbook(buffer);
  let atualizados = 0;
  let criados = 0;
  let recriados = 0;
  let recriadosComConfigRestaurada = 0;
  let recriadosSemConfigRecuperavel = 0;
  let usuariosCriados = 0;
  let usuariosReativados = 0;
  const senhasTemporarias: { usuario: string; nome: string; senha: string; email: string | null }[] = [];
  const conflitosDetalhe: ImportConflitoDetalhe[] = [];
  const bloqueadosDetalhe: ImportBloqueadoDetalhe[] = [];
  const revisaoDetalhe: ImportRevisaoDetalhe[] = [];

  // Índice construído UMA vez para a planilha inteira (não por linha) — evita N+1 real em
  // importações com dezenas/centenas de fornecedores; atualizado em memória a cada linha
  // processada por `upsertCadastroFornecedor` (via `updateIdentityIndex`).
  const index = await buildIdentityIndex();

  for (const row of rows) {
    try {
      const resultado = await upsertCadastroFornecedor(row, index);
      if (resultado.recreated) {
        recriados += 1;
        if (resultado.administrativeConfigRestored) recriadosComConfigRestaurada += 1;
        if (resultado.administrativeConfigUnrecoverable) recriadosSemConfigRecuperavel += 1;
      }
      else if (resultado.created) criados += 1;
      else atualizados += 1;
      // `usuarioCriado` (tx.usuario.create real) e `usuarioReativado` (Usuario já existia,
      // excluidoAt limpo) NUNCA se confundem no contador — reativação nunca conta como criação,
      // mesmo quando gera uma nova senha temporária (ver upsertCadastroFornecedor).
      if (resultado.usuarioCriado) {
        usuariosCriados += 1;
        senhasTemporarias.push(resultado.usuarioCriado);
      }
      if (resultado.usuarioReativado) {
        usuariosReativados += 1;
        if (resultado.usuarioReativado.senha) {
          senhasTemporarias.push({ ...resultado.usuarioReativado, senha: resultado.usuarioReativado.senha });
        }
      }
    } catch (error) {
      if (error instanceof FornecedorIdentityConflictError) {
        // Ambiguidade real (2+ candidatos plausíveis, 2+ Profissional distintos compatíveis, hash
        // de nome apontando pra 2+ identidades históricas distintas, ou Usuario ambíguo) — a linha
        // é PULADA (nunca escolhida arbitrariamente) e reportada para análise humana.
        conflitosDetalhe.push({
          responsavel: row.responsavel,
          cnpj: row.cnpj,
          motivo: error.message,
          candidatos: error.candidates.map((c) => ({ cadastroId: c.cadastroId, colaboradorCodigo: c.colaboradorCodigo, email: c.email, telefone: c.telefone, razaoSocial: c.razaoSocial })),
          candidateCodigos: error.candidateCodigos,
          linha: row,
        });
        continue;
      }
      if (error instanceof FornecedorUsuarioAmbiguoError) {
        conflitosDetalhe.push({ responsavel: row.responsavel, cnpj: row.cnpj, motivo: error.message, candidatos: [], linha: row });
        continue;
      }
      if (error instanceof FornecedorIdentityReviewError) {
        // Nome corresponde ao histórico de uma exclusão SEM nenhum colaboradorCodigo vinculado —
        // não há identidade histórica suficiente para reconstruir com segurança (não é bloqueio de
        // regra de negócio, é falta de dado). Exige decisão humana explícita.
        revisaoDetalhe.push({ responsavel: row.responsavel, cnpj: row.cnpj, motivo: error.motivo, linha: row });
        continue;
      }
      if (error instanceof FornecedorIdentityDeletedError) {
        // Reservado para um bloqueio genuíno de regra de negócio — não usado atualmente por
        // resolveFornecedorIdentity, mantido por compatibilidade.
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
    recriados,
    recriadosComConfigRestaurada,
    recriadosSemConfigRecuperavel,
    atualizados,
    usuariosCriados,
    usuariosReativados,
    conflitos: conflitosDetalhe.length,
    conflitosDetalhe,
    bloqueados: bloqueadosDetalhe.length,
    bloqueadosDetalhe,
    revisao: revisaoDetalhe.length,
    revisaoDetalhe,
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
    tipoCondicaoFixa: item.tipoCondicaoFixa ?? null,
    valorCondicaoFixaComProducao: item.valorCondicaoFixaComProducao === null || item.valorCondicaoFixaComProducao === undefined ? null : Number(item.valorCondicaoFixaComProducao),
    valorCondicaoFixaSemProducao: item.valorCondicaoFixaSemProducao === null || item.valorCondicaoFixaSemProducao === undefined ? null : Number(item.valorCondicaoFixaSemProducao),
    fonteMedicao: item.fonteMedicao ?? null,
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

export type IdentityCandidateSummary = {
  codigo: string;
  profissionalId: string | null;
  nomeAtual: string | null;
  nomeCompleto: string | null;
  email: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  profissionalStatus: "ATIVO" | "EXCLUIDO" | "INEXISTENTE";
  excluidoEm: Date | null;
  usuarioId: string | null;
  usuarioLogin: string | null;
  usuarioStatus: "ATIVO" | "EXCLUIDO" | "INEXISTENTE";
  historico: { sgc: number; mapaPagamento: number; medicao: number; divergencias: number };
};

/**
 * Detalhes suficientes para o ADMIN decidir, com segurança, qual identidade histórica uma linha
 * ambígua representa (fluxo de resolução manual — ver `resolverIdentidadeManualmente`). Uma query
 * agregada por tabela (nunca 1 por candidato/linha — o conjunto de códigos é sempre pequeno, mas o
 * padrão de N+1 é evitado de qualquer forma).
 */
export async function getIdentityCandidateSummaries(codigos: string[]): Promise<IdentityCandidateSummary[]> {
  const uniq = [...new Set(codigos.filter(Boolean))];
  if (uniq.length === 0) return [];

  const [profissionais, exclusoes, sgcCounts, mapaCounts, divergenciaCounts] = await Promise.all([
    prisma.profissional.findMany({ where: { codigo: { in: uniq } } }),
    prisma.adminAuditLog.findMany({
      where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", targetCodigo: { in: uniq } },
      orderBy: { createdAt: "desc" },
      select: { targetCodigo: true, metadata: true },
    }),
    prisma.sgcAprovacaoMedicao.groupBy({ by: ["colaboradorCodigo"], where: { colaboradorCodigo: { in: uniq } }, _count: { _all: true } }),
    prisma.mapaPagamentoItem.groupBy({ by: ["projetistaCodigo"], where: { projetistaCodigo: { in: uniq } }, _count: { _all: true } }),
    prisma.divergenciaMedicao.groupBy({ by: ["colaboradorCodigo"], where: { colaboradorCodigo: { in: uniq } }, _count: { _all: true } }),
  ]);

  const profPorCodigo = new Map(profissionais.filter((p) => p.codigo).map((p) => [normalizePersonName(p.codigo!), p]));
  // Última exclusão registrada por código — inclui o `usuarioId` desativado naquele momento
  // (gravado em `deleteFornecedoresDefinitivamente`), a forma mais confiável de relacionar Usuario
  // a um código já anonimizado (nome não serve mais de chave depois da exclusão).
  const usuarioIdPorCodigo = new Map<string, string>();
  for (const ex of exclusoes) {
    if (!ex.targetCodigo) continue;
    const key = normalizePersonName(ex.targetCodigo);
    if (usuarioIdPorCodigo.has(key)) continue; // já pegou a mais recente (orderBy desc)
    const usuarioId = (ex.metadata as { usuarioId?: unknown } | null)?.usuarioId;
    if (typeof usuarioId === "string") usuarioIdPorCodigo.set(key, usuarioId);
  }

  const idsParaBuscar = [...new Set(usuarioIdPorCodigo.values())];
  const usuariosPorId = idsParaBuscar.length > 0
    ? new Map((await prisma.usuario.findMany({ where: { id: { in: idsParaBuscar } }, select: { id: true, usuario: true, ativo: true, excluidoAt: true } })).map((u) => [u.id, u]))
    : new Map<string, { id: string; usuario: string; ativo: boolean; excluidoAt: Date | null }>();

  // Para identidades ainda ATIVAS (Profissional sem deletedAt), o usuarioId da auditoria pode não
  // existir (nunca foram excluídas) — resolve pelo nome, mesmo padrão usado no resto do módulo.
  const nomesParaBuscar = uniq
    .map((codigo) => profPorCodigo.get(normalizePersonName(codigo)))
    .filter((p): p is NonNullable<typeof p> => !!p && !p.deletedAt)
    .map((p) => p.nomeCompleto || p.nome);
  const usuariosPorNome = nomesParaBuscar.length > 0
    ? new Map((await prisma.usuario.findMany({
        where: { perfil: "COLABORADOR", nome: { in: nomesParaBuscar, mode: "insensitive" } },
        select: { id: true, usuario: true, nome: true, ativo: true, excluidoAt: true },
      })).map((u) => [normalizePersonName(u.nome), u]))
    : new Map<string, { id: string; usuario: string; nome: string; ativo: boolean; excluidoAt: Date | null }>();

  const sgcPorCodigo = new Map(sgcCounts.map((r) => [normalizePersonName(r.colaboradorCodigo), r._count._all]));
  const mapaPorCodigo = new Map(mapaCounts.filter((r) => r.projetistaCodigo).map((r) => [normalizePersonName(r.projetistaCodigo!), r._count._all]));
  const divergenciaPorCodigo = new Map(divergenciaCounts.map((r) => [normalizePersonName(r.colaboradorCodigo), r._count._all]));

  // Medicao é ligado por FK real (idProfissional/idCoordenador), não por código string — só
  // consulta quando existe um Profissional de fato (senão não há id pra procurar).
  const profissionalIds = profissionais.map((p) => p.id);
  const medicoesPorProfissional = profissionalIds.length > 0
    ? await prisma.medicao.groupBy({ by: ["idProfissional"], where: { idProfissional: { in: profissionalIds } }, _count: { _all: true } })
    : [];
  const medicoesPorCoordenador = profissionalIds.length > 0
    ? await prisma.medicao.groupBy({ by: ["idCoordenador"], where: { idCoordenador: { in: profissionalIds } }, _count: { _all: true } })
    : [];
  const medicaoCountPorProfissionalId = new Map<string, number>();
  for (const r of medicoesPorProfissional) if (r.idProfissional) medicaoCountPorProfissionalId.set(r.idProfissional, (medicaoCountPorProfissionalId.get(r.idProfissional) ?? 0) + r._count._all);
  for (const r of medicoesPorCoordenador) if (r.idCoordenador) medicaoCountPorProfissionalId.set(r.idCoordenador, (medicaoCountPorProfissionalId.get(r.idCoordenador) ?? 0) + r._count._all);

  return uniq.map((codigo): IdentityCandidateSummary => {
    const key = normalizePersonName(codigo);
    const profissional = profPorCodigo.get(key);
    const usuarioViaAuditoria = usuarioIdPorCodigo.has(key) ? usuariosPorId.get(usuarioIdPorCodigo.get(key)!) : undefined;
    const usuarioViaNome = profissional && !profissional.deletedAt ? usuariosPorNome.get(normalizePersonName(profissional.nomeCompleto || profissional.nome)) : undefined;
    const usuario = usuarioViaAuditoria ?? usuarioViaNome;

    return {
      codigo,
      profissionalId: profissional?.id ?? null,
      nomeAtual: profissional?.nome ?? null,
      nomeCompleto: profissional?.nomeCompleto ?? null,
      email: profissional?.email ? decryptSensitive(profissional.email) : null,
      cnpj: profissional?.cnpj ? decryptSensitive(profissional.cnpj) : null,
      razaoSocial: profissional?.razaoSocial ?? null,
      profissionalStatus: !profissional ? "INEXISTENTE" : profissional.deletedAt ? "EXCLUIDO" : "ATIVO",
      excluidoEm: profissional?.deletedAt ?? null,
      usuarioId: usuario?.id ?? null,
      usuarioLogin: usuario?.usuario ?? null,
      usuarioStatus: !usuario ? "INEXISTENTE" : usuario.excluidoAt || !usuario.ativo ? "EXCLUIDO" : "ATIVO",
      historico: {
        sgc: sgcPorCodigo.get(key) ?? 0,
        mapaPagamento: mapaPorCodigo.get(key) ?? 0,
        medicao: profissional ? (medicaoCountPorProfissionalId.get(profissional.id) ?? 0) : 0,
        divergencias: divergenciaPorCodigo.get(key) ?? 0,
      },
    };
  });
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
/**
 * "Configurações administrativas" de um fornecedor: campos que representam uma decisão feita
 * DENTRO da aplicação (Painel Administrativo), nunca vindos da Consulta PJ — por isso uma
 * reimportação da planilha NUNCA os sobrescreve (ver `CadastroRow.tipoCondicaoFixa`/`fonteMedicao`,
 * "undefined = não alterar"). Exatamente por não virem da planilha, uma exclusão física de
 * `CadastroFornecedor` os perde por completo, a menos que sejam preservados aqui — snapshot mínimo
 * e seguro (nenhum dado sensível: sem CPF/CNPJ/e-mail/telefone/senha), gravado no MESMO
 * `AdminAuditLog` que já registra a exclusão (`FORNECEDOR_EXCLUSAO_DEFINITIVA`), para restaurar
 * numa eventual `RECREATE_FROM_HISTORY` (reimportação que recria a identidade). Dados cadastrais
 * "normais" (CNPJ, razão social, e-mail, telefone, função, vigência, valorCondicaoFixa comum) NÃO
 * entram aqui de propósito — esses sempre vêm da Consulta PJ atual, nunca de um snapshot antigo.
 */
export type AdministrativeConfigSnapshot = {
  fonteMedicao: string | null;
  tipoCondicaoFixa: string | null;
  valorCondicaoFixaComProducao: number | null;
  valorCondicaoFixaSemProducao: number | null;
};

function buildAdministrativeConfigSnapshot(cadastro: {
  fonteMedicao: string | null;
  tipoCondicaoFixa: string | null;
  valorCondicaoFixaComProducao: unknown;
  valorCondicaoFixaSemProducao: unknown;
}): AdministrativeConfigSnapshot | null {
  const snapshot: AdministrativeConfigSnapshot = {
    fonteMedicao: cadastro.fonteMedicao,
    tipoCondicaoFixa: cadastro.tipoCondicaoFixa,
    valorCondicaoFixaComProducao: cadastro.valorCondicaoFixaComProducao === null || cadastro.valorCondicaoFixaComProducao === undefined ? null : Number(cadastro.valorCondicaoFixaComProducao),
    valorCondicaoFixaSemProducao: cadastro.valorCondicaoFixaSemProducao === null || cadastro.valorCondicaoFixaSemProducao === undefined ? null : Number(cadastro.valorCondicaoFixaSemProducao),
  };
  // Nada para preservar (fornecedor "comum", sem nenhuma configuração administrativa) — não grava
  // snapshot vazio no audit log só para poluir o metadata.
  const hasSomething = Object.values(snapshot).some((v) => v !== null);
  return hasSomething ? snapshot : null;
}

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
    select: {
      id: true,
      colaboradorCodigo: true,
      responsavel: true,
      fonteMedicao: true,
      tipoCondicaoFixa: true,
      valorCondicaoFixaComProducao: true,
      valorCondicaoFixaSemProducao: true,
    },
  });
  const foundIds = new Set(cadastros.map((c) => c.id));
  const errors: { id: string; error: string }[] = [];
  for (const id of ids) {
    if (!foundIds.has(id)) errors.push({ id, error: "Registro não encontrado (já excluído ou inexistente)." });
  }

  const codigos = [...new Set(cadastros.map((c) => c.colaboradorCodigo).filter((c): c is string => !!c))];
  const codigoOriginalPorKey = new Map<string, string>();
  // Snapshot das configurações administrativas ANTES da exclusão física — se mais de um
  // CadastroFornecedor for removido para a mesma identidade nesta chamada, o último com alguma
  // configuração real vence (caso raríssimo de duplicata ainda não consolidada).
  const adminConfigByCodigoKey = new Map<string, AdministrativeConfigSnapshot>();
  for (const c of cadastros) {
    if (!c.colaboradorCodigo) continue;
    codigoOriginalPorKey.set(normalizePersonName(c.colaboradorCodigo), c.colaboradorCodigo);
    const snapshot = buildAdministrativeConfigSnapshot(c);
    if (snapshot) adminConfigByCodigoKey.set(normalizePersonName(c.colaboradorCodigo), snapshot);
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
        // Anexado a todo audit entry desta identidade (targetCodigo = codigoOriginal) — uma futura
        // RECREATE_FROM_HISTORY procura pelo snapshot mais recente entre TODAS as entradas com esse
        // código, então redundância aqui é inofensiva e só aumenta a chance de achar.
        const adminConfigSnapshot = adminConfigByCodigoKey.get(plan.codigoKey);

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
                ...(adminConfigSnapshot ? { administrativeConfigSnapshot: adminConfigSnapshot } : {}),
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
            metadata: {
              resultado: "EXCLUIDO_OPERACIONALMENTE_SEM_HISTORICO",
              cadastrosAdministrativosRemovidos: cadastrosRemovidosDestaIdentidade,
              ...(adminConfigSnapshot ? { administrativeConfigSnapshot: adminConfigSnapshot } : {}),
            },
          });
        } else {
          auditEntries.push({
            action: "FORNECEDOR_EXCLUSAO_DEFINITIVA",
            targetType: "CadastroFornecedor",
            targetId: null,
            targetCodigo: codigoOriginal,
            metadata: {
              resultado: "SEM_PROFISSIONAL_VINCULADO",
              cadastrosAdministrativosRemovidos: cadastrosRemovidosDestaIdentidade,
              ...(adminConfigSnapshot ? { administrativeConfigSnapshot: adminConfigSnapshot } : {}),
            },
          });
        }

        if (auditEntries.length === auditCountBefore) {
          auditEntries.push({ action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", targetType: "CadastroFornecedor", targetId: null, targetCodigo: codigoOriginal,
            metadata: {
              resultado: "HISTORICO_SEM_PROFISSIONAL_VINCULADO",
              ...(adminConfigSnapshot ? { administrativeConfigSnapshot: adminConfigSnapshot } : {}),
            } });
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
