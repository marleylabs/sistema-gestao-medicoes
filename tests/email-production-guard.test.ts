import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  isProductionSafeAppUrl,
  isResendDevSender,
  normalizeAppUrl,
  buildRootUrl,
  buildSectionUrl,
  buildLoginUrl,
} from "../lib/email/app-url";
import { validateCcConfig } from "../lib/email/cc-policy";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

// ─── APP_URL: segurança para produção ─────────────────────────────────────────────────────────

test("isProductionSafeAppUrl: URL oficial de produção é aceita", () => {
  assert.equal(isProductionSafeAppUrl("https://smfprojeta.boingaestrutural.com"), true);
  assert.equal(isProductionSafeAppUrl("https://smfprojeta.boingaestrutural.com/"), true);
});

test("isProductionSafeAppUrl: rejeita localhost, 127.0.0.1 e 0.0.0.0 em qualquer forma", () => {
  assert.equal(isProductionSafeAppUrl("http://localhost:3000"), false);
  assert.equal(isProductionSafeAppUrl("https://localhost:3000"), false);
  assert.equal(isProductionSafeAppUrl("http://127.0.0.1:3000"), false);
  assert.equal(isProductionSafeAppUrl("http://0.0.0.0:3000"), false);
});

test("isProductionSafeAppUrl: rejeita HTTP (exige HTTPS)", () => {
  assert.equal(isProductionSafeAppUrl("http://smfprojeta.boingaestrutural.com"), false);
});

test("isProductionSafeAppUrl: rejeita vazio/ausente/inválida", () => {
  assert.equal(isProductionSafeAppUrl(""), false);
  assert.equal(isProductionSafeAppUrl(undefined), false);
  assert.equal(isProductionSafeAppUrl(null), false);
  assert.equal(isProductionSafeAppUrl("nao-e-uma-url"), false);
});

// ─── RESEND_FROM_EMAIL: proibição de @resend.dev em produção ─────────────────────────────────

test("isResendDevSender: detecta o domínio sandbox em qualquer formato de remetente", () => {
  assert.equal(isResendDevSender("onboarding@resend.dev"), true);
  assert.equal(isResendDevSender("En Passant <onboarding@resend.dev>"), true);
  assert.equal(isResendDevSender("ONBOARDING@RESEND.DEV"), true);
});

test("isResendDevSender: domínio verificado boinga.com.br não é sinalizado", () => {
  assert.equal(isResendDevSender("En Passant <planejamento@boinga.com.br>"), false);
  assert.equal(isResendDevSender("planejamento@boinga.com.br"), false);
});

// ─── Normalização e montagem de URL (sem barra dupla, sem concatenação frágil) ────────────────

test("normalizeAppUrl: remove barras finais", () => {
  assert.equal(normalizeAppUrl("https://smfprojeta.boingaestrutural.com/"), "https://smfprojeta.boingaestrutural.com");
  assert.equal(normalizeAppUrl("https://smfprojeta.boingaestrutural.com///"), "https://smfprojeta.boingaestrutural.com");
});

test("buildRootUrl: sempre uma única barra final, nunca dupla", () => {
  assert.equal(buildRootUrl("https://smfprojeta.boingaestrutural.com/"), "https://smfprojeta.boingaestrutural.com/");
  assert.equal(buildRootUrl("https://smfprojeta.boingaestrutural.com"), "https://smfprojeta.boingaestrutural.com/");
});

test("buildSectionUrl: monta o deep-link ?section= real usado pela SPA, sem barra dupla", () => {
  assert.equal(buildSectionUrl("https://smfprojeta.boingaestrutural.com/", "evidencias"), "https://smfprojeta.boingaestrutural.com/?section=evidencias");
  assert.equal(buildSectionUrl("https://smfprojeta.boingaestrutural.com", "financeiro"), "https://smfprojeta.boingaestrutural.com/?section=financeiro");
});

test("buildLoginUrl: aponta para a rota real /login, sem barra dupla", () => {
  assert.equal(buildLoginUrl("https://smfprojeta.boingaestrutural.com/"), "https://smfprojeta.boingaestrutural.com/login");
});

