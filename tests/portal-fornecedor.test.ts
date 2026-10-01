import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { calcularBoletim, isDocumentoDesconto, type DocumentoBoletim } from "../lib/boletim-calculo";
import { getPortalStatusMeta, isFinancialFollowUpStatus } from "../lib/portal-fornecedor";

/**
 * Redesign do Portal do Fornecedor (aprovação do BM): só apresentação. Estes testes travam o que
 * NÃO pode mudar — rótulos de status vistos pelo fornecedor, composição pelo cálculo canônico do BM
 * (lib/boletim-calculo.ts, coberto em tests/bm-calculo-consistencia.test.ts), a mesma ação
 * ENVIAR (exige SALVAR antes) e a proteção contra duplo envio — e o que o redesign corrigiu
 * (window.confirm e enum técnico em tela).
 */

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function documento(overrides: Partial<DocumentoBoletim>): DocumentoBoletim {
  return { projetoReferente: "SE-1", numeroDocumento: "VALE-1", contrato: "CTO-A", tipo2: "DG", valorMedido: 100, ...overrides };
}

test("rótulos de status do fornecedor continuam os mesmos (e nunca o enum técnico)", () => {
  assert.deepEqual(getPortalStatusMeta("PENDENTE"), { label: "Pendente de validação", badge: "neutral" });
  assert.deepEqual(getPortalStatusMeta("REVISAO_SOLICITADA"), { label: "Revisão solicitada", badge: "warning" });
  assert.deepEqual(getPortalStatusMeta("AGUARDANDO_NF"), { label: "Aguardando envio da NF", badge: "warning" });
  assert.deepEqual(getPortalStatusMeta("APROVADO"), { label: "Aguardando pagamento", badge: "brand" });
  assert.deepEqual(getPortalStatusMeta("PAGO"), { label: "Medição concluída", badge: "success" });
  assert.deepEqual(getPortalStatusMeta("AGUARDANDO_ENVIO"), { label: "Aguardando envio do BM", badge: "neutral" });
  assert.deepEqual(getPortalStatusMeta("CANCELADO"), { label: "BM cancelado", badge: "neutral" });
  for (const status of ["PENDENTE", "AGUARDANDO_NF", "APROVADO", "PAGO", "DIVERGENCIA"]) {
    assert.notEqual(getPortalStatusMeta(status).label, status);
    assert.doesNotMatch(getPortalStatusMeta(status).label, /diverg/i);
  }
  assert.equal(isFinancialFollowUpStatus("APROVADO"), true);
  assert.equal(isFinancialFollowUpStatus("PAGO"), true);
  assert.equal(isFinancialFollowUpStatus("AGUARDANDO_NF"), false);
});

test("composição do Portal = cálculo canônico: fixo + adicionais + documentos − descontos (tipo, projeto ou número)", () => {
  const c = calcularBoletim({
    documentos: [
      documento({ valorMedido: 1000 }),
      documento({ valorMedido: 250.5 }),
      documento({ tipo2: "DESCONTO", valorMedido: -80 }),
      documento({ tipo2: null, projetoReferente: "desconto", valorMedido: 20 }),
      documento({ tipo2: null, numeroDocumento: "Desconto", valorMedido: -5 }),
    ],
    condicoesFixas: { valorFixo: "R$ 1.500,00", adicionaisFixos: "200" },
    valorInformado: 2845.5,
    rev: 0,
  });
  assert.equal(c.documentosMedidos.length, 2);
  assert.equal(c.descontos.length, 3);
  assert.deepEqual([c.valorFixo, c.adicionais, c.totalCondicoesFixas], [1500, 200, 1700]);
  assert.equal(c.totalDocumentos, 1250.5);
  assert.equal(c.totalDescontos, 105);
  assert.equal(c.totalMedicao, 2845.5);
  assert.equal(c.totalAPagar, 2845.5);
  assert.equal(c.diferencaValorGravado, 0);
  assert.equal(c.tipoCondicaoFixa, "FIXO PJ");
  assert.equal(isDocumentoDesconto({ tipo2: " desconto ", projetoReferente: "x", numeroDocumento: null }), true);
});

test("nenhuma tela calcula o BM por conta própria: Portal, PDF, drawers e Financeiro usam o cálculo canônico", () => {
  const consumidores = {
    "components/colaborador-app.tsx": /calcularBoletim\(/,
    "components/boletim-medicao.tsx": /calcularBoletim\(/,
    "components/pagamento-editor.tsx": /calcularBoletim\(/,
    "components/boletim-resumo.tsx": /resumoBoletim\(/,
    "components/financeiro/financeiro-drawer.tsx": /resumoBoletim\(/,
  };
  for (const [arquivo, uso] of Object.entries(consumidores)) assert.match(readSource(arquivo), uso, arquivo);
  // Sem fórmulas paralelas: nenhum desses arquivos soma valorMedido para formar total nem estima o fixo pelo valor gravado.
  for (const arquivo of [...Object.keys(consumidores), "components/portal-fornecedor.tsx"]) {
    const fonte = readSource(arquivo);
    assert.doesNotMatch(fonte, /totalValor - docBasedTotal|totalMedidoLiquido|composicaoPortal/, arquivo);
  }
  assert.doesNotMatch(readSource("components/portal-fornecedor.tsx"), /\.reduce\(\(s(um)?, d\) => s(um)? \+/, "Portal não soma documentos");
});

test("aprovação continua sendo a ação ENVIAR, com SALVAR antes, sem window.confirm e sem duplo envio", () => {
  const source = readSource("components/colaborador-app.tsx");
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /fetch\("\/api\/colaborador\/sgc", \{/);
  assert.match(source, /onConfirm=\{\(\) => void sendSgc\("ENVIAR"\)\}/);
  assert.match(source, /onConfirm=\{\(\) => void sendSgc\("SOLICITAR_REVISAO"\)\}/);
  assert.match(source, /onClick=\{\(\) => sendSgc\("SALVAR"\)\}/);
  assert.match(source, /disabled=\{saving \|\| !salvoAt\}/, "Aprovar só habilita depois de salvar (regra do servidor)");
  assert.match(source, /if \(sgcRequestInFlightRef\.current\) return;/, "proteção contra duplo clique preservada");
  assert.doesNotMatch(source, /(^\s*|>)\{data\.sgc\.status\}\s*(<|$)/m, "o enum técnico nunca é exibido ao fornecedor (texto JSX)");
});

test("portal: diálogos acessíveis e nenhuma terminologia interna", () => {
  const ui = readSource("components/portal-fornecedor.tsx");
  assert.match(ui, /role=\{role\}/);
  assert.match(ui, /role="alertdialog"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /aria-labelledby=\{`\$\{id\}-titulo`\}/);
  assert.match(ui, /htmlFor=\{campoId\}/);
  assert.match(ui, /aria-expanded=\{aberto\}/);
  assert.doesNotMatch(ui, /diverg/i);
  assert.doesNotMatch(ui, /em análise/i, "'EM ANÁLISE' é exclusivo do estado de análise da conferência");
  const app = readSource("components/colaborador-app.tsx");
  const bm = app.slice(app.indexOf("Conteúdo visível após envio do BM"), app.indexOf("{/* ── Minhas Medições ── */}"));
  assert.doesNotMatch(bm, /em análise/i);
  assert.doesNotMatch(bm, /SISTEMA APROVAÇÃO/);
});
