/**
 * Resolve os destinatários EFETIVOS (TO/CC/BCC) a partir dos pretendidos e da configuração de
 * modo de teste. É a ÚNICA função que decide isso — nenhum evento de negócio deve neutralizar
 * CC/BCC por conta própria. Enquanto EMAIL_TEST_MODE=true, TODO evento (qualquer fornecedor,
 * qualquer CC de Equipe de Medição/Financeiro) é redirecionado inteiramente para
 * EMAIL_TEST_RECIPIENT em TO, com CC e BCC sempre vazios — a aplicação continua calculando os
 * destinatários reais internamente, só não os usa para enviar.
 */
export type RecipientPolicyConfig = {
  testMode: boolean;
  testRecipient: string | null | undefined;
};

export type IntendedRecipients = {
  to: string[];
  cc?: string[];
  bcc?: string[];
};

export type ActualRecipients = {
  to: string[];
  cc: string[];
  bcc: string[];
};

export type RecipientPolicyResult =
  | { ok: true; actual: ActualRecipients; testMode: boolean }
  | { ok: false; error: string };

function dedupeCaseInsensitive(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * `intended.to/cc/bcc` podem conter duplicatas (mesmo endereço em dois campos, ou repetido
 * dentro do mesmo campo) — sempre deduplicados (case-insensitive) antes de decidir o destino
 * efetivo, e um endereço que já está em TO nunca é repetido em CC/BCC (nunca duas entregas do
 * mesmo evento para o mesmo endereço).
 */
export function resolveActualRecipients(
  intended: IntendedRecipients,
  config: RecipientPolicyConfig,
): RecipientPolicyResult {
  const to = dedupeCaseInsensitive(intended.to);
  let cc = dedupeCaseInsensitive(intended.cc ?? []);
  let bcc = dedupeCaseInsensitive(intended.bcc ?? []);

  if (config.testMode) {
    const testRecipient = config.testRecipient?.trim();
    if (!testRecipient) {
      // Nunca usar o destinatário real como fallback quando o teste está mal configurado —
      // é exatamente o cenário que o modo de teste existe para prevenir.
      return { ok: false, error: "EMAIL_TEST_MODE está ativo, mas EMAIL_TEST_RECIPIENT não está configurado." };
    }
    // Um evento lógico gera uma única entrega de teste — sempre só TO, nunca CC/BCC reais,
    // mesmo que o evento pretenda CC (ex.: Equipe de Medição, Financeiro).
    return { ok: true, actual: { to: [testRecipient], cc: [], bcc: [] }, testMode: true };
  }

  if (!to.length) {
    return { ok: false, error: "Nenhum destinatário real disponível para este evento." };
  }

  const toKeys = new Set(to.map((a) => a.toLowerCase()));
  cc = cc.filter((a) => !toKeys.has(a.toLowerCase()));
  const ccKeys = new Set(cc.map((a) => a.toLowerCase()));
  bcc = bcc.filter((a) => !toKeys.has(a.toLowerCase()) && !ccKeys.has(a.toLowerCase()));

  return { ok: true, actual: { to, cc, bcc }, testMode: false };
}
