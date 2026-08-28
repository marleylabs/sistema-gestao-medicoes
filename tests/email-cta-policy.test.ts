import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { isEmailCtaEnabled } from "../lib/email/cta-policy";
import { bmAvailableTemplate } from "../lib/email/templates/bm-available";
import { bmDivergenceTemplate } from "../lib/email/templates/bm-divergence";
import { bmApprovedTemplate } from "../lib/email/templates/bm-approved";
import { bmRevisionRequestedTemplate } from "../lib/email/templates/bm-revision-requested";
import { paymentReadyTemplate } from "../lib/email/templates/payment-ready";
import { paymentCompletedTemplate } from "../lib/email/templates/payment-completed";
import { passwordResetTemplate } from "../lib/email/templates/password-reset";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function withEnv(value: string | undefined, fn: () => void) {
  const original = process.env.EMAIL_CTA_ENABLED;
  if (value === undefined) delete process.env.EMAIL_CTA_ENABLED; else process.env.EMAIL_CTA_ENABLED = value;
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env.EMAIL_CTA_ENABLED; else process.env.EMAIL_CTA_ENABLED = original;
  }
}

// ─── isEmailCtaEnabled: interpretação estrita ─────────────────────────────────────────────────

test("isEmailCtaEnabled: só o literal 'true' habilita", () => {
  withEnv("true", () => assert.equal(isEmailCtaEnabled(), true));
});

test("isEmailCtaEnabled: 'false', vazio, ausente ou qualquer outro valor mantém desabilitado", () => {
  withEnv("false", () => assert.equal(isEmailCtaEnabled(), false));
  withEnv("", () => assert.equal(isEmailCtaEnabled(), false));
  withEnv(undefined, () => assert.equal(isEmailCtaEnabled(), false));
  withEnv("TRUE", () => assert.equal(isEmailCtaEnabled(), false));
  withEnv("1", () => assert.equal(isEmailCtaEnabled(), false));
});

// ─── EMAIL_CTA_ENABLED=false → templates operacionais sem <a href> ────────────────────────────

test("BM_AVAILABLE: appUrl null não renderiza botão, mas preserva o restante do conteúdo", () => {
  const content = bmAvailableTemplate({ nome: "Adilson Gaio", ciclo: "2608", appUrl: null });
  assert.doesNotMatch(content.html, /<a\s+href/);
  assert.doesNotMatch(content.text, /Acesse:/);
  assert.match(content.html, /Adilson Gaio/);
  assert.match(content.html, /2608/);
});

test("BM_DIVERGENCE: appUrl null não renderiza botão", () => {
  const content = bmDivergenceTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", quantidade: 2, appUrl: null });
  assert.doesNotMatch(content.html, /<a\s+href/);
  assert.doesNotMatch(content.text, /Acesse:/);
});

test("BM_APPROVED: appUrl null não renderiza botão, mas preserva fornecedor/ciclo/valor/data", () => {
  const content = bmApprovedTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor: 17010, aprovadoAt: new Date("2026-08-27T12:00:00Z"), appUrl: null });
  assert.doesNotMatch(content.html, /<a\s+href/);
  assert.match(content.html, /R\$\s*17\.010,00/);
  assert.match(content.html, /Adilson Gaio/);
});

test("BM_REVISION_REQUESTED: appUrl null não renderiza botão, mas preserva motivo", () => {
  const content = bmRevisionRequestedTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", motivo: "Documento ilegível", appUrl: null });
  assert.doesNotMatch(content.html, /<a\s+href/);
  assert.match(content.html, /Documento ilegível/);
});

test("PAYMENT_READY: appUrl null não renderiza botão, mas preserva menção à NF", () => {
  const content = paymentReadyTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor: 17010, appUrl: null });
  assert.doesNotMatch(content.html, /<a\s+href/);
  assert.match(content.html, /Nota Fiscal/i);
});

