import assert from "node:assert/strict";
import test from "node:test";
import { getMapaPagamentoDisplayStatus } from "../lib/sgc-display-status";

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

test("status desconhecido nunca quebra — cai para AGUARDANDO em vez de lançar", () => {
  assert.equal(getMapaPagamentoDisplayStatus("ALGO_NOVO_INESPERADO", "CONCLUIDA"), "AGUARDANDO");
});
