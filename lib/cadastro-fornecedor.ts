import "server-only";

import { generateTempPassword, generateUniqueInternalAccessCode, hashPassword } from "@/lib/auth";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { excelSerialToDate, parseSimpleXlsx } from "@/lib/xlsx";
import { selectCadastroForAuthenticatedUser } from "@/lib/cadastro-identity";

export const CADASTRO_FORNECEDOR_SHEET = "CONTRATOS_ATIVOS";

type CadastroRow = {
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

function isSamePersonName(left: string | null | undefined, right: string | null | undefined) {
  const a = codigoFromName(left ?? "");
  const b = codigoFromName(right ?? "");
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function codigoFromName(name: string) {
  return stripAccents(name)
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
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

async function findProfissionalCodigoByName(name: string) {
  const target = codigoFromName(name);
  const profissionais = await prisma.profissional.findMany({
    select: { codigo: true, nome: true, nomeCompleto: true },
  });
  return profissionais.find((profissional) => {
    const codigo = codigoFromName(profissional.codigo ?? "");
    const nome = codigoFromName(profissional.nome ?? "");
    const nomeCompleto = codigoFromName(profissional.nomeCompleto ?? "");
    return (
      codigo === target ||
      nome === target ||
      nomeCompleto === target ||
      (codigo && target.startsWith(codigo)) ||
      (nome && target.startsWith(nome))
    );
  })?.codigo ?? null;
}

export async function importCadastrosFornecedores(buffer: Buffer) {
  const rows = parseCadastroFornecedorWorkbook(buffer);
  let atualizados = 0;
  let criados = 0;
  let usuariosCriados = 0;
  const senhasTemporarias: { usuario: string; nome: string; senha: string }[] = [];

  for (const row of rows) {
    const codigoResponsavel = codigoFromName(row.responsavel);
    let colaboradorCodigo = await findProfissionalCodigoByName(row.responsavel);
    if (!colaboradorCodigo) colaboradorCodigo = codigoResponsavel;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const existingByResponsavel = await tx.cadastroFornecedor.findFirst({
        where: {
          cnpjNormalizado: row.cnpjNormalizado,
          OR: [
            { colaboradorCodigo },
            { colaboradorCodigo: codigoResponsavel },
            { responsavel: { equals: row.responsavel, mode: "insensitive" } },
          ],
        },
        select: { id: true, cnpjNormalizado: true },
      });
      const existing = existingByResponsavel;
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

      if (existing) {
        await tx.cadastroFornecedor.update({
          where: { id: existing.id },
          data: {
            ...data,
            updatedAt: now,
          },
        });
      } else {
        await tx.cadastroFornecedor.create({ data });
      }
      if (existing) atualizados += 1;
      else criados += 1;

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

      {
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
          usuariosCriados += 1;
          senhasTemporarias.push({ usuario, nome: row.responsavel, senha });
        } else if (existingUser.excluidoAt) {
          await tx.usuario.update({
            where: { id: existingUser.id },
            data: { nome: row.responsavel, ativo: true, excluidoAt: null, perfil: "COLABORADOR", updatedAt: now },
          });
        }
      }
    });
  }

  return { total: rows.length, criados, atualizados, usuariosCriados, senhasTemporarias };
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
    where: { codigo: codigoProfissional },
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
