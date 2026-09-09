import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prismaTest, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Cenários A-F do pedido de correção de "Evidências de Medição" — replica exatamente a query real
 * de GET /api/sgc/status (findMany com ciclo/colaboradorCodigo independentes, orderBy ciclo desc)
 * contra o Postgres E2E isolado. Não passa pela camada HTTP (getCurrentUser()/cookies() exigem um
 * request real do Next) — a autenticação/perfil da rota é coberta por leitura estática em
 * tests/evidencias-medicao.test.ts; aqui o alvo é comprovar a SEMÂNTICA da consulta.
 */
async function listar(where: { ciclo?: string; colaboradorCodigo?: string }) {
  const registros = await prismaTest.sgcAprovacaoMedicao.findMany({
    where: {
      ...(where.ciclo ? { ciclo: where.ciclo } : {}),
      ...(where.colaboradorCodigo ? { colaboradorCodigo: where.colaboradorCodigo } : {}),
    },
    select: { id: true, colaboradorCodigo: true, colaboradorNome: true, ciclo: true, status: true, revisaoNumero: true, statusConferencia: true, aprovadoAt: true },
    orderBy: [{ ciclo: "desc" }, { colaboradorNome: "asc" }],
  });
  return registros;
}

async function main() {
  await assertConnectedToE2eDatabase();

  const runId = randomUUID().slice(0, 8);
  const codigoX = `TESTE-EVID-X-${runId}`;
  const codigoY = `TESTE-EVID-Y-${runId}`;
  const ids: string[] = [];

  try {
    // Fornecedor X: 3 ciclos (2608, 2609, 2610). Fornecedor Y: só 2609 (para o cenário "só ciclo").
    const rows = await prismaTest.sgcAprovacaoMedicao.createManyAndReturn({
      data: [
        { colaboradorCodigo: codigoX, colaboradorNome: "Fornecedor X Teste", ciclo: `2608${runId}`, status: "PAGO" },
        { colaboradorCodigo: codigoX, colaboradorNome: "Fornecedor X Teste", ciclo: `2609${runId}`, status: "APROVADO" },
        { colaboradorCodigo: codigoX, colaboradorNome: "Fornecedor X Teste", ciclo: `2610${runId}`, status: "AGUARDANDO_NF" },
        { colaboradorCodigo: codigoY, colaboradorNome: "Fornecedor Y Teste", ciclo: `2609${runId}`, status: "PAGO" },
      ],
    });
    ids.push(...rows.map((r: { id: string }) => r.id));

    // ─── CENÁRIO A — Fornecedor X + ciclo 2609 -> 1 BM, ciclo 2609 ───
    const a = await listar({ colaboradorCodigo: codigoX, ciclo: `2609${runId}` });
    assert.equal(a.length, 1, "cenário A: esperava exatamente 1 BM");
    assert.equal(a[0].ciclo, `2609${runId}`);
    console.log("PASS (CENÁRIO A): fornecedor + ciclo -> 1 BM do ciclo certo.");

    // ─── CENÁRIO B — Fornecedor X + Todos os ciclos -> 3 BMs, nenhum omitido, ordem 2610/2609/2608 ───
    const b = await listar({ colaboradorCodigo: codigoX });
    assert.equal(b.length, 3, `cenário B (BUG PRINCIPAL): esperava 3 BMs do Fornecedor X, veio ${b.length} — a versão antiga só retornava 1 (o ciclo mais recente)`);
    assert.deepEqual(b.map((r) => r.ciclo), [`2610${runId}`, `2609${runId}`, `2608${runId}`], "ordem precisa ser do ciclo mais recente para o mais antigo");
    console.log("PASS (CENÁRIO B): fornecedor sozinho (todos os ciclos) -> 3 BMs, nenhum omitido, ordenados do mais recente.");

    // ─── CENÁRIO C — Todos os fornecedores + ciclo 2609 -> todos os BMs daquele ciclo (X e Y) ───
    const c = await listar({ ciclo: `2609${runId}` });
    assert.equal(c.length, 2, "cenário C: esperava os 2 BMs (X e Y) do ciclo 2609");
    assert.deepEqual(new Set(c.map((r) => r.colaboradorCodigo)), new Set([codigoX, codigoY]));
    console.log("PASS (CENÁRIO C): só ciclo selecionado -> todos os fornecedores daquele ciclo.");

    // ─── CENÁRIO D — fornecedor sem BM naquele ciclo -> 0 resultados ───
    const d = await listar({ colaboradorCodigo: codigoY, ciclo: `2608${runId}` });
    assert.equal(d.length, 0, "cenário D: Y não tem BM em 2608 — precisa retornar lista vazia, nunca erro");
    console.log("PASS (CENÁRIO D): fornecedor sem BM no ciclo -> 0 resultados (empty state).");

    // ─── CENÁRIO E — trocar fornecedor não mistura resultados do anterior (a própria query já
    // garante isso por construção — sem estado acumulado entre chamadas) ───
    const eX = await listar({ colaboradorCodigo: codigoX });
    const eY = await listar({ colaboradorCodigo: codigoY });
    assert.ok(eX.every((r) => r.colaboradorCodigo === codigoX));
    assert.ok(eY.every((r) => r.colaboradorCodigo === codigoY));
    console.log("PASS (CENÁRIO E): trocar fornecedor nunca mistura BMs de outro fornecedor.");

    // ─── CENÁRIO F — Fornecedor X (3 BMs) -> aplicar ciclo específico reduz para 1 -> remover reduz de volta a 3 ───
    const f1 = await listar({ colaboradorCodigo: codigoX });
    assert.equal(f1.length, 3);
    const f2 = await listar({ colaboradorCodigo: codigoX, ciclo: `2609${runId}` });
    assert.equal(f2.length, 1);
    const f3 = await listar({ colaboradorCodigo: codigoX });
    assert.equal(f3.length, 3, "remover o filtro de ciclo precisa voltar aos 3 BMs originais");
    console.log("PASS (CENÁRIO F): aplicar/remover filtro de ciclo reduz/restaura a lista corretamente.");

    console.log("\n=== TODOS OS CENÁRIOS (A-F) DE EVIDÊNCIAS DE MEDIÇÃO PASSARAM ===");
  } finally {
    if (ids.length) await prismaTest.sgcAprovacaoMedicao.deleteMany({ where: { id: { in: ids } } });
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
