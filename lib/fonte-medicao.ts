/**
 * "Fonte da medição": qual aba da planilha (ETL) o fornecedor usa para produção — substitui a
 * antiga whitelist hardcoded por nome (BM_AUX_ALLOWED_COLLABORATORS, "mauricio spindola"/
 * "cristiano jeferson") em etl/ingest_medicoes.py por dado cadastral real, configurável para
 * qualquer fornecedor. Regra independente de `tipoCondicaoFixa`/`valorCondicaoFixa` — um
 * fornecedor pode ter qualquer combinação das duas configurações.
 */
export type FonteMedicao = "DOCUMENTOS" | "DOCUMENTOS_AUXILIARES";

const VALID_VALUES = new Set<FonteMedicao>(["DOCUMENTOS", "DOCUMENTOS_AUXILIARES"]);

/**
 * LEITURA defensiva (registros já gravados — legado, import, qualquer consumidor que só precisa de
 * um valor utilizável): NULL/vazio/qualquer valor desconhecido sempre vira "DOCUMENTOS"
 * (comportamento legado padrão, inclusive para os 48 cadastros existentes antes desta correção —
 * nenhum precisa de migração manual). NUNCA usar esta função para validar um payload de escrita —
 * ela mascara erro de digitação como "DOCUMENTOS" silenciosamente, que é exatamente o
 * comportamento que `validateFonteMedicaoForWrite` existe para impedir nas rotas administrativas.
 */
export function normalizeFonteMedicao(value: string | null | undefined): FonteMedicao {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized === "DOCUMENTOS_AUXILIARES" ? "DOCUMENTOS_AUXILIARES" : "DOCUMENTOS";
}

export type FonteMedicaoWriteResult =
  | { ok: true; value: FonteMedicao }
  | { ok: false; error: string };

/**
 * ESCRITA (rotas administrativas — POST fornecedor manual, PATCH fornecedor): NULL/undefined/""
 * continuam sendo o default legado válido ("DOCUMENTOS não informado explicitamente" é uma escolha
 * legítima). Qualquer OUTRA string que não seja exatamente "DOCUMENTOS"/"DOCUMENTOS_AUXILIARES"
 * (case-insensitive, trim) é um erro de validação — nunca vira "DOCUMENTOS" silenciosamente. Um
 * ADMIN que digitar/enviar algo errado precisa ver o erro, não uma configuração diferente da que
 * pretendia salvar.
 */
export function validateFonteMedicaoForWrite(value: unknown): FonteMedicaoWriteResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: "DOCUMENTOS" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `Fonte da medição inválida: "${String(value)}". Valores aceitos: Documentos, Documentos Auxiliares.` };
  }
  const normalized = value.trim().toUpperCase();
  if (VALID_VALUES.has(normalized as FonteMedicao)) {
    return { ok: true, value: normalized as FonteMedicao };
  }
  return { ok: false, error: `Fonte da medição inválida: "${value}". Valores aceitos: Documentos, Documentos Auxiliares.` };
}
