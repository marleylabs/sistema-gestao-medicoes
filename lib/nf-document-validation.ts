import { PDFParse } from "pdf-parse";

export function normalizeCnpj(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value).replace(/\D/g, "");
}

type NfParty = {
  cnpj: string | null;
  razaoSocial: string | null;
};

type NfDetectedParties = {
  prestador: NfParty;
  tomador: NfParty;
};

type ValidateNfDocumentInput = {
  buffer: Buffer;
  mimeType: string;
  expectedCnpj: string;
};

type ValidateNfDocumentResult =
  | { ok: true; detected: NfDetectedParties }
  | { ok: false; error: string; detected?: Partial<NfDetectedParties> };

const PDF_MIME = "application/pdf";
// Exportadas somente para o script de diagnóstico read-only (scripts/inspect-nf-validation.ts)
// inspecionar/reproduzir a regra real sem duplicá-la — nenhuma mudança de comportamento aqui.
export const EXPECTED_TOMADOR_CNPJ = "04892580000120";
export const EXPECTED_TOMADOR_RAZAO_SOCIAL = "PROJETA CONSULTORIA E SERVICOS LTDA";

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeCompany(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\b(LTDA|LIMITADA|ME|EPP|EIRELI|S A|SA|S\/A)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCompany(value: string | null | undefined) {
  return normalizeCompany(value).replace(/[^A-Z0-9]/g, "");
}

export function companyMatches(detectedValue: string | null | undefined, expectedValue: string) {
  const expectedCompany = normalizeCompany(expectedValue);
  const detectedCompany = normalizeCompany(detectedValue);
  const expectedCompanyCompact = compactCompany(expectedValue);
  const detectedCompanyCompact = compactCompany(detectedValue);

  return (
    !!detectedCompany &&
    (
      detectedCompany === expectedCompany ||
      detectedCompanyCompact === expectedCompanyCompact ||
      detectedCompany.includes(expectedCompany) ||
      expectedCompany.includes(detectedCompany) ||
      detectedCompanyCompact.includes(expectedCompanyCompact) ||
      expectedCompanyCompact.includes(detectedCompanyCompact)
    )
  );
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

  // Sem cabeçalho da parte, não vasculhar o documento inteiro: isso poderia atribuir ao tomador
  // o CNPJ do prestador (ou vice-versa), exatamente o falso positivo que a extração por seção evita.
  if (!startIndexes.length) return "";
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

export function extractCnpj(text: string) {
  const match = text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) ?? text.match(/\b\d{14}\b/);
  return match ? normalizeCnpj(match[0]) : null;
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
      let value = nextUsefulLine(lines, index);
      let valueIndex = index + 1;
      while (value && /^(CNPJ|CPF|RAZ[AÃ]O SOCIAL|NOME\s*\/\s*NOME EMPRESARIAL|PRESTADOR(?: DO SERVI[CÇ]O)?)$/i.test(value)) {
        valueIndex = lines.indexOf(value, valueIndex) + 1;
        value = nextUsefulLine(lines, valueIndex - 1);
      }
      if (value && !/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(value)) return value;
    }
  }

  return null;
}

export function extractPrestador(text: string): NfParty {
  const prestadorSection = sectionBetween(
    text,
    [/PRESTADOR\s*\/\s*FORNECEDOR/i, /EMITENTE\s*DA\s*NFS?-?E/i, /PRESTADOR\s*DO\s*SERVI[CÇ]O/i],
    [/TOMADOR\s*\/\s*ADQUIRENTE/i, /TOMADOR\s*DO\s*SERVI[CÇ]O/i, /INTERMEDI[AÁ]RIO\s*DO\s*SERVI[CÇ]O/i, /SERVI[CÇ]O\s*PRESTADO/i],
  );
  const lines = linesFromText(prestadorSection);
  return {
    cnpj: extractCnpj(prestadorSection),
    razaoSocial: extractRazaoSocial(lines),
  };
}

export function extractTomador(text: string): NfParty {
  const tomadorSection = sectionBetween(
    text,
    [/TOMADOR\s*\/\s*ADQUIRENTE/i, /TOMADOR\s*DO\s*SERVI[CÇ]O/i, /DADOS\s*DO\s*TOMADOR/i],
    [/INTERMEDI[AÁ]RIO\s*DO\s*SERVI[CÇ]O/i, /SERVI[CÇ]O\s*PRESTADO/i, /DISCRIMINA[CÇ][AÃ]O/i, /VALOR\s*TOTAL/i],
  );
  const lines = linesFromText(tomadorSection);
  return {
    cnpj: extractCnpj(tomadorSection),
    razaoSocial: extractRazaoSocial(lines),
  };
}

export async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

export async function validateNfDocumentAgainstCadastro(input: ValidateNfDocumentInput): Promise<ValidateNfDocumentResult> {
  if (input.mimeType !== PDF_MIME) {
    return {
      ok: false,
      error: "Upload bloqueado: a validação automática de CNPJ e razão social exige uma NF em PDF pesquisável.",
    };
  }

  const text = await extractPdfText(input.buffer).catch((error) => {
    console.error("Falha ao extrair texto da NF em PDF.", error);
    return "";
  });
  if (normalizeText(text).length < 40) {
    return {
      ok: false,
      error: "Upload bloqueado: não foi possível ler os dados da NF. Envie um PDF pesquisável para validação automática.",
    };
  }

  const detectedPrestador = extractPrestador(text);
  const detectedTomador = extractTomador(text);
  const detected = { prestador: detectedPrestador, tomador: detectedTomador };
  const expectedCnpj = normalizeCnpj(input.expectedCnpj);
  const errors: string[] = [];

  if (!detectedPrestador.cnpj) {
    errors.push("Não foi possível identificar o CNPJ do fornecedor na NF.");
  } else if (detectedPrestador.cnpj !== expectedCnpj) {
    errors.push("CNPJ do fornecedor da NF não corresponde ao fornecedor cadastrado.");
  }

  if (!detectedTomador.cnpj) {
    errors.push("Não foi possível identificar o CNPJ do tomador na NF.");
  } else if (detectedTomador.cnpj !== EXPECTED_TOMADOR_CNPJ) {
    errors.push("CNPJ do tomador da NF não corresponde à Projeta.");
  }

  if (errors.length) return { ok: false, error: errors.join("\n"), detected };
  return { ok: true, detected };
}
