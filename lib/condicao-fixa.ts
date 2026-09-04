/**
 * "Condição Fixa" de um fornecedor: valor fixo mensal/contratual, com dois modos.
 * FIXA (padrão — inclusive quando `tipoCondicaoFixa` é NULL, para nunca exigir migração manual dos
 * fornecedores já cadastrados) usa `valorCondicaoFixa` diretamente. CONDICIONAL_PRODUCAO resolve
 * entre `valorCondicaoFixaComProducao`/`valorCondicaoFixaSemProducao` conforme
 * `hasMeasuredDocuments` (existem documentos medidos no ciclo) — substitui a exceção hardcoded do
 * Cristiano Jeferson por dado cadastral real, configurável para qualquer fornecedor.
 */
export type TipoCondicaoFixa = "FIXA" | "CONDICIONAL_PRODUCAO";

export type CondicaoFixaConfig = {
  tipoCondicaoFixa: string | null;
  valorCondicaoFixa: number | null;
  valorCondicaoFixaComProducao: number | null;
  valorCondicaoFixaSemProducao: number | null;
};

/**
 * LEITURA defensiva (registros já gravados — legado, import, snapshot de RECREATE_FROM_HISTORY,
 * qualquer consumidor que só precisa de um valor utilizável): NULL/vazio/qualquer valor desconhecido
 * sempre vira "FIXA" (comportamento legado padrão). NUNCA usar esta função para validar um payload
 * de escrita — ela mascara erro de digitação como "FIXA" silenciosamente, que é exatamente o
 * comportamento que `validateTipoCondicaoFixaForWrite` existe para impedir nas rotas
 * administrativas (mesmo padrão de `lib/fonte-medicao.ts::normalizeFonteMedicao`/
 * `validateFonteMedicaoForWrite`).
 */
export function normalizeTipoCondicaoFixa(value: string | null | undefined): TipoCondicaoFixa {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized === "CONDICIONAL_PRODUCAO" ? "CONDICIONAL_PRODUCAO" : "FIXA";
}

export type TipoCondicaoFixaWriteResult =
  | { ok: true; value: TipoCondicaoFixa }
  | { ok: false; error: string };

/**
 * ESCRITA (rotas administrativas — POST fornecedor manual, PATCH fornecedor): NULL/undefined/""
 * continuam sendo o default legado válido ("FIXA não informado explicitamente" é uma escolha
 * legítima). Qualquer OUTRA string que não seja exatamente "FIXA"/"CONDICIONAL_PRODUCAO"
 * (case-insensitive, trim) é um erro de validação — nunca vira "FIXA" silenciosamente. `tipoCondicaoFixa`
 * interfere diretamente no cálculo financeiro do fornecedor (`resolveCondicaoFixa`), então um erro de
 * digitação do ADMIN precisa ser rejeitado, não silenciosamente reinterpretado.
 */
export function validateTipoCondicaoFixaForWrite(value: unknown): TipoCondicaoFixaWriteResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: "FIXA" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `Tipo de condição fixa inválido: "${String(value)}". Valores aceitos: FIXA, CONDICIONAL_PRODUCAO.` };
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "FIXA" || normalized === "CONDICIONAL_PRODUCAO") {
    return { ok: true, value: normalized };
  }
  return { ok: false, error: `Tipo de condição fixa inválido: "${value}". Valores aceitos: FIXA, CONDICIONAL_PRODUCAO.` };
}

/**
 * Resolve o valor efetivo da condição fixa. Ausência de dado (`null`) nunca vira zero: um
 * fornecedor sem `valorCondicaoFixa` (modo FIXA) ou com CONDICIONAL_PRODUCAO configurado pela
 * metade (falta um dos dois valores) retorna `null` — "Não informado", nunca R$ 0,00 nem herança de
 * outro fornecedor.
 */
export function resolveCondicaoFixa(config: CondicaoFixaConfig, hasProduction: boolean): number | null {
  const tipo = normalizeTipoCondicaoFixa(config.tipoCondicaoFixa);
  if (tipo === "CONDICIONAL_PRODUCAO") {
    const { valorCondicaoFixaComProducao: com, valorCondicaoFixaSemProducao: sem } = config;
    if (com === null || com === undefined || sem === null || sem === undefined) return null;
    return hasProduction ? com : sem;
  }
  return config.valorCondicaoFixa ?? null;
}

export function toCondicaoFixaConfig(cadastro: {
  tipoCondicaoFixa: string | null;
  valorCondicaoFixa: unknown;
  valorCondicaoFixaComProducao: unknown;
  valorCondicaoFixaSemProducao: unknown;
}): CondicaoFixaConfig {
  const toNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    tipoCondicaoFixa: cadastro.tipoCondicaoFixa,
    valorCondicaoFixa: toNum(cadastro.valorCondicaoFixa),
    valorCondicaoFixaComProducao: toNum(cadastro.valorCondicaoFixaComProducao),
    valorCondicaoFixaSemProducao: toNum(cadastro.valorCondicaoFixaSemProducao),
  };
}
