import assert from "node:assert/strict";
import test from "node:test";
import { getEmailCcForEvent, parseEmailList } from "../lib/email/cc-policy";

const originalBmCc = process.env.EMAIL_BM_CC;
const originalFinanceCc = process.env.EMAIL_FINANCE_CC;

test.after(() => {
  process.env.EMAIL_BM_CC = originalBmCc;
  process.env.EMAIL_FINANCE_CC = originalFinanceCc;
});

test("parseEmailList: separa por vírgula, remove espaços e vazios", () => {
  assert.deepEqual(parseEmailList("a@x.com, b@x.com ,  c@x.com"), ["a@x.com", "b@x.com", "c@x.com"]);
});

test("parseEmailList: descarta entradas com formato inválido sem quebrar as demais", () => {
  assert.deepEqual(parseEmailList("a@x.com, nao-e-email, b@x.com"), ["a@x.com", "b@x.com"]);
});

test("parseEmailList: deduplica case-insensitive preservando a primeira grafia", () => {
  assert.deepEqual(parseEmailList("A@x.com, a@x.com, a@X.COM"), ["A@x.com"]);
});

test("parseEmailList: configuração vazia/ausente retorna lista vazia", () => {
  assert.deepEqual(parseEmailList(""), []);
  assert.deepEqual(parseEmailList(undefined), []);
  assert.deepEqual(parseEmailList(null), []);
});

test("getEmailCcForEvent: eventos de BM usam EMAIL_BM_CC", () => {
  process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com,anderson.marley@projetacs.com";
  process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com,ximenes.silva@projetacs.com";
  const expected = ["gabriel.sousa@projetacs.com", "anderson.marley@projetacs.com"];
  assert.deepEqual(getEmailCcForEvent("BM_AVAILABLE"), expected);
  assert.deepEqual(getEmailCcForEvent("BM_DIVERGENCE"), expected);
  assert.deepEqual(getEmailCcForEvent("BM_APPROVED"), expected);
  assert.deepEqual(getEmailCcForEvent("BM_REVISION_REQUESTED"), expected);
});

test("getEmailCcForEvent: eventos financeiros usam EMAIL_FINANCE_CC", () => {
  process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com,anderson.marley@projetacs.com";
  process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com,ximenes.silva@projetacs.com";
  const expected = ["financeiro@projetacs.com", "ximenes.silva@projetacs.com"];
  assert.deepEqual(getEmailCcForEvent("PAYMENT_READY"), expected);
  assert.deepEqual(getEmailCcForEvent("PAYMENT_COMPLETED"), expected);
});

test("getEmailCcForEvent: PASSWORD_RESET nunca recebe CC automático, mesmo com as duas variáveis configuradas", () => {
  process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com";
  process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com";
  assert.deepEqual(getEmailCcForEvent("PASSWORD_RESET"), []);
});

test("getEmailCcForEvent: configuração ausente resulta em CC vazio, nunca erro", () => {
  delete process.env.EMAIL_BM_CC;
  delete process.env.EMAIL_FINANCE_CC;
  assert.deepEqual(getEmailCcForEvent("BM_AVAILABLE"), []);
  assert.deepEqual(getEmailCcForEvent("PAYMENT_READY"), []);
});
