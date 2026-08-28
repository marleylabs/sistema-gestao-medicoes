import type { EmailEvent } from "@/lib/email/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parser seguro de lista de e-mails vinda de env var: separa por vírgula, remove espaços,
 * descarta vazios, valida formato (entradas malformadas são silenciosamente ignoradas — nunca
 * derrubam o envio por causa de um erro de digitação na configuração) e deduplica
 * case-insensitive preservando a primeira grafia encontrada.
 */
export function parseEmailList(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const email = raw.trim();
    if (!email || !EMAIL_REGEX.test(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

const BM_EVENTS = new Set<EmailEvent>(["BM_AVAILABLE", "BM_DIVERGENCE", "BM_APPROVED", "BM_REVISION_REQUESTED"]);
const FINANCE_EVENTS = new Set<EmailEvent>(["PAYMENT_READY", "PAYMENT_COMPLETED"]);

/**
 * Política central de CC por categoria de evento — nenhum endpoint deve montar essa lista por
 * conta própria. PASSWORD_RESET (e qualquer evento futuro fora das duas categorias) nunca recebe
 * CC automático. Endereços vêm de configuração (EMAIL_BM_CC/EMAIL_FINANCE_CC), nunca hardcoded.
 */
export function getEmailCcForEvent(event: EmailEvent): string[] {
  if (BM_EVENTS.has(event)) return parseEmailList(process.env.EMAIL_BM_CC);
  if (FINANCE_EVENTS.has(event)) return parseEmailList(process.env.EMAIL_FINANCE_CC);
  return [];
}

/**
 * Validação de PRÉ-FLIGHT (nunca chamada no caminho de envio real): identifica entradas
 * malformadas em EMAIL_BM_CC/EMAIL_FINANCE_CC para reportar antes de liberar produção — o
 * runtime (`parseEmailList`) continua ignorando entradas malformadas silenciosamente por design
 * (uma vírgula errada na configuração nunca pode travar o envio de um BM/pagamento real).
 */
export function validateCcConfig(): { variable: string; raw: string; invalidEntries: string[] }[] {
  const issues: { variable: string; raw: string; invalidEntries: string[] }[] = [];
  for (const variable of ["EMAIL_BM_CC", "EMAIL_FINANCE_CC"] as const) {
    const raw = process.env[variable] ?? "";
    if (!raw.trim()) continue;
    const entries = raw.split(",").map((e) => e.trim()).filter(Boolean);
    const parsed = new Set(parseEmailList(raw).map((e) => e.toLowerCase()));
    const invalidEntries = entries.filter((e) => !parsed.has(e.toLowerCase()));
    if (invalidEntries.length) issues.push({ variable, raw, invalidEntries });
  }
  return issues;
}
