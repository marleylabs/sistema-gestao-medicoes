import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("Dashboard: KPI Valor medido = ponto do mesmo ciclo em Evolução das medições (PostgreSQL E2E)", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-dashboard-valor-medido.ts"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 60000,
  });
  assert.match(output, /PASS: KPI Valor medido e Evolução das medições/);
});
