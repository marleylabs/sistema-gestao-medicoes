import assert from "node:assert/strict";
import test from "node:test";
import { cicloToDates, cicloToMesReferencia } from "../lib/ciclo";

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
