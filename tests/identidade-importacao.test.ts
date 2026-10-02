import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { pareceNomeDeFornecedor } from "../lib/identidade-plausivel";

const ROOT = path.join(__dirname, "..");

test("heurística de apresentação: resíduo de parser nunca parece nome de fornecedor", () => {
  for (const lixo of [
    "GRD-T-SINT-SA-2026-0001-0001",
    "GRD-T-SINT-2025-0000-0002",
    "ORC-SINT-0001",
    "MC-SINT-C-00001",
    "HORAS DE ESTUDO PARA ADEQUACAO DO PROJETO DE TUBULACAO DA AREA",
    "",
    "  ",
    "AB",
  ]) {
    assert.equal(pareceNomeDeFornecedor(lixo), false, lixo);
  }
  for (const nome of ["FORNECEDOR ALFA TESTE", "JOSÉ DA SILVA", "EMPRESA SINTETICA ENGENHARIA", "ENGESINT", "D'ÁVILA SOUZA"]) {
    assert.equal(pareceNomeDeFornecedor(nome), true, nome);
  }
});

test("rotas de escrita/busca exigem ADMIN no backend; verificação aceita MEDICAO/ADMIN", () => {
  const base = path.join(ROOT, "app", "api", "admin", "importacao", "identidades");
  for (const rota of ["alias", "fornecedores"]) {
    const src = readFileSync(path.join(base, rota, "route.ts"), "utf8");
    assert.match(src, /requireAdmin\(\)/, rota);
    assert.match(src, /perfil !== "ADMIN"[\s\S]*status: 403/, rota);
  }
  const verificar = readFileSync(path.join(base, "verificar", "route.ts"), "utf8");
  assert.match(verificar, /requireAdmin\(\)/);
  assert.doesNotMatch(verificar, /\.(create|update|upsert|delete)\w*\(/); // só leitura
});

test("UI de resolução nunca usa window.confirm e não reimporta sozinha", () => {
  const src = readFileSync(path.join(ROOT, "components", "importacao", "identidades-pendentes.tsx"), "utf8");
  assert.doesNotMatch(src, /window\.confirm|confirm\(/);
  assert.doesNotMatch(src, /\/api\/admin\/etl/);
  assert.match(src, /Todas as identidades foram resolvidas\. Reimporte a medição\./);
  assert.match(src, /Sugestão \(não aplicada\)/);
});

test("alias da importação no PostgreSQL E2E (vínculo, conflito, concorrência, reimportação no ETL)", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-identidade-importacao.ts"], {
    cwd: ROOT, encoding: "utf8", timeout: 120000,
  });
  assert.match(output, /PASS: resolução de identidades da importação/);
});
