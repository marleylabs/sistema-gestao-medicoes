import "server-only";

import { onlyDigits } from "@/lib/cadastro-fornecedor";
import pdf from "pdf-parse/lib/pdf-parse.js";

type NfParty = {
  cnpj: string | null;
  razaoSocial: string | null;
};

type ValidateNfDocumentInput = {
  buffer: Buffer;
  mimeType: string;
  expectedCnpj: string;
  expectedRazaoSocial: string;
};

type ValidateNfDocumentResult =
  | { ok: true; detected: NfParty }
  | { ok: false; error: string; detected?: NfParty };

const PDF_MIME = "application/pdf";

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeCompany(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\b(LTDA|LIMITADA|ME|EPP|EIRELI|S A|SA|S\/A)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCompany(value: string | null | undefined) {
  return normalizeCompany(value).replace(/[^A-Z0-9]/g, "");
}

function linesFromText(text: string) {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function nextUsefulLine(lines: string[], startIndex: number) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && line !== "-") return line;
  }
  return null;
}

function sectionBetween(text: string, startPatterns: RegExp[], endPatterns: RegExp[]) {
  const startIndexes = startPatterns
    .map((pattern) => {
      const match = pattern.exec(text);
      pattern.lastIndex = 0;
      return match?.index ?? -1;
    })
    .filter((index) => index >= 0);

  if (!startIndexes.length) return text;
  const start = Math.min(...startIndexes);
  const rest = text.slice(start);
  const endIndexes = endPatterns
    .map((pattern) => {
      const match = pattern.exec(rest);
      pattern.lastIndex = 0;
      return match?.index ?? -1;
    })
    .filter((index) => index > 0);
  const end = endIndexes.length ? Math.min(...endIndexes) : rest.length;
  return rest.slice(0, end);
}

function extractCnpj(text: string) {
  const match = text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ?? text.match(/\b\d{14}\b/);
  return match ? onlyDigits(match[0]) : null;
}

function extractRazaoSocial(lines: string[]) {
  const labelPatterns = [
    /nome\s*\/\s*nome\s*empresarial/i,
    /razao\s*social/i,
    /razão\s*social/i,
    /prestador/i,
  ];

  for (const pattern of labelPatterns) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) {
      const value = nextUsefulLine(lines, index);
      if (value && !/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(value)) return value;
    }
  }

  return null;
}

function extractPrestador(text: string): NfParty {
  const prestadorSection = sectionBetween(
    text,
    [/EMITENTE\s*DA\s*NFS?-?E/i, /PRESTADOR\s*DO\s*SERVI[CÇ]O/i],
    [/TOMADOR\s*DO\s*SERVI[CÇ]O/i, /INTERMEDI[AÁ]RIO\s*DO\s*SERVI[CÇ]O/i, /SERVI[CÇ]O\s*PRESTADO/i],
  );
  const lines = linesFromText(prestadorSection);
  return {
    cnpj: extractCnpj(prestadorSection),
    razaoSocial: extractRazaoSocial(lines),
  };
}

async function extractPdfText(buffer: Buffer) {
  const result = await pdf(buffer);
  return result.text ?? "";
}

export async function validateNfDocumentAgainstCadastro(input: ValidateNfDocumentInput): Promise<ValidateNfDocumentResult> {
  if (input.mimeType !== PDF_MIME) {
    return {
      ok: false,
      error: "Upload bloqueado: a validação automática de CNPJ e razão social exige uma NF em PDF pesquisável.",
    };
  }

  const text = await extractPdfText(input.buffer).catch(() => "");
  if (normalizeText(text).length < 40) {
    return {
      ok: false,
      error: "Upload bloqueado: não foi possível ler os dados da NF. Envie um PDF pesquisável para validação automática.",
    };
  }

  const detected = extractPrestador(text);
  const expectedCnpj = onlyDigits(input.expectedCnpj);
  if (!detected.cnpj) {
    return {
      ok: false,
      error: "Upload bloqueado: não foi possível localizar o CNPJ do prestador na NF.",
      detected,
    };
  }

  if (detected.cnpj !== expectedCnpj) {
    return {
      ok: false,
      error: "Upload bloqueado: o CNPJ do prestador na NF diverge do cadastro administrativo.",
      detected,
    };
  }

  const expectedCompany = normalizeCompany(input.expectedRazaoSocial);
  const detectedCompany = normalizeCompany(detected.razaoSocial);
  const expectedCompanyCompact = compactCompany(input.expectedRazaoSocial);
  const detectedCompanyCompact = compactCompany(detected.razaoSocial);
  if (!detectedCompany) {
    return {
      ok: false,
      error: "Upload bloqueado: não foi possível localizar a razão social do prestador na NF.",
      detected,
    };
  }

  if (
    detectedCompany !== expectedCompany &&
    detectedCompanyCompact !== expectedCompanyCompact &&
    !detectedCompany.includes(expectedCompany) &&
    !expectedCompany.includes(detectedCompany) &&
    !detectedCompanyCompact.includes(expectedCompanyCompact) &&
    !expectedCompanyCompact.includes(detectedCompanyCompact)
  ) {
    return {
      ok: false,
      error: "Upload bloqueado: a razão social do prestador na NF diverge do cadastro administrativo.",
      detected,
    };
  }

  return { ok: true, detected };
}
