import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { assertConnectedToE2eDatabase, prismaTest } from "../lib/prisma-test";

/**
 * Invariante do Dashboard: o KPI "Valor medido" e o ponto do mesmo ciclo em "Evolução das medições"
 * saem da MESMA agregação (valor de pagamento do Mapa). Compara valores brutos (nunca strings
 * formatadas), com tolerância só de representação monetária. Ciclo próprio e isolado (3907).
 */
const CICLO = "3907";
const TOLERANCIA = 0.005;

async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  const adminPath = require.resolve(path.join(__dirname, "../lib/admin"));
  require.cache[adminPath] = {
    id: adminPath, filename: adminPath, loaded: true,
    exports: { requireAdmin: async () => ({ user: { id: randomUUID(), nome: "ADMIN TESTE DASHBOARD" }, response: null }) },
  } as any;
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { GET: getDashboard } = require("../app/api/dashboard/route");
  Module._load = originalLoad;

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const contratoNome = `CT DASH ${suffix}`;
  const profissionalIds: string[] = [];
  let projetoId = "";

  async function dashboard(query: string) {
    const response = await getDashboard({ nextUrl: new URL(`http://localhost/api/dashboard?${query}`) } as any);
    assert.equal(response.status, 200);
    return response.json() as Promise<{ cards: { totalMedido: number }; porCiclo: Array<{ ciclo: string; totalMedido: number }> }>;
  }

  function assertKpiIgualAoGrafico(data: Awaited<ReturnType<typeof dashboard>>, esperado: number) {
    const ponto = data.porCiclo.find((item) => item.ciclo === CICLO);
    assert.ok(ponto, "ciclo ausente do gráfico");
    assert.ok(Math.abs(data.cards.totalMedido - ponto.totalMedido) < TOLERANCIA, `KPI ${data.cards.totalMedido} ≠ gráfico ${ponto.totalMedido}`);
    assert.ok(Math.abs(ponto.totalMedido - esperado) < TOLERANCIA, `gráfico ${ponto.totalMedido} ≠ esperado ${esperado}`);
  }

  try {
    await prismaTest.mapaPagamentoContexto.create({ data: { ciclo: CICLO } });
    const projeto = await prismaTest.projeto.create({ data: { codigoProjeto: `DASH-${suffix}`, contrato: contratoNome } });
    projetoId = projeto.id;
    const [fornecedorA, fornecedorB] = await Promise.all(["A", "B"].map(async (label) => {
      const codigo = `TESTE DASH ${label} ${suffix}`;
      const profissional = await prismaTest.profissional.create({ data: { nome: codigo, codigo } });
      profissionalIds.push(profissional.id);
      return { codigo, id: profissional.id };
    }));
    // Produção só de A no contrato (participação 100% em contratoNome). valor_medicao propositalmente
    // diferente do Mapa, incluindo uma linha DESCONTO positiva — a série antiga somava esse campo cru.
    await prismaTest.medicao.createMany({
      data: [
        { numeroMedicao: `DASH-${suffix}-1`, idProjeto: projeto.id, idProfissional: fornecedorA.id, ciclo: CICLO, tipo2: "DOC", condicao: "100", equivalenteA1Horas: 1, percentualEmissao: 1, valorMedicao: 999, sourceRowHash: randomUUID() },
        { numeroMedicao: `DASH-${suffix}-2`, idProjeto: projeto.id, idProfissional: fornecedorA.id, ciclo: CICLO, tipo2: "DESCONTO", condicao: "0", valorMedicao: 50, sourceRowHash: randomUUID() },
      ],
    });
    await prismaTest.mapaPagamentoItem.createMany({
      data: [
        { ciclo: CICLO, ordem: 1, projetistaCodigo: fornecedorA.codigo, valor: 1000.5, sourceRowHash: randomUUID() },
        { ciclo: CICLO, ordem: 2, projetistaCodigo: fornecedorB.codigo, valor: 2500.25, sourceRowHash: randomUUID() },
        { ciclo: CICLO, ordem: 3, projetistaCodigo: fornecedorB.codigo, valor: 0, sourceRowHash: randomUUID() },
      ],
    });

    // Ciclo selecionado: KPI = gráfico = valor do Mapa (nunca a soma crua 999 + 50 de valor_medicao).
    assertKpiIgualAoGrafico(await dashboard(`ciclo=${CICLO}`), 3500.75);
    // Filtros de fornecedor e de contrato preservam o invariante.
    assertKpiIgualAoGrafico(await dashboard(`ciclo=${CICLO}&codigo=${encodeURIComponent(fornecedorA.codigo)}`), 1000.5);
    assertKpiIgualAoGrafico(await dashboard(`ciclo=${CICLO}&contrato=${encodeURIComponent(contratoNome)}`), 1000.5);

    // Geral: KPI = soma da série; série em ordem cronológica YYMM.
    const geral = await dashboard("ciclo=GERAL");
    const somaSerie = geral.porCiclo.reduce((total, item) => total + item.totalMedido, 0);
    assert.ok(Math.abs(geral.cards.totalMedido - somaSerie) < TOLERANCIA, `KPI geral ${geral.cards.totalMedido} ≠ soma ${somaSerie}`);
    assert.ok(Math.abs((geral.porCiclo.find((item) => item.ciclo === CICLO)?.totalMedido ?? NaN) - 3500.75) < TOLERANCIA);
    assert.deepEqual(geral.porCiclo.map((item) => item.ciclo), [...geral.porCiclo.map((item) => item.ciclo)].sort());

    console.log("PASS: KPI Valor medido e Evolução das medições usam a mesma agregação por ciclo.");
  } finally {
    await prismaTest.mapaPagamentoItem.deleteMany({ where: { ciclo: CICLO } });
    await prismaTest.medicao.deleteMany({ where: { ciclo: CICLO } });
    if (projetoId) await prismaTest.projeto.deleteMany({ where: { id: projetoId } });
    await prismaTest.profissional.deleteMany({ where: { id: { in: profissionalIds } } });
    await prismaTest.contrato.deleteMany({ where: { nome: contratoNome } });
    await prismaTest.mapaPagamentoContexto.deleteMany({ where: { ciclo: CICLO } });
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
