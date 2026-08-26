import type { CellValue } from "@/lib/xlsx";

// ─── Normalização ───────────────────────────────────────────────────────────

export function normalizeNrVale(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeFormato(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeTipo(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Converte "100", "100%" ou "1.00" para a mesma escala de fração (0-1) usada por Medicao.percentualEmissao. */
export function normalizePercentual(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  const raw = typeof value === "number" ? String(value) : String(value);
  const hasPercentSign = raw.includes("%");
  const cleaned = raw.replace("%", "").replace(",", ".").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  if (hasPercentSign) return n / 100;
  return n > 1 ? n / 100 : n;
}

export function parseNumeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).trim().replace(",", ".");
  return cleaned === "" ? NaN : Number(cleaned);
}

const EPSILON = 0.0005;
function numerosDivergem(a: number | null | undefined, b: number) {
  const av = a ?? 0;
  return Math.abs(av - b) > EPSILON;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type EquipeDoc = {
  id: string;
  numeroDocumento: string | null;
  formato: string | null;
  equivalenteA1Horas: number;
  percentualEmissao: number;
  tipo2: string | null;
};

export type FornecedorLinha = {
  nrVale: string;
  formato: string;
  a1eqHh: number;
  percentualEmissao: number; // já em escala 0-1 (fração)
  tipo: string;
};

export type CampoComparado<T> = { equipe: T | null; fornecedor: T };

export type DivergenciaCandidata = {
  nrVale: string;
  idMedicaoExistente: string | null;
  documentoNaoMapeado: boolean;
  comparacaoAmbigua: boolean;
  formatoDivergente: boolean;
  a1eqDivergente: boolean;
  emissaoDivergente: boolean;
  tipoDivergente: boolean;
  equipe: { formato: string | null; a1eqHh: number | null; percentualEmissao: number | null; tipo: string | null } | null;
  fornecedor: { formato: string; a1eqHh: number; percentualEmissao: number; tipo: string };
};

// ─── Comparação ────────────────────────────────────────────────────────────

export function compararDocumentos(equipeDocs: EquipeDoc[], fornecedorLinhas: FornecedorLinha[]): DivergenciaCandidata[] {
  const grupos = new Map<string, { original: string; linhas: FornecedorLinha[] }>();
  for (const linha of fornecedorLinhas) {
    const key = normalizeNrVale(linha.nrVale);
    if (!key) continue;
    const grupo = grupos.get(key) ?? { original: linha.nrVale, linhas: [] };
    grupo.linhas.push(linha);
    grupos.set(key, grupo);
  }

  const equipeByKey = new Map<string, EquipeDoc>();
  for (const doc of equipeDocs) {
    const key = normalizeNrVale(doc.numeroDocumento);
    if (key) equipeByKey.set(key, doc);
  }

  const resultado: DivergenciaCandidata[] = [];

  for (const [key, grupo] of grupos) {
    const linha = grupo.linhas[0];
    const equipeDoc = equipeByKey.get(key) ?? null;
    const fornecedor = {
      formato: linha.formato,
      a1eqHh: linha.a1eqHh,
      percentualEmissao: linha.percentualEmissao,
      tipo: linha.tipo,
    };
    const equipe = equipeDoc
      ? {
          formato: equipeDoc.formato,
          a1eqHh: equipeDoc.equivalenteA1Horas,
          percentualEmissao: equipeDoc.percentualEmissao,
          tipo: equipeDoc.tipo2,
        }
      : null;

    if (grupo.linhas.length > 1) {
      resultado.push({
        nrVale: grupo.original,
        idMedicaoExistente: equipeDoc?.id ?? null,
        documentoNaoMapeado: false,
        comparacaoAmbigua: true,
        formatoDivergente: false,
        a1eqDivergente: false,
        emissaoDivergente: false,
        tipoDivergente: false,
        equipe,
        fornecedor,
      });
      continue;
    }

    if (!equipeDoc) {
      resultado.push({
        nrVale: grupo.original,
        idMedicaoExistente: null,
        documentoNaoMapeado: true,
        comparacaoAmbigua: false,
        formatoDivergente: false,
        a1eqDivergente: false,
        emissaoDivergente: false,
        tipoDivergente: false,
        equipe: null,
        fornecedor,
      });
      continue;
    }

    const formatoDivergente = normalizeFormato(equipeDoc.formato) !== normalizeFormato(linha.formato);
    const a1eqDivergente = numerosDivergem(equipeDoc.equivalenteA1Horas, linha.a1eqHh);
    const emissaoDivergente = numerosDivergem(equipeDoc.percentualEmissao, linha.percentualEmissao);
    const tipoDivergente = normalizeTipo(equipeDoc.tipo2) !== normalizeTipo(linha.tipo);

    if (!formatoDivergente && !a1eqDivergente && !emissaoDivergente && !tipoDivergente) continue;

    resultado.push({
      nrVale: grupo.original,
      idMedicaoExistente: equipeDoc.id,
      documentoNaoMapeado: false,
      comparacaoAmbigua: false,
      formatoDivergente,
      a1eqDivergente,
      emissaoDivergente,
      tipoDivergente,
      equipe,
      fornecedor,
    });
  }

  return resultado;
}

// ─── Leitura/validação estrutural da planilha do fornecedor ─────────────────

const HEADER_ALIASES: Record<string, keyof FornecedorLinhaRawColumns> = {
  "nr vale": "nrVale",
  "número vale": "nrVale",
  "numero vale": "nrVale",
  formato: "formato",
  "a1eq/hh": "a1eqHh",
  "a1eq / hh": "a1eqHh",
  "a1eq hh": "a1eqHh",
  "% emissão": "percentualEmissao",
  "% emissao": "percentualEmissao",
  "emissão": "percentualEmissao",
  "tipo dg/doc/hh": "tipo",
  "tipo dg / doc / hh": "tipo",
  tipo: "tipo",
};

type FornecedorLinhaRawColumns = { nrVale: number; formato: number; a1eqHh: number; percentualEmissao: number; tipo: number };

export type PlanilhaParseResult =
  | { ok: true; linhas: FornecedorLinha[] }
  | { ok: false; erro: string };

function normalizeHeader(value: CellValue): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

export function parseFornecedorPlanilha(rows: CellValue[][]): PlanilhaParseResult {
  if (!rows || rows.length === 0) {
    return { ok: false, erro: "A planilha está vazia." };
  }

  const header = rows[0];
  const colIndexByField = {} as Partial<FornecedorLinhaRawColumns>;
  header.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    const field = HEADER_ALIASES[normalized];
    if (field && colIndexByField[field] === undefined) colIndexByField[field] = index;
  });

  const required: Array<{ field: keyof FornecedorLinhaRawColumns; label: string }> = [
    { field: "nrVale", label: "NR VALE" },
    { field: "formato", label: "Formato" },
    { field: "a1eqHh", label: "A1eq/HH" },
    { field: "percentualEmissao", label: "% Emissão" },
    { field: "tipo", label: "TIPO DG/DOC/HH" },
  ];
  for (const { field, label } of required) {
    if (colIndexByField[field] === undefined) {
      return { ok: false, erro: `Coluna obrigatória não encontrada: ${label}` };
    }
  }
  const cols = colIndexByField as FornecedorLinhaRawColumns;

  const dataRows = rows.slice(1);
  const linhas: FornecedorLinha[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const nrValeRaw = row[cols.nrVale];
    const formatoRaw = row[cols.formato];
    const a1eqRaw = row[cols.a1eqHh];
    const percentualRaw = row[cols.percentualEmissao];
    const tipoRaw = row[cols.tipo];

    const isRowEmpty = [nrValeRaw, formatoRaw, a1eqRaw, percentualRaw, tipoRaw].every(
      (v) => v === null || v === undefined || String(v).trim() === "",
    );
    if (isRowEmpty) continue;

    const nrVale = String(nrValeRaw ?? "").trim();
    if (!nrVale) {
      return { ok: false, erro: `Linha ${i + 2}: NR VALE em branco.` };
    }

    const a1eqHh = parseNumeric(a1eqRaw);
    if (!Number.isFinite(a1eqHh)) {
      return { ok: false, erro: `Linha ${i + 2} (NR VALE ${nrVale}): A1eq/HH não é um número válido.` };
    }

    const percentualEmissao = normalizePercentual(percentualRaw);
    if (!Number.isFinite(percentualEmissao)) {
      return { ok: false, erro: `Linha ${i + 2} (NR VALE ${nrVale}): % Emissão não é um percentual válido.` };
    }

    const formato = String(formatoRaw ?? "").trim();
    const tipo = String(tipoRaw ?? "").trim();
    if (!formato || !tipo) {
      return { ok: false, erro: `Linha ${i + 2} (NR VALE ${nrVale}): Formato e TIPO DG/DOC/HH são obrigatórios.` };
    }

    linhas.push({ nrVale, formato, a1eqHh, percentualEmissao, tipo });
  }

  if (linhas.length === 0) {
    return { ok: false, erro: "Nenhuma linha com dados foi encontrada na planilha." };
  }

  return { ok: true, linhas };
}
