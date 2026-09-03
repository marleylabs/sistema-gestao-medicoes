import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("Tarefa F: serviços reais no Postgres E2E, incluindo rollback e preservação histórica", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-exclusao-services.ts"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 60000,
  });
  assert.match(output, /PASS: serviços reais/);
});
