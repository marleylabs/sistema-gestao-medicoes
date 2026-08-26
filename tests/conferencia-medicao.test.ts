import assert from "node:assert/strict";
import test from "node:test";
import {
  compararDocumentos,
  normalizePercentual,
  parseFornecedorPlanilha,
  type EquipeDoc,
  type FornecedorLinha,
} from "../lib/conferencia-medicao";

function equipeDoc(overrides: Partial<EquipeDoc> = {}): EquipeDoc {
  return {
    id: "doc-1",
    numeroDocumento: "12345",
    formato: "PDF",
    equivalenteA1Horas: 10,
    percentualEmissao: 1,
    tipo2: "HH",
    ...overrides,
  };
}

function fornecedorLinha(overrides: Partial<FornecedorLinha> = {}): FornecedorLinha {
  return { nrVale: "12345", formato: "PDF", a1eqHh: 10, percentualEmissao: 1, tipo: "HH", ...overrides };
}

test("NR VALE igual e todos os campos batendo não gera divergência", () => {
  const result = compararDocumentos([equipeDoc()], [fornecedorLinha()]);
  assert.deepEqual(result, []);
});

test("NR VALE ausente na Equipe gera DOCUMENTO_NAO_MAPEADO", () => {
  const result = compararDocumentos([], [fornecedorLinha({ nrVale: "99999" })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].documentoNaoMapeado, true);
  assert.equal(result[0].idMedicaoExistente, null);
});

test("Formato divergente é detectado isoladamente", () => {
  const result = compararDocumentos([equipeDoc({ formato: "PDF" })], [fornecedorLinha({ formato: "JPG" })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].formatoDivergente, true);
  assert.equal(result[0].a1eqDivergente, false);
  assert.equal(result[0].emissaoDivergente, false);
  assert.equal(result[0].tipoDivergente, false);
});

test("A1eq/HH divergente é detectado isoladamente", () => {
  const result = compararDocumentos([equipeDoc({ equivalenteA1Horas: 10 })], [fornecedorLinha({ a1eqHh: 12 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].a1eqDivergente, true);
  assert.equal(result[0].formatoDivergente, false);
});

test("% Emissão divergente é detectado isoladamente", () => {
  const result = compararDocumentos([equipeDoc({ percentualEmissao: 0.8 })], [fornecedorLinha({ percentualEmissao: 1 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].emissaoDivergente, true);
  assert.equal(result[0].a1eqDivergente, false);
});

test("Tipo DG/DOC/HH divergente é detectado isoladamente", () => {
  const result = compararDocumentos([equipeDoc({ tipo2: "HH" })], [fornecedorLinha({ tipo: "DOC" })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].tipoDivergente, true);
  assert.equal(result[0].formatoDivergente, false);
});

test("múltiplos campos divergentes no mesmo NR VALE geram uma única divergência com todos os campos marcados", () => {
  const result = compararDocumentos(
    [equipeDoc({ equivalenteA1Horas: 10, percentualEmissao: 0.8 })],
    [fornecedorLinha({ a1eqHh: 12, percentualEmissao: 1 })],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].a1eqDivergente, true);
  assert.equal(result[0].emissaoDivergente, true);
  assert.equal(result[0].formatoDivergente, false);
  assert.equal(result[0].tipoDivergente, false);
});

test("NR VALE duplicado na planilha do fornecedor gera COMPARACAO_AMBIGUA e não mescla silenciosamente", () => {
  const result = compararDocumentos(
    [equipeDoc()],
    [fornecedorLinha({ a1eqHh: 10 }), fornecedorLinha({ a1eqHh: 20 })],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].comparacaoAmbigua, true);
  assert.equal(result[0].a1eqDivergente, false, "campos individuais não devem ser avaliados quando ambíguo");
});

test("percentual '100', '100%' e '1.00' são equivalentes e não geram falso positivo", () => {
  assert.equal(normalizePercentual("100"), 1);
  assert.equal(normalizePercentual("100%"), 1);
  assert.equal(normalizePercentual("1.00"), 1);
  assert.equal(normalizePercentual(100), 1);

  const result = compararDocumentos(
    [equipeDoc({ percentualEmissao: 1 })],
    [fornecedorLinha({ percentualEmissao: normalizePercentual("100%") })],
  );
  assert.deepEqual(result, []);
});

test("espaços e diferença de caixa em NR VALE/Formato/Tipo não geram falso positivo", () => {
  const result = compararDocumentos(
    [equipeDoc({ numeroDocumento: " 12345 ", formato: "pdf", tipo2: "hh" })],
    [fornecedorLinha({ nrVale: "12345", formato: "PDF", tipo: "HH" })],
  );
  assert.deepEqual(result, []);
});

test("parseFornecedorPlanilha rejeita quando falta coluna obrigatória", () => {
  const rows = [["NR VALE", "Formato", "A1eq/HH", "TIPO DG/DOC/HH"], ["1", "PDF", "10", "HH"]];
  const result = parseFornecedorPlanilha(rows);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.erro, /% Emissão/);
});

test("parseFornecedorPlanilha ignora linhas completamente vazias e lê linhas válidas", () => {
  const rows = [
    ["NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH"],
    ["12345", "PDF", "10", "100%", "HH"],
    ["", "", "", "", ""],
    ["67890", "JPG", "5", "80%", "DOC"],
  ];
  const result = parseFornecedorPlanilha(rows);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.linhas.length, 2);
});

test("parseFornecedorPlanilha rejeita planilha vazia", () => {
  const result = parseFornecedorPlanilha([]);
  assert.equal(result.ok, false);
});
