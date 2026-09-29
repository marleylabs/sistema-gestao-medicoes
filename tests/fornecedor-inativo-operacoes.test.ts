import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("fornecedor inativo não recebe e-mail operacional nem nova medição no PostgreSQL E2E", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-fornecedor-inativo-operacoes.ts"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 60000,
  });
  assert.match(output, /PASS: fornecedor inativo bloqueado/);
});
