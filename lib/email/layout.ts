function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Só aceita http(s) — nunca deixa um valor de configuração virar javascript:/data: no href do CTA. */
function safeHttpUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export { escapeHtml, safeHttpUrl };

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR");

export function formatCurrencyBRL(value: number | null | undefined) {
  return currencyFormatter.format(value ?? 0);
}

export function formatDatePtBR(value: Date | string | null | undefined) {
  if (!value) return "";
  return dateFormatter.format(new Date(value));
}

/**
 * Identidade visual En Passant / Gestão de Medições para e-mail: branco, #AF1B1B institucional,
 * CTA único, HTML deliberadamente simples (tabelas/inline styles) para renderizar de forma
 * previsível nos principais clientes de e-mail — nunca o CSS complexo da aplicação web.
 */
/**
 * Marcador estável no HTML onde `sendTransactionalEmail` injeta (ou remove) o aviso de ambiente
 * de teste — templates nunca sabem se estão em modo de teste, isso é decidido centralmente em
 * `lib/email/send-email.ts` a partir de `EMAIL_TEST_MODE`, nunca evento por evento.
 */
export const TEST_BANNER_ANCHOR = "<!--EMAIL_TEST_BANNER-->";

export function emailLayout(opts: {
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const cta = opts.ctaUrl && safeHttpUrl(opts.ctaUrl)
    ? `<p style="margin:28px 0 8px;"><a href="${safeHttpUrl(opts.ctaUrl)}" style="display:inline-block;background:#AF1B1B;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:14px;">${escapeHtml(opts.ctaLabel ?? "Acessar plataforma")}</a></p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#F7F7F5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#0A0A0A;padding:18px 28px;">
                <span style="color:#FFFFFF;font-size:14px;font-weight:700;letter-spacing:0.04em;">EN PASSANT</span>
                <span style="color:#9CA3AF;font-size:12px;margin-left:8px;">Gestão de Medições</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px;">
                ${TEST_BANNER_ANCHOR}
                <h1 style="margin:0 0 16px;color:#0A0A0A;font-size:18px;">${escapeHtml(opts.title)}</h1>
                <div style="color:#1A1A1A;font-size:14px;line-height:1.6;">${opts.bodyHtml}</div>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 24px;border-top:1px solid #F3F4F6;margin-top:20px;">
                <p style="margin:0;color:#9CA3AF;font-size:11px;">Este é um e-mail automático. Não responda a esta mensagem.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
