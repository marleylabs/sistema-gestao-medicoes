import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("resolver central de identidade operacional (aliases) no PostgreSQL E2E", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-profissional-identidade.ts"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 60000,
  });
  assert.match(output, /PASS: resolver de identidade/);
});
