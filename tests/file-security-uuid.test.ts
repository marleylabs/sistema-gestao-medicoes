import assert from "node:assert/strict";
import test from "node:test";
import { isUuid } from "../lib/file-security";

/**
 * Guarda de regressão: um :id malformado em /api/colaborador/nf/[id] e
 * /api/colaborador/comprovante/[id] batia direto num `prisma....findUnique({ where: { id } })`
 * por UUID sem validar o formato antes — Postgres/Prisma respondiam com
 * `PrismaClientKnownRequestError P2023` (não tratado, vira 500) em vez do 404 esperado para um
 * recurso inexistente. Encontrado explorando os mesmos endpoints testados no cenário de
 * ownership/IDOR da Fase 4 (e2e/workflow-happy-path.spec.ts).
 */

test("isUuid aceita um UUID v4 real", () => {
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
});

test("isUuid rejeita um id malformado (não vira query Prisma inválida)", () => {
  assert.equal(isUuid("nonexistent-id"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("../../etc/passwd"), false);
});

test("isUuid é case-insensitive (Postgres normaliza UUID independente de caixa)", () => {
  assert.equal(isUuid("550E8400-E29B-41D4-A716-446655440000"), true);
});
