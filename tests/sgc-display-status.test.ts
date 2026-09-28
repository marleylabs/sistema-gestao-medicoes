import assert from "node:assert/strict";
import test from "node:test";
import {
  getMapaPagamentoDisplayStatus,
  getMapaPagamentoStatusMeta,
  indexSgcStatusByColaborador,
} from "../lib/sgc-display-status";

/**
 * Guarda de regressão do BUG 1B: "Pagamentos por Fornecedor" continuava mostrando DIVERGÊNCIA
 * mesmo depois de resolvida a última divergência pendente. A causa não era o cálculo em si
 * (lib/conferencia-resolucao.ts já recalculava statusConferencia corretamente) — era a tela não
 * reler o dado atualizado sem F5. Este teste cobre a REGRA de apresentação centralizada
 * (lib/sgc-display-status.ts); o refresh automático é coberto pelos Playwright multiusuário.
 */

test("PENDENTE + DIVERGENCIA → DIVERGENCIA", () => {
  assert.equal(getMapaPagamentoDisplayStatus("PENDENTE", "DIVERGENCIA"), "DIVERGENCIA");
});

test("PENDENTE + CONCLUIDA → AGUARDANDO (última divergência resolvida)", () => {
  assert.equal(getMapaPagamentoDisplayStatus("PENDENTE", "CONCLUIDA"), "AGUARDANDO");
});

test("PENDENTE + AGUARDANDO_UPLOAD → AGUARDANDO", () => {
  assert.equal(getMapaPagamentoDisplayStatus("PENDENTE", "AGUARDANDO_UPLOAD"), "AGUARDANDO");
});

test("PENDENTE sem statusConferencia (null/undefined) → AGUARDANDO, nunca DIVERGENCIA por engano", () => {
  assert.equal(getMapaPagamentoDisplayStatus("PENDENTE", null), "AGUARDANDO");
  assert.equal(getMapaPagamentoDisplayStatus("PENDENTE", undefined), "AGUARDANDO");
});

test("status != PENDENTE nunca vira DIVERGENCIA mesmo se statusConferencia estiver defasado", () => {
  // Caso real possível: BM já aprovado (AGUARDANDO_NF) mas o registro de conferência antigo ainda
  // carrega DIVERGENCIA de uma rodada anterior — resolver a conferência NUNCA reabre o status do BM.
  assert.equal(getMapaPagamentoDisplayStatus("AGUARDANDO_NF", "DIVERGENCIA"), "AGUARDANDO_NF");
});

test("AGUARDANDO_ENVIO, REVISAO_SOLICITADA, APROVADO, PAGO, CANCELADO passam direto", () => {
  assert.equal(getMapaPagamentoDisplayStatus("AGUARDANDO_ENVIO", "AGUARDANDO_UPLOAD"), "AGUARDANDO_ENVIO");
  assert.equal(getMapaPagamentoDisplayStatus("REVISAO_SOLICITADA", "CONCLUIDA"), "REVISAO_SOLICITADA");
  assert.equal(getMapaPagamentoDisplayStatus("APROVADO", "CONCLUIDA"), "APROVADO");
  assert.equal(getMapaPagamentoDisplayStatus("PAGO", "CONCLUIDA"), "PAGO");
  assert.equal(getMapaPagamentoDisplayStatus("CANCELADO", "CONCLUIDA"), "CANCELADO");
});

test("resposta em lista de /api/sgc/status é indexada pelo colaborador e preserva o id real", () => {
  const indexed = indexSgcStatusByColaborador([{
    sgcId: "sgc-1",
    colaboradorCodigo: "P0000001",
    ciclo: "2608",
    status: "PENDENTE",
    revisaoNumero: 0,
    statusConferencia: "AGUARDANDO_UPLOAD",
  }]);
  assert.deepEqual(indexed.P0000001, {
    id: "sgc-1",
    status: "PENDENTE",
    revisaoNumero: 0,
    statusConferencia: "AGUARDANDO_UPLOAD",
  });
});

test("mapper visual cobre todos os estados canônicos sem fallback cinza para workflow ativo", () => {
  assert.deepEqual(getMapaPagamentoStatusMeta("AGUARDANDO_ENVIO", "CONCLUIDA"), {
    label: "Aguardando envio", badge: "neutral", rowTone: "neutral", final: false,
  });
  assert.equal(getMapaPagamentoStatusMeta("PENDENTE", "AGUARDANDO_UPLOAD").badge, "warning");
  assert.equal(getMapaPagamentoStatusMeta("PENDENTE", "DIVERGENCIA").badge, "danger");
  assert.equal(getMapaPagamentoStatusMeta("REVISAO_SOLICITADA", "CONCLUIDA").badge, "warning");
  assert.equal(getMapaPagamentoStatusMeta("AGUARDANDO_NF", "CONCLUIDA").label, "Aguardando NF");
  assert.equal(getMapaPagamentoStatusMeta("APROVADO", "CONCLUIDA").label, "Aguardando pagamento");
  assert.equal(getMapaPagamentoStatusMeta("PAGO", "CONCLUIDA").badge, "success");
  assert.equal(getMapaPagamentoStatusMeta("CANCELADO", "CONCLUIDA").label, "Cancelado");
});

test("status desconhecido nunca quebra — cai para AGUARDANDO em vez de lançar", () => {
  assert.equal(getMapaPagamentoDisplayStatus("ALGO_NOVO_INESPERADO", "CONCLUIDA"), "AGUARDANDO");
});
