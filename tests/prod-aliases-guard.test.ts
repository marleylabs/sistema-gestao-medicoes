import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "prod-profissional-aliases.ts"), "utf8");
const applyIndex = source.indexOf("// ─── APPLY");

test("aliases de produção: dry-run é o padrão e roda numa transação READ ONLY", () => {
  assert.match(source, /const apply = process\.argv\.includes\("--apply"\)/);
  const dryRun = source.slice(source.indexOf("if (!apply) {"), applyIndex);
  assert.match(dryRun, /SET TRANSACTION READ ONLY/);
  assert.doesNotMatch(dryRun, /\.create\(|\.update\(|\.delete\(|\.upsert\(|\$executeRaw`/, "dry-run nunca escreve");
});

test("aliases de produção: APPLY exige flag, frase, alvo, fingerprint, ADMIN ativo e lista 100% APROVAR", () => {
  const apply = source.slice(applyIndex);
  assert.match(apply, /ALLOW_PROD_ALIAS_APPLY !== "true"/);
  assert.match(apply, /--confirm"\) !== "APLICAR_ALIASES_PRODUCAO"/);
  assert.match(apply, /argValue\("--alvo"\) !== alvoDb/);
  assert.match(apply, /fingerprintInformado !== fingerprint/);
  assert.match(apply, /admin\.perfil !== "ADMIN" \|\| !admin\.ativo/);
  assert.match(apply, /naoAprovados\.length\) throw/);
  assert.match(apply, /prisma\.\$transaction/);
  assert.match(apply, /if \(existente\) \{ jaExistentes\+\+; continue; \}/, "idempotente");
});

test("aliases de produção: nunca cria/exclui Profissional, nunca usa CNPJ como identidade, fuzzy só sugere", () => {
  assert.doesNotMatch(source, /profissional\.(create|upsert|delete|deleteMany|update)\(/);
  assert.doesNotMatch(source, /cnpj[^\n]*(equals|===)/i, "CNPJ só aparece mascarado no relatório");
  for (const especial of ["ENGEMELT", "GH ENGENHARIA", "PAULO SOUZA", "LEANDRO ALEIXO", "JOSE EVERTON"]) assert.ok(source.includes(`"${especial}"`), especial);
  assert.match(source, /caso especial com decisão de negócio pendente — nunca aprovado automaticamente/);
  assert.match(source, /rótulo com cara de empresa — nunca vira pessoa automaticamente/);
  assert.match(source, /ambíguo: o rótulo também sugere/);
});