// ─── As seções usadas nos links de e-mail existem de fato na SPA ─────────────────────────────

test("guarda de regressão: 'evidencias' e 'financeiro' continuam seções válidas em components/medicoes-app.tsx (senão os links de e-mail quebram)", () => {
  const source = readSource("components/medicoes-app.tsx");
  assert.match(source, /"evidencias"/);
  assert.match(source, /"financeiro"/);
  assert.match(source, /sectionParam = currentSearchParams\.get\("section"\)/);
});

// ─── Validação de CC malformado (pré-flight) ──────────────────────────────────────────────────

test("validateCcConfig: sem problema quando as listas estão bem formadas", () => {
  const originalBm = process.env.EMAIL_BM_CC;
  const originalFinance = process.env.EMAIL_FINANCE_CC;
  process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com,anderson.marley@projetacs.com";
  process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com,ximenes.silva@projetacs.com";
  try {
    assert.deepEqual(validateCcConfig(), []);
  } finally {
    if (originalBm === undefined) delete process.env.EMAIL_BM_CC; else process.env.EMAIL_BM_CC = originalBm;
    if (originalFinance === undefined) delete process.env.EMAIL_FINANCE_CC; else process.env.EMAIL_FINANCE_CC = originalFinance;
  }
});

test("validateCcConfig: reporta entradas malformadas em vez de ignorar silenciosamente no pré-flight", () => {
  const originalBm = process.env.EMAIL_BM_CC;
  process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com,nao-e-email,anderson.marley@projetacs.com";
  try {
    const issues = validateCcConfig();
    assert.equal(issues.length, 1);
    assert.equal(issues[0].variable, "EMAIL_BM_CC");
    assert.deepEqual(issues[0].invalidEntries, ["nao-e-email"]);
  } finally {
    if (originalBm === undefined) delete process.env.EMAIL_BM_CC; else process.env.EMAIL_BM_CC = originalBm;
  }
});

// ─── Guardas de produção estão de fato ligadas no ÚNICO ponto de envio real ───────────────────

test("send-email.ts bloqueia o envio real (CONFIG_ERROR) quando APP_URL não é segura, só fora do modo de teste", () => {
  const source = readSource("lib/email/send-email.ts");
  assert.match(source, /if \(!testMode\)/);
  assert.match(source, /isProductionSafeAppUrl\(process\.env\.APP_URL\)/);
  assert.match(source, /status: "CONFIG_ERROR"/);
});

test("send-email.ts bloqueia o envio real (CONFIG_ERROR) quando RESEND_FROM_EMAIL é @resend.dev, só fora do modo de teste", () => {
  const source = readSource("lib/email/send-email.ts");
  assert.match(source, /isResendDevSender\(process\.env\.RESEND_FROM_EMAIL\)/);
});

test("send-email.ts continua removendo o banner/prefixo [TESTE] centralmente a partir de EMAIL_TEST_MODE, nunca por template", () => {
  const source = readSource("lib/email/send-email.ts");
  assert.match(source, /const subject = testMode \? `\[TESTE\] \$\{input\.content\.subject\}` : input\.content\.subject;/);
  assert.match(source, /stripTestBannerAnchor\(input\.content\.html\)/);
});

// ─── Cada evento aponta para a rota real correspondente (não a raiz para tudo) ────────────────

test("lib/email/events.ts: cada evento usa a URL correta (Portal, Evidências, Financeiro ou login) — nunca hardcode local", () => {
  const source = readSource("lib/email/events.ts");
  assert.doesNotMatch(source, /localhost:3000["'`]\s*\)/, "não deve haver fallback hardcoded de localhost fora de app-url.ts");
  assert.match(source, /appUrl: loginUrl\(\)/);
  assert.match(source, /appUrl: portalUrl\(\)/);
  assert.match(source, /appUrl: evidenciasUrl\(\)/);
  assert.match(source, /appUrl: financeiroUrl\(\)/);
});
