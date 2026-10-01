import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { composicaoPortal, getPortalStatusMeta, isDocumentoDesconto, isFinancialFollowUpStatus, type PortalDocumento } from "../lib/portal-fornecedor";

/**
 * Redesign do Portal do Fornecedor (aprovação do BM): só apresentação. Estes testes travam o que
 * NÃO pode mudar — rótulos de status vistos pelo fornecedor, fórmula da composição, a mesma ação
 * ENVIAR (exige SALVAR antes) e a proteção contra duplo envio — e o que o redesign corrigiu
 * (window.confirm e enum técnico em tela).
 */

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function documento(overrides: Partial<PortalDocumento>): PortalDocumento {
  return {
    id: overrides.id ?? "d",
    projetoReferente: "SE-1",
    numeroDocumento: "VALE-1",
    contrato: "CTO-A",
    formato: "A1",
    equivalenteA1Horas: 1,
    percentualEmissao: 1,
    tipo2: "DG",
    condicao: "100",
    precoUnitario: 100,
    valorMedido: 100,
    obs: null,
    ...overrides,
  };
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

test("composição: condição fixa + adicionais + documentos − descontos (mesma fórmula da tabela antiga)", () => {
  const c = composicaoPortal(
    [
      documento({ id: "a", valorMedido: 1000 }),
      documento({ id: "b", valorMedido: 250.5, obs: "parcial" }),
      documento({ id: "c", tipo2: "DESCONTO", valorMedido: -80 }),
      documento({ id: "d", tipo2: null, projetoReferente: "desconto", valorMedido: 20 }),
      documento({ id: "e", tipo2: null, numeroDocumento: "Desconto", valorMedido: -5 }),
    ],
    { valorFixo: "R$ 1.500,00", adicionaisFixos: "200", tipoContratacao: null, observacoesContrato: null },
  );
  assert.equal(c.documentosMedidos.length, 2);
  assert.equal(c.descontos.length, 3);
  assert.equal(c.totalCondicoesFixas, 1700);
  assert.equal(c.totalDocumentos, 1250.5);
  assert.equal(c.totalDescontos, 105);
  assert.equal(c.totalLiquido, 1700 + 1250.5 - 105);
  assert.equal(c.hasFinancialAdjustments, true);
  assert.equal(c.tipoCondicaoFixa, "FIXO PJ");
  assert.equal(c.hasObs, true);
});

test("composição sem ajustes: total líquido = documentos medidos; sem documentos não quebra", () => {
  const c = composicaoPortal([documento({ id: "a", valorMedido: 300 })], null);
  assert.equal(c.hasFinancialAdjustments, false);
  assert.equal(c.totalLiquido, 300);
  const vazio = composicaoPortal([], undefined);
  assert.equal(vazio.totalLiquido, 0);
  assert.equal(vazio.documentosMedidos.length, 0);
  assert.equal(isDocumentoDesconto({ tipo2: " desconto ", projetoReferente: "x", numeroDocumento: null }), true);
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
