/**
 * PRÉ-FLIGHT de produção para o envio real de e-mails transacionais (Resend). NUNCA envia e-mail
 * real — só valida configuração e renderiza os templates para inspecionar os links/subjects.
 * Deve rodar (e passar 100%) ANTES de qualquer alteração de EMAIL_TEST_MODE para "false".
 *
 * Uso: npx tsx scripts/preflight-email-production.ts
 */
import { isProductionSafeAppUrl, isResendDevSender, normalizeAppUrl, buildRootUrl, buildSectionUrl, buildLoginUrl } from "../lib/email/app-url";
import { parseEmailList, validateCcConfig } from "../lib/email/cc-policy";
import { isEmailCtaEnabled } from "../lib/email/cta-policy";
import { passwordResetTemplate } from "../lib/email/templates/password-reset";
import { bmAvailableTemplate } from "../lib/email/templates/bm-available";
import { bmDivergenceTemplate } from "../lib/email/templates/bm-divergence";
import { bmApprovedTemplate } from "../lib/email/templates/bm-approved";
import { bmRevisionRequestedTemplate } from "../lib/email/templates/bm-revision-requested";
import { paymentReadyTemplate } from "../lib/email/templates/payment-ready";
import { paymentCompletedTemplate } from "../lib/email/templates/payment-completed";

type CheckResult = { label: string; ok: boolean; detail: string };
const results: CheckResult[] = [];
function check(label: string, ok: boolean, detail: string) {
  results.push({ label, ok, detail });
}

function extractHrefs(html: string): string[] {
  return Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
}

