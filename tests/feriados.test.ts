import assert from "node:assert/strict";
import test from "node:test";
import { feriadosNacionais, feriadosNacionaisNoPeriodo, pascoa } from "../lib/feriados";

test("páscoa de anos conhecidos", () => {
  assert.equal(pascoa(2024), "2024-03-31");
  assert.equal(pascoa(2025), "2025-04-20");
  assert.equal(pascoa(2026), "2026-04-05");
  assert.equal(pascoa(2027), "2027-03-28");
});

test("os 10 feriados nacionais de 2026, sem pontos facultativos", () => {
  assert.deepEqual(
    feriadosNacionais(2026).map((f) => f.data),
    ["2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"],
  );
});

test("20/11 só é nacional a partir de 2024", () => {
  assert.equal(feriadosNacionais(2023).some((f) => f.data === "2023-11-20"), false);
  assert.equal(feriadosNacionais(2024).some((f) => f.data === "2024-11-20"), true);
});

test("período que atravessa o ano (ciclo 2701: 21/12/2026 a 20/01/2027)", () => {
  assert.deepEqual(
    feriadosNacionaisNoPeriodo("2026-12-21", "2027-01-20").map((f) => f.data),
    ["2026-12-25", "2027-01-01"],
  );
});
