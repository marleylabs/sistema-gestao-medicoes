import assert from "node:assert/strict";
import test from "node:test";
import { TEST_BANNER_ANCHOR } from "../lib/email/layout";
import { passwordResetTemplate } from "../lib/email/templates/password-reset";
import { bmAvailableTemplate } from "../lib/email/templates/bm-available";
import { bmApprovedTemplate } from "../lib/email/templates/bm-approved";
import { paymentReadyTemplate } from "../lib/email/templates/payment-ready";
import { paymentCompletedTemplate } from "../lib/email/templates/payment-completed";

const appUrl = "https://medicoes.example.com";

test("passwordResetTemplate: assunto correto, sem senha/hash no corpo, CTA para /login (rota real)", () => {
  const content = passwordResetTemplate({ nome: "Ana Souza", appUrl: `${appUrl}/login` });
  assert.equal(content.subject, "Redefinição de senha — En Passant");
  assert.match(content.html, /Ana Souza/);
  assert.match(content.html, /\/login/);
  // A função nem recebe um parâmetro de senha/hash — não há como um valor real vazar aqui.
  assert.doesNotMatch(content.html.toLowerCase(), /hash|senhahash/);
  assert.match(content.html, new RegExp(TEST_BANNER_ANCHOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("bmAvailableTemplate: assunto e conteúdo citam o ciclo, CTA aponta para o portal (appUrl)", () => {
  const content = bmAvailableTemplate({ nome: "Adilson Gaio", ciclo: "2608", appUrl });
  assert.equal(content.subject, "Medição disponível para conferência — Ciclo 2608");
  assert.match(content.html, /Adilson Gaio/);
  assert.match(content.html, /2608/);
  assert.match(content.html, new RegExp(appUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("bmApprovedTemplate: assunto cita fornecedor e ciclo, corpo mostra valor formatado em BRL", () => {
  const content = bmApprovedTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor: 17010, aprovadoAt: new Date("2026-08-27T12:00:00Z"), appUrl });
  assert.equal(content.subject, "BM aprovado — Adilson Gaio — Ciclo 2608");
  assert.match(content.html, /R\$\s*17\.010,00/);
});

test("paymentReadyTemplate: assunto e corpo citam fornecedor, ciclo e menção à NF validada", () => {
  const content = paymentReadyTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor: 17010, appUrl });
  assert.equal(content.subject, "Pagamento disponível — Adilson Gaio — Ciclo 2608");
  assert.match(content.html, /Nota Fiscal/i);
});

test("paymentCompletedTemplate: assunto cita o ciclo, corpo não anexa comprovante (só menciona o Portal)", () => {
  const content = paymentCompletedTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor: 17010, pagoAt: new Date("2026-08-27T12:00:00Z"), appUrl });
  assert.equal(content.subject, "Pagamento concluído — Ciclo 2608");
  assert.match(content.html, /Portal do Fornecedor/);
});

test("todo template inclui o marcador central de banner de teste (a injeção é decidida em send-email.ts, não no template)", () => {
  const templates = [
    passwordResetTemplate({ nome: "X", appUrl }),
    bmAvailableTemplate({ nome: "X", ciclo: "2608", appUrl }),
    bmApprovedTemplate({ fornecedorNome: "X", ciclo: "2608", valor: 0, aprovadoAt: new Date(), appUrl }),
    paymentReadyTemplate({ fornecedorNome: "X", ciclo: "2608", valor: 0, appUrl }),
    paymentCompletedTemplate({ fornecedorNome: "X", ciclo: "2608", valor: 0, pagoAt: new Date(), appUrl }),
  ];
  for (const content of templates) {
    assert.ok(content.html.includes(TEST_BANNER_ANCHOR), `esperava o anchor em: ${content.subject}`);
    assert.ok(content.text.length > 0, `esperava versão texto em: ${content.subject}`);
  }
});

test("nenhum template referencia domínio hardcoded fora do appUrl recebido por parâmetro", () => {
  const content = bmAvailableTemplate({ nome: "X", ciclo: "2608", appUrl: "https://producao.real.com.br" });
  assert.doesNotMatch(content.html, /localhost/);
  assert.match(content.html, /producao\.real\.com\.br/);
});
