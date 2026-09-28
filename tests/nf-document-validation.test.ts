import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateNfDocumentAgainstCadastro } from "../lib/nf-document-validation";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "nf");

async function validate(file: string) {
  return validateNfDocumentAgainstCadastro({
    buffer: await readFile(path.join(fixtures, file)),
    mimeType: "application/pdf",
    expectedCnpj: "11222333000181",
  });
}

test("aceita NF pesquisável válida", async () => {
  assert.equal((await validate("valida-b.pdf")).ok, true);
});

test("aceita PDF com XRef regravado", async () => {
  assert.equal((await validate("xref-regravado.pdf")).ok, true);
});

test("rejeita CNPJ do fornecedor divergente", async () => {
  const result = await validate("cnpj-errado.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /CNPJ do fornecedor.*não corresponde/i);
});

test("aceita razão social divergente quando os dois CNPJs estão corretos", async () => {
  const result = await validate("razao-errada.pdf");
  assert.equal(result.ok, true);
});

test("rejeita tomador divergente", async () => {
  const result = await validate("tomador-errado.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /CNPJ do tomador/i);
});

test("rejeita ambos os CNPJs divergentes e informa os dois problemas", async () => {
  const result = await validate("ambos-errados.pdf");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /CNPJ do fornecedor.*não corresponde/i);
    assert.match(result.error, /CNPJ do tomador.*não corresponde/i);
  }
});

test("rejeita CNPJ ausente na seção correspondente", async () => {
  const fornecedorAusente = await validate("prestador-ausente.pdf");
  assert.equal(fornecedorAusente.ok, false);
  if (!fornecedorAusente.ok) assert.match(fornecedorAusente.error, /identificar o CNPJ do fornecedor/i);

  const tomadorAusente = await validate("tomador-ausente.pdf");
  assert.equal(tomadorAusente.ok, false);
  if (!tomadorAusente.ok) assert.match(tomadorAusente.error, /identificar o CNPJ do tomador/i);
});

test("não confunde o CNPJ de uma parte quando a seção da outra parte está ausente", async () => {
  const fornecedorAusente = await validate("secao-prestador-ausente.pdf");
  assert.equal(fornecedorAusente.ok, false);
  if (!fornecedorAusente.ok) assert.match(fornecedorAusente.error, /identificar o CNPJ do fornecedor/i);

  const tomadorAusente = await validate("secao-tomador-ausente.pdf");
  assert.equal(tomadorAusente.ok, false);
  if (!tomadorAusente.ok) assert.match(tomadorAusente.error, /identificar o CNPJ do tomador/i);
});

test("aceita CNPJs sem máscara, nomes diferentes e valor documental diferente", async () => {
  const result = await validate("cnpjs-sem-mascara-nomes-e-valor-diferentes.pdf");
  assert.equal(result.ok, true);
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
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.detected.prestador.cnpj, "21701545000103");
});