test("PAYMENT_COMPLETED: appUrl null não renderiza botão, mas preserva valor/data/menção ao Portal", () => {
  const content = paymentCompletedTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor: 17010, pagoAt: new Date("2026-08-27T12:00:00Z"), appUrl: null });
  assert.doesNotMatch(content.html, /<a\s+href/);
  assert.match(content.html, /Portal do Fornecedor/);
});

// ─── appUrl presente (CTA ligado) → volta a usar a URL oficial normalmente ────────────────────

test("EMAIL_CTA_ENABLED=true (appUrl presente): CTA volta a usar a URL oficial, com botão e linha 'Acesse:'", () => {
  const url = "https://smfprojeta.boingaestrutural.com/";
  const content = bmAvailableTemplate({ nome: "Adilson Gaio", ciclo: "2608", appUrl: url });
  assert.match(content.html, new RegExp(`<a href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(content.text, /Acesse: https:\/\/smfprojeta\.boingaestrutural\.com\//);
});

// ─── PASSWORD_RESET é exceção: nunca perde o link, mesmo com o CTA operacional desligado ──────

test("PASSWORD_RESET continua com link mesmo com EMAIL_CTA_ENABLED=false — nunca é opcional", () => {
  const content = passwordResetTemplate({ nome: "Ana Souza", appUrl: "https://smfprojeta.boingaestrutural.com/login" });
  assert.match(content.html, /<a\s+href="https:\/\/smfprojeta\.boingaestrutural\.com\/login"/);
});

// ─── Nenhum template operacional referencia localhost/127.0.0.1 ──────────────────────────────

test("templates operacionais nunca contêm localhost/127.0.0.1, com ou sem CTA", () => {
  const withCta = bmApprovedTemplate({ fornecedorNome: "X", ciclo: "2608", valor: 0, aprovadoAt: new Date(), appUrl: "https://smfprojeta.boingaestrutural.com/?section=evidencias" });
  const withoutCta = bmApprovedTemplate({ fornecedorNome: "X", ciclo: "2608", valor: 0, aprovadoAt: new Date(), appUrl: null });
  for (const content of [withCta, withoutCta]) {
    assert.doesNotMatch(content.html, /localhost|127\.0\.0\.1/i);
    assert.doesNotMatch(content.text, /localhost|127\.0\.0\.1/i);
  }
});

// ─── A regra fica centralizada em events.ts, não espalhada em cada template ───────────────────

test("guarda de regressão: nenhum template lê EMAIL_CTA_ENABLED diretamente — a decisão vem de lib/email/events.ts", () => {
  const templateFiles = [
    "lib/email/templates/bm-available.ts",
    "lib/email/templates/bm-divergence.ts",
    "lib/email/templates/bm-approved.ts",
    "lib/email/templates/bm-revision-requested.ts",
    "lib/email/templates/payment-ready.ts",
    "lib/email/templates/payment-completed.ts",
  ];
  for (const file of templateFiles) {
    const source = readSource(file);
    assert.doesNotMatch(source, /EMAIL_CTA_ENABLED/, `${file} não deveria ler EMAIL_CTA_ENABLED diretamente`);
  }
  const eventsSource = readSource("lib/email/events.ts");
  assert.match(eventsSource, /isEmailCtaEnabled\(\)/);
  // Os três helpers operacionais usam a regra; loginUrl() (PASSWORD_RESET) não.
  assert.match(eventsSource, /function portalUrl\(\): string \| null \{\s*return isEmailCtaEnabled/);
  assert.match(eventsSource, /function evidenciasUrl\(\): string \| null \{\s*return isEmailCtaEnabled/);
  assert.match(eventsSource, /function financeiroUrl\(\): string \| null \{\s*return isEmailCtaEnabled/);
  assert.doesNotMatch(eventsSource, /function loginUrl\(\)[^}]*isEmailCtaEnabled/s);
});
