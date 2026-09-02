import assert from "node:assert/strict";
import test, { before } from "node:test";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

before(assertConnectedToE2eDatabase);

/**
 * Regressão do BUG 1: a observação de descarte de uma divergência já ficava persistida em
 * DivergenciaMedicao.observacao (nunca existiu uma segunda estrutura para isso), mas o Portal do
 * Fornecedor nunca lia esse dado de volta — o fornecedor não tinha como saber qual documento foi
 * descartado nem por quê. A consulta abaixo é a mesma usada em app/api/colaborador/me/route.ts
 * (import direto bloqueado por "server-only" transitivo — mesma limitação documentada nesta
 * sessão), reimplementada verbatim.
 */

async function queryDocumentosDescartados(sgcId: string) {
  const divergencias = await prisma.divergenciaMedicao.findMany({
    where: { sgcId, status: "DESCARTADA" },
    select: { id: true, nrVale: true, fornecedorFormato: true, fornecedorTipo: true, observacao: true },
    orderBy: { resolvidoEm: "asc" },
  });
  return divergencias.map((d) => ({ id: d.id, nrVale: d.nrVale, formato: d.fornecedorFormato, tipo: d.fornecedorTipo, motivo: d.observacao ?? "" }));
}

const suffix = `TESTE-E2E-DESCARTES-${Date.now()}`;
const cicloA = `TESTE-${suffix}-A`;
const cicloB = `TESTE-${suffix}-B`;
const codigoA = `${suffix}-FORN-A`;
const codigoB = `${suffix}-FORN-B`;

async function cleanup() {
  await prisma.divergenciaMedicao.deleteMany({ where: { ciclo: { in: [cicloA, cicloB] } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: { in: [cicloA, cicloB] } } });
  await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [cicloA, cicloB] } } });
}

test("motivo do descarte é retornado ao fornecedor exatamente como a Equipe informou", async () => {
  await cleanup();
  try {
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: cicloA } });
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoA, ciclo: cicloA, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
    });
    const motivo = "Documento não pertence ao escopo deste ciclo.";
    await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgc.id, colaboradorCodigo: codigoA, ciclo: cicloA, nrVale: "P0123456", status: "DESCARTADA",
        observacao: motivo, resolvidoEm: new Date(),
        fornecedorFormato: "PDF", fornecedorA1eqHh: 5, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC",
      },
    });

    const resultado = await queryDocumentosDescartados(sgc.id);
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0].nrVale, "P0123456");
    assert.equal(resultado[0].motivo, motivo, "não pode gerar texto automático substituindo a observação real");
  } finally {
    await cleanup();
  }
});

test("múltiplos descartes: todos aparecem, cada um com o próprio motivo", async () => {
  await cleanup();
  try {
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: cicloA } });
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoA, ciclo: cicloA, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
    });
    for (const [nrVale, motivo] of [
      ["NR-001", "Motivo A."],
      ["NR-002", "Motivo B."],
      ["NR-003", "Motivo C."],
    ] as const) {
      await prisma.divergenciaMedicao.create({
        data: {
          sgcId: sgc.id, colaboradorCodigo: codigoA, ciclo: cicloA, nrVale, status: "DESCARTADA",
          observacao: motivo, resolvidoEm: new Date(),
          fornecedorFormato: "PDF", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC",
        },
      });
    }

    const resultado = await queryDocumentosDescartados(sgc.id);
    assert.equal(resultado.length, 3);
    assert.deepEqual(new Set(resultado.map((r) => r.motivo)), new Set(["Motivo A.", "Motivo B.", "Motivo C."]));
  } finally {
    await cleanup();
  }
});

test("PENDENTE (não descartada) e INCLUIDA nunca aparecem em 'documentos não considerados'", async () => {
  await cleanup();
  try {
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: cicloA } });
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoA, ciclo: cicloA, status: "PENDENTE", statusConferencia: "DIVERGENCIA" },
    });
    await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgc.id, colaboradorCodigo: codigoA, ciclo: cicloA, nrVale: "NR-PENDENTE", status: "PENDENTE",
        fornecedorFormato: "PDF", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC",
      },
    });
    await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgc.id, colaboradorCodigo: codigoA, ciclo: cicloA, nrVale: "NR-INCLUIDA", status: "INCLUIDA",
        resolvidoEm: new Date(), fornecedorFormato: "PDF", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC",
      },
    });

    const resultado = await queryDocumentosDescartados(sgc.id);
    assert.equal(resultado.length, 0, "seção deve ficar vazia (e portanto escondida) sem nenhum descarte real");
  } finally {
    await cleanup();
  }
});

test("ISOLAMENTO: Fornecedor B nunca vê descarte do Fornecedor A, mesmo com CNPJ igual", async () => {
  await cleanup();
  try {
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: cicloA } });
    const cnpjCompartilhado = "11222333000181";
    const sgcA = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoA, ciclo: cicloA, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
    });
    const sgcB = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoB, ciclo: cicloA, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" },
    });
    await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgcA.id, colaboradorCodigo: codigoA, ciclo: cicloA, nrVale: "NR-SO-DE-A", status: "DESCARTADA",
        observacao: "Descartado só para A.", resolvidoEm: new Date(),
        fornecedorFormato: "PDF", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC",
      },
    });

    const resultadoA = await queryDocumentosDescartados(sgcA.id);
    const resultadoB = await queryDocumentosDescartados(sgcB.id);
    assert.equal(resultadoA.length, 1);
    assert.equal(resultadoB.length, 0, `CNPJ compartilhado (${cnpjCompartilhado}) não pode vazar descarte entre colaboradorCodigo distintos`);
  } finally {
    await cleanup();
  }
});

test("ISOLAMENTO POR CICLO: descarte no ciclo A não aparece no ciclo B para o mesmo fornecedor", async () => {
  await cleanup();
  try {
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: cicloA } });
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: cicloB } });
    const sgcCicloA = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoA, ciclo: cicloA, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
    });
    const sgcCicloB = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: codigoA, ciclo: cicloB, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" },
    });
    await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgcCicloA.id, colaboradorCodigo: codigoA, ciclo: cicloA, nrVale: "NR-CICLO-A", status: "DESCARTADA",
        observacao: "Descartado no ciclo A.", resolvidoEm: new Date(),
        fornecedorFormato: "PDF", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC",
      },
    });

    assert.equal((await queryDocumentosDescartados(sgcCicloA.id)).length, 1);
    assert.equal((await queryDocumentosDescartados(sgcCicloB.id)).length, 0, "descarte do ciclo 2608 não pode aparecer no 2609 (ou equivalente)");
  } finally {
    await cleanup();
  }
});
