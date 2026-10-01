import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { paymentReadyTemplate } from "../lib/email/templates/payment-ready";
import { paymentCompletedTemplate } from "../lib/email/templates/payment-completed";
import { valorAPagar } from "../components/financeiro/shared";

/**
 * E-mails financeiros (pagamento liberado / pagamento concluído) com a semântica oficial:
 * TOTAL DA MEDIÇÃO = mapaPagamentoItem.valor; REV / AJUSTES = rev; TOTAL A PAGAR = valor + rev
 * (o mesmo "Valor a pagar" do Financeiro). REV negativo é aceito pelo domínio (numeric sem CHECK;
 * parseDecimal e ETL aceitam), então também é coberto.
 */

const appUrl = "https://app.exemplo.test/";
const pagoAt = new Date("2026-08-27T12:00:00Z");
const BRL = (s: string) => new RegExp(s.replace(/\./g, "\\.").replace(/\$/g, "\\$").replace(/ /g, "\\s*"));

const templates = {
  "pagamento liberado": (valor: number, rev?: number | null) => paymentReadyTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor, rev, appUrl }),
  "pagamento concluído": (valor: number, rev?: number | null) => paymentCompletedTemplate({ fornecedorNome: "Adilson Gaio", ciclo: "2608", valor, rev, pagoAt, appUrl }),
};

for (const [nome, render] of Object.entries(templates)) {
  test(`${nome}: REV = 0 mostra só "Total a pagar" (sem o rótulo genérico "Valor")`, () => {
    for (const content of [render(1500, 0), render(1500)]) {
      assert.match(content.html, /<strong>Total a pagar:<\/strong> R\$\s*1\.500,00/);
      assert.match(content.text, /Total a pagar: R\$\s*1\.500,00/);
      assert.doesNotMatch(content.html + content.text, /Valor:/);
      assert.doesNotMatch(content.html + content.text, /Total da medição|REV \/ Ajustes/, "sem REV, nada duplicado");
    }
  });

  test(`${nome}: REV positivo — Total da medição R$ 1.500,00 · REV R$ 250,00 · Total a pagar R$ 1.750,00`, () => {
    const content = render(1500, 250);
    assert.match(content.html, /Total da medição<\/td><td[^>]*>R\$\s*1\.500,00<\/td>/);
    assert.match(content.html, /REV \/ Ajustes<\/td><td[^>]*>R\$\s*250,00<\/td>/);
    assert.match(content.html, /<strong>Total a pagar<\/strong><\/td><td[^>]*><strong>R\$\s*1\.750,00<\/strong>/);
    assert.match(content.text, BRL("Total da medição: R$ 1.500,00"));
    assert.match(content.text, BRL("REV / Ajustes: R$ 250,00"));
    assert.match(content.text, BRL("Total a pagar: R$ 1.750,00"));
    assert.doesNotMatch(content.html + content.text, /Valor:/);
  });

  test(`${nome}: REV negativo — Total da medição R$ 1.500,00 · REV -R$ 250,00 · Total a pagar R$ 1.250,00`, () => {
    const content = render(1500, -250);
    assert.match(content.html, /REV \/ Ajustes<\/td><td[^>]*>-R\$\s*250,00<\/td>/);
    assert.match(content.html, /<strong>R\$\s*1\.250,00<\/strong>/);
    assert.match(content.text, BRL("REV / Ajustes: -R$ 250,00"));
    assert.match(content.text, BRL("Total a pagar: R$ 1.250,00"));
  });
}

test("Total a pagar do e-mail = 'Valor a pagar' do Financeiro (valor + rev), inclusive com REV negativo", () => {
  for (const [valor, rev] of [[1500, 0], [1500, 250], [1500, -250], [8640.5, 0.25]] as const) {
    const esperado = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valorAPagar({ valor, rev }));
    for (const render of Object.values(templates)) {
      assert.ok(render(valor, rev).text.includes(`Total a pagar: ${esperado}`), `${valor} + ${rev}`);
    }
  }
});

test("as duas rotas que disparam os e-mails passam valor E rev do mesmo item do mapa (sem recálculo)", () => {
  for (const arquivo of ["app/api/colaborador/nf/route.ts", "app/api/admin/financeiro/route.ts"]) {
    const fonte = fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8");
    assert.match(fonte, /select: \{ valor: true, rev: true \}/, arquivo);
    assert.match(fonte, /rev: mapaItem \? Number\(mapaItem\.rev\) : null,/, arquivo);
    assert.doesNotMatch(fonte, /calcularBoletim/, `${arquivo}: e-mail não reconstrói o BM`);
  }
});