async function main() {
  const appUrl = process.env.APP_URL;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  const emailEnabled = process.env.EMAIL_ENABLED;
  const testMode = process.env.EMAIL_TEST_MODE;

  check("RESEND_API_KEY configurada", !!apiKey && apiKey.trim().length > 0, apiKey ? "configurada (valor omitido)" : "AUSENTE");
  check("RESEND_FROM_EMAIL usa domínio boinga.com.br", /@boinga\.com\.br/i.test(fromEmail ?? ""), fromEmail ?? "AUSENTE");
  check("RESEND_FROM_EMAIL não usa @resend.dev", !isResendDevSender(fromEmail), fromEmail ?? "AUSENTE");
  check("EMAIL_ENABLED=true", emailEnabled === "true", `EMAIL_ENABLED=${emailEnabled}`);
  check("EMAIL_TEST_MODE ainda 'true' durante o pré-flight", testMode !== "false", `EMAIL_TEST_MODE=${testMode}`);
  check("APP_URL = https://smfprojeta.boingaestrutural.com", normalizeAppUrl(appUrl) === "https://smfprojeta.boingaestrutural.com", `APP_URL=${appUrl}`);
  check("APP_URL é segura para produção (HTTPS, não-local)", isProductionSafeAppUrl(appUrl), `APP_URL=${appUrl}`);

  const bmCcRaw = process.env.EMAIL_BM_CC ?? "";
  const financeCcRaw = process.env.EMAIL_FINANCE_CC ?? "";
  const bmCc = parseEmailList(bmCcRaw);
  const financeCc = parseEmailList(financeCcRaw);
  check("EMAIL_BM_CC configurado", bmCc.length > 0, bmCcRaw || "AUSENTE");
  check("EMAIL_FINANCE_CC configurado", financeCc.length > 0, financeCcRaw || "AUSENTE");
  check(
    "EMAIL_BM_CC contém Gabriel + Anderson",
    bmCc.some((e) => e.toLowerCase().includes("gabriel.sousa")) && bmCc.some((e) => e.toLowerCase().includes("anderson.marley")),
    bmCc.join(", "),
  );
  check(
    "EMAIL_FINANCE_CC contém financeiro + Ximenes",
    financeCc.some((e) => e.toLowerCase().includes("financeiro@")) && financeCc.some((e) => e.toLowerCase().includes("ximenes.silva")),
    financeCc.join(", "),
  );
  const ccIssues = validateCcConfig();
  check("EMAIL_BM_CC/EMAIL_FINANCE_CC sem entradas malformadas", ccIssues.length === 0, JSON.stringify(ccIssues));

  // CTA operacional (BM/Financeiro) segue EMAIL_CTA_ENABLED; PASSWORD_RESET nunca é afetado.
  const ctaEnabled = isEmailCtaEnabled();
  check("EMAIL_CTA_ENABLED", true, `EMAIL_CTA_ENABLED=${process.env.EMAIL_CTA_ENABLED} → CTA operacional ${ctaEnabled ? "LIGADO" : "DESLIGADO"}`);
  const operationalUrl = (path: "" | "evidencias" | "financeiro") =>
    ctaEnabled ? (path ? buildSectionUrl(appUrl, path) : buildRootUrl(appUrl)) : null;

  // Renderiza cada template com a URL final e confirma: nenhum href com localhost, e a rota
  // esperada para cada evento (Portal/Evidências/Financeiro/login) — ou nenhum href quando o CTA
  // operacional está desligado. PASSWORD_RESET sempre mantém o link, independente do CTA.
  const templatesToCheck: { event: string; html: string; expectedUrl: string | null }[] = [
    { event: "PASSWORD_RESET", html: passwordResetTemplate({ nome: "Teste", appUrl: buildLoginUrl(appUrl) }).html, expectedUrl: buildLoginUrl(appUrl) },
    { event: "BM_AVAILABLE", html: bmAvailableTemplate({ nome: "Teste", ciclo: "2608", appUrl: operationalUrl("") }).html, expectedUrl: operationalUrl("") },
    { event: "BM_DIVERGENCE", html: bmDivergenceTemplate({ fornecedorNome: "Teste", ciclo: "2608", quantidade: 1, appUrl: operationalUrl("evidencias") }).html, expectedUrl: operationalUrl("evidencias") },
    { event: "BM_APPROVED", html: bmApprovedTemplate({ fornecedorNome: "Teste", ciclo: "2608", valor: 100, aprovadoAt: new Date(), appUrl: operationalUrl("evidencias") }).html, expectedUrl: operationalUrl("evidencias") },
    { event: "BM_REVISION_REQUESTED", html: bmRevisionRequestedTemplate({ fornecedorNome: "Teste", ciclo: "2608", motivo: null, appUrl: operationalUrl("evidencias") }).html, expectedUrl: operationalUrl("evidencias") },
    { event: "PAYMENT_READY", html: paymentReadyTemplate({ fornecedorNome: "Teste", ciclo: "2608", valor: 100, appUrl: operationalUrl("financeiro") }).html, expectedUrl: operationalUrl("financeiro") },
    { event: "PAYMENT_COMPLETED", html: paymentCompletedTemplate({ fornecedorNome: "Teste", ciclo: "2608", valor: 100, pagoAt: new Date(), appUrl: operationalUrl("") }).html, expectedUrl: operationalUrl("") },
  ];

  for (const t of templatesToCheck) {
    const hrefs = extractHrefs(t.html);
    const hasLocalhost = hrefs.some((h) => /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(h));
    check(`${t.event}: nenhum href com localhost`, !hasLocalhost, hrefs.join(", "));
    if (t.expectedUrl === null) {
      check(`${t.event}: CTA desligado — nenhum botão renderizado`, hrefs.length === 0, hrefs.join(", "));
    } else {
      check(`${t.event}: CTA aponta para a rota esperada (${t.expectedUrl})`, hrefs.includes(t.expectedUrl), hrefs.join(", "));
      const hasDoubleSlash = hrefs.some((h) => /\/\//.test(h.replace(/^https?:\/\//, "")));
      check(`${t.event}: CTA sem barra dupla`, !hasDoubleSlash, hrefs.join(", "));
    }
  }

  console.log("\n═══ PRÉ-FLIGHT DE PRODUÇÃO — E-MAIL TRANSACIONAL ═══\n");
  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? "✔" : "✖"} ${r.label}${r.ok ? "" : ` — ${r.detail}`}`);
    if (!r.ok) allOk = false;
  }
  console.log(`\nResultado: ${allOk ? "APROVADO" : "REPROVADO — corrigir os itens ✖ antes de ativar EMAIL_TEST_MODE=false"}`);
  process.exit(allOk ? 0 : 1);
}

main();
