import assert from "node:assert/strict";
import test from "node:test";
import { cicloToDates, cicloToMesReferencia, formatCicloLabel } from "../lib/ciclo";

test("cicloToDates deriva corretamente ciclos YYMM válidos, inclusive virada de ano", () => {
  assert.deepEqual(cicloToDates("2601"), {
    atoInicio: "2025-12-21",
    atoFim: "2026-01-20",
    producaoInicio: "2025-11-21",
    producaoFim: "2025-12-20",
  });
  assert.deepEqual(cicloToDates("2608"), {
    atoInicio: "2026-07-21",
    atoFim: "2026-08-20",
    producaoInicio: "2026-06-21",
    producaoFim: "2026-07-20",
  });
  assert.deepEqual(cicloToDates("2612"), {
    atoInicio: "2026-11-21",
    atoFim: "2026-12-20",
    producaoInicio: "2026-10-21",
    producaoFim: "2026-11-20",
  });
  assert.equal(cicloToMesReferencia("2608"), "Agosto de 2026");
});

for (const ciclo of ["", "TESTE", "TESTE-TESTE-E2E", "2600", "2613", " 2608", "2608 ", "260", "26080"]) {
  test(`cicloToDates rejeita ciclo inválido com contexto: ${JSON.stringify(ciclo)}`, () => {
    assert.throws(
      () => cicloToDates(ciclo),
      (error: unknown) => error instanceof RangeError && error.message.includes("Ciclo inválido") && error.message.includes(JSON.stringify(ciclo)),
    );
  });
}

test("cicloToMesReferencia aplica a mesma validação canônica", () => {
  assert.throws(() => cicloToMesReferencia("2613"), /Ciclo inválido/);
});

test("formatCicloLabel mostra mês abreviado e ano, inclusive na virada de ano", () => {
  assert.equal(formatCicloLabel("2608"), "Ago/2026");
  assert.deepEqual(["2611", "2612", "2701", "2702"].map(formatCicloLabel), ["Nov/2026", "Dez/2026", "Jan/2027", "Fev/2027"]);
  assert.deepEqual(
    ["2601", "2602", "2603", "2604", "2605", "2606", "2607", "2608", "2609", "2610", "2611", "2612"].map(formatCicloLabel),
    ["Jan/2026", "Fev/2026", "Mar/2026", "Abr/2026", "Mai/2026", "Jun/2026", "Jul/2026", "Ago/2026", "Set/2026", "Out/2026", "Nov/2026", "Dez/2026"],
  );
});

test("formatCicloLabel aplica a mesma validação canônica de YYMM", () => {
  for (const ciclo of ["", "2613", "2600", "GERAL", " 2608"]) assert.throws(() => formatCicloLabel(ciclo), /Ciclo inválido/);
});
