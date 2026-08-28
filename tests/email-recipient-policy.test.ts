import assert from "node:assert/strict";
import test from "node:test";
import { resolveActualRecipients } from "../lib/email/recipient-policy";

test("EMAIL_TEST_MODE=true redireciona o destinatário pretendido para o e-mail de teste, CC/BCC vazios", () => {
  const result = resolveActualRecipients({ to: ["fornecedor@empresa.com"] }, { testMode: true, testRecipient: "anderson.marley@projetacs.com" });
  assert.deepEqual(result, { ok: true, actual: { to: ["anderson.marley@projetacs.com"], cc: [], bcc: [] }, testMode: true });
});

test("EMAIL_TEST_MODE=false usa o destinatário real pretendido", () => {
  const result = resolveActualRecipients({ to: ["fornecedor@empresa.com"] }, { testMode: false, testRecipient: null });
  assert.deepEqual(result, { ok: true, actual: { to: ["fornecedor@empresa.com"], cc: [], bcc: [] }, testMode: false });
});

test("EMAIL_TEST_MODE=true sem EMAIL_TEST_RECIPIENT configurado falha (nunca usa o real como fallback)", () => {
  const result = resolveActualRecipients({ to: ["fornecedor@empresa.com"] }, { testMode: true, testRecipient: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /EMAIL_TEST_RECIPIENT/);
});

test("EMAIL_TEST_MODE=true com testRecipient undefined também falha com segurança", () => {
  const result = resolveActualRecipients({ to: ["fornecedor@empresa.com"] }, { testMode: true, testRecipient: undefined });
  assert.equal(result.ok, false);
});

test("grupo (Equipe de Medição com vários usuários): em teste gera UMA única entrega, não uma cópia por destinatário real", () => {
  const result = resolveActualRecipients(
    { to: ["medicao1@empresa.com", "medicao2@empresa.com", "medicao3@empresa.com"] },
    { testMode: true, testRecipient: "anderson.marley@projetacs.com" },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actual.to.length, 1);
    assert.deepEqual(result.actual.to, ["anderson.marley@projetacs.com"]);
  }
});

test("intendedRecipients duplicados são deduplicados antes de decidir o destino", () => {
  const result = resolveActualRecipients(
    { to: ["fornecedor@empresa.com", "fornecedor@empresa.com", " fornecedor@empresa.com "] },
    { testMode: false, testRecipient: null },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.actual.to, ["fornecedor@empresa.com"]);
});

test("produção sem nenhum destinatário real disponível falha com erro controlado (nunca envia para ninguém)", () => {
  const result = resolveActualRecipients({ to: [] }, { testMode: false, testRecipient: null });
  assert.equal(result.ok, false);
});

test("teste com lista de TO vazia ainda assim redireciona para o e-mail de teste (permite validar o pipeline mesmo sem destinatário real resolvido)", () => {
  const result = resolveActualRecipients({ to: [] }, { testMode: true, testRecipient: "anderson.marley@projetacs.com" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.actual.to, ["anderson.marley@projetacs.com"]);
});

// ─── CC/BCC — item central desta tarefa: nunca reais em modo de teste ───

test("modo de teste: CC/BCC pretendidos NUNCA são usados, mesmo com endereços reais definidos (BM_CC)", () => {
  const result = resolveActualRecipients(
    { to: ["fornecedor@gmail.com"], cc: ["gabriel.sousa@projetacs.com", "anderson.marley@projetacs.com"] },
    { testMode: true, testRecipient: "anderson.marley@projetacs.com" },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.actual.to, ["anderson.marley@projetacs.com"]);
    assert.deepEqual(result.actual.cc, []);
    assert.deepEqual(result.actual.bcc, []);
  }
});

test("modo de teste: CC pretendido de Financeiro também nunca vaza", () => {
  const result = resolveActualRecipients(
    { to: ["fornecedor@gmail.com"], cc: ["financeiro@projetacs.com", "ximenes.silva@projetacs.com"] },
    { testMode: true, testRecipient: "anderson.marley@projetacs.com" },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.actual.cc, []);
});

test("produção: CC pretendido é usado integralmente quando não colide com TO", () => {
  const result = resolveActualRecipients(
    { to: ["fornecedor@gmail.com"], cc: ["gabriel.sousa@projetacs.com", "anderson.marley@projetacs.com"] },
    { testMode: false, testRecipient: null },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.actual.to, ["fornecedor@gmail.com"]);
    assert.deepEqual(result.actual.cc, ["gabriel.sousa@projetacs.com", "anderson.marley@projetacs.com"]);
  }
});

test("deduplicação: endereço presente em TO e CC ao mesmo tempo gera só uma entrega (nunca duas cópias)", () => {
  const result = resolveActualRecipients(
    { to: ["anderson.marley@projetacs.com"], cc: ["anderson.marley@projetacs.com"] },
    { testMode: false, testRecipient: null },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.actual.to, ["anderson.marley@projetacs.com"]);
    assert.deepEqual(result.actual.cc, []);
  }
});

test("deduplicação é case-insensitive entre TO e CC", () => {
  const result = resolveActualRecipients(
    { to: ["Anderson.Marley@projetacs.com"], cc: ["anderson.marley@PROJETACS.com"] },
    { testMode: false, testRecipient: null },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.actual.cc, []);
});

test("BCC também é removido de duplicidade contra TO e contra CC já resolvido", () => {
  const result = resolveActualRecipients(
    { to: ["a@empresa.com"], cc: ["b@empresa.com"], bcc: ["a@empresa.com", "b@empresa.com", "c@empresa.com"] },
    { testMode: false, testRecipient: null },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.actual.bcc, ["c@empresa.com"]);
});

test("produção sem CC/BCC pretendido resulta em CC/BCC efetivo vazio (nunca inventa destinatário)", () => {
  const result = resolveActualRecipients({ to: ["fornecedor@empresa.com"] }, { testMode: false, testRecipient: null });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.actual.cc, []);
    assert.deepEqual(result.actual.bcc, []);
  }
});
