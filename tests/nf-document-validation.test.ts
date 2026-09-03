import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateNfDocumentAgainstCadastro } from "../lib/nf-document-validation";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "nf");

async function validate(file: string, expectedRazaoSocial = "TESTE B SERVICOS LTDA") {
  return validateNfDocumentAgainstCadastro({
    buffer: await readFile(path.join(fixtures, file)),
    mimeType: "application/pdf",
    expectedCnpj: "11222333000181",
    expectedRazaoSocial,
  });
}

test("aceita NF pesquisável válida", async () => {
  assert.equal((await validate("valida-b.pdf")).ok, true);
});

test("aceita PDF com XRef regravado", async () => {
  assert.equal((await validate("xref-regravado.pdf")).ok, true);
});

test("rejeita CNPJ do prestador divergente", async () => {
  const result = await validate("cnpj-errado.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /CNPJ do prestador.*diverge/i);
});

test("rejeita razão social divergente", async () => {
  const result = await validate("razao-errada.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /razão social.*diverge/i);
});

test("rejeita tomador divergente", async () => {
  const result = await validate("tomador-errado.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /CNPJ do tomador/i);
});

test("rejeita PDF sem texto", async () => {
  const result = await validate("sem-texto.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /não foi possível ler/i);
});

test("rejeita PDF falso e corrompido", async () => {
  for (const file of ["arquivo-falso.pdf", "corrompido.pdf"]) {
    const result = await validate(file);
    assert.equal(result.ok, false);
  }
});

test("massa de teste — CNPJ 21.701.545/0001-03 é extraído e validado pelo parser real, sem exceção para arquivo de teste", async () => {
  const result = await validateNfDocumentAgainstCadastro({
    buffer: await readFile(path.join(fixtures, "nf-teste-cnpj-21701545000103.pdf")),
    mimeType: "application/pdf",
    expectedCnpj: "21701545000103",
    expectedRazaoSocial: "Fornecedor Teste En Passant LTDA",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.detected.prestador.cnpj, "21701545000103");
});
