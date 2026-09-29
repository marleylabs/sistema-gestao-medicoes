import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("inativação administrativa e reconciliação canônica no PostgreSQL E2E", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-inativacao-identidade.ts"], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 60000,
  });
  assert.match(output, /PASS: inativação, reativação/);
});
