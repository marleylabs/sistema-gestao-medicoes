/** Formatadores monetários/percentuais compartilhados pelo Mapa de Pagamento e pelo editor de pagamento. */
export const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function normalizeText(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

export function money(value: number) {
  return value ? currency.format(value) : "–";
}

export function currencyInputValue(value: number) {
  return currency.format(value || 0);
}

export function formatCurrencyInput(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return currencyInputValue(0);
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return currencyInputValue(Number.isFinite(parsed) ? parsed : 0);
}

export function parseCurrencyNumber(value: string) {
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ratio(value: number) {
  return value ? percent.format(value) : "–";
}

/** Distingue "sem documento classificado nesse contrato" (undefined → "–") de "0% real" (documento existe, valor zero). */
export function formatParticipacao(value: number | undefined) {
  return value === undefined ? "–" : percent.format(value / 100);
}
