import assert from "node:assert/strict";
import test from "node:test";
import {
  computarParticipacao,
  contratoKey,
  isContratoElegivel,
  isContratoInvalido,
  isDespesaOuMobilizacao,
  normalizeContratoNome,
} from "../lib/contratos";

test("contrato válido é elegível", () => {
  assert.equal(isContratoElegivel("Salobo"), true);
});

test("duplicado com case/espacos diferentes tem a mesma chave", () => {
  assert.equal(contratoKey(" Salobo "), contratoKey("SALOBO"));
  assert.equal(contratoKey("salobo"), contratoKey("SALOBO"));
});

test("#N/D é inválido, nunca vira contrato", () => {
  assert.equal(isContratoInvalido("#N/D"), true);
  assert.equal(isContratoElegivel("#N/D"), false);
});

test("#CALC! é inválido, nunca vira contrato", () => {
  assert.equal(isContratoInvalido("#CALC!"), true);
  assert.equal(isContratoElegivel("#CALC!"), false);
});

test("outros erros padrão do Excel são inválidos (#N/A, #REF!, #DIV/0!, #NULL!)", () => {
  for (const erro of ["#N/A", "#REF!", "#DIV/0!", "#NULL!", "#NUM!", "#NAME?"]) {
    assert.equal(isContratoInvalido(erro), true, `esperava ${erro} inválido`);
  }
});

test("valor vazio é inválido", () => {
  assert.equal(isContratoInvalido(""), true);
  assert.equal(isContratoInvalido(null), true);
  assert.equal(isContratoInvalido(undefined), true);
  assert.equal(isContratoInvalido("   "), true);
});

test("despesas são ignoradas (todos os prefixos e variantes com sufixo)", () => {
  assert.equal(isDespesaOuMobilizacao("DESPESA ALIMENTAÇÃO"), true);
  assert.equal(isDespesaOuMobilizacao("Despesa Alimentação - Salobo"), true);
  assert.equal(isDespesaOuMobilizacao("DESPESA HOSPEDAGEM JULHO"), true);
  assert.equal(isDespesaOuMobilizacao("despesa transporte - pa"), true);
  assert.equal(isDespesaOuMobilizacao("Desmobilização equipe"), true);
  assert.equal(isDespesaOuMobilizacao("Salobo"), false);
});

test("descoberta dinâmica: N contratos distintos, despesas e inválidos fora do numerador", () => {
  const resultado = computarParticipacao([
    { contrato: "Salobo", valorMedido: 100 },
    { contrato: "Salobo", valorMedido: 100 },
    { contrato: "ACG", valorMedido: 50 },
    { contrato: "Novo Contrato", valorMedido: 25 },
    { contrato: "DESPESA ALIMENTAÇÃO", valorMedido: 999 },
    { contrato: "#N/D", valorMedido: 999 },
  ]);
  const nomes = resultado.participacoes.map((p) => p.nome).sort();
  assert.deepEqual(nomes, ["ACG", "Novo Contrato", "Salobo"]);
  assert.equal(resultado.valorClassificado, 275);
  assert.equal(resultado.valorTotal, 275 + 999 + 999);
});

test("percentual usa valor medido, não contagem de linhas", () => {
  const resultado = computarParticipacao([
    { contrato: "Salobo", valorMedido: 500 },
    { contrato: "Salobo", valorMedido: 300 },
    { contrato: "ACG", valorMedido: 200 },
  ]);
  const salobo = resultado.participacoes.find((p) => p.key === contratoKey("Salobo"));
  const acg = resultado.participacoes.find((p) => p.key === contratoKey("ACG"));
  assert.equal(salobo?.percentual, 80);
  assert.equal(acg?.percentual, 20);
});

test("100% em um único contrato", () => {
  const resultado = computarParticipacao([{ contrato: "Salobo", valorMedido: 5000 }]);
  assert.equal(resultado.participacoes.length, 1);
  assert.equal(resultado.participacoes[0].percentual, 100);
});

test("dois contratos somam aproximadamente 100%", () => {
  const resultado = computarParticipacao([
    { contrato: "Salobo", valorMedido: 348 },
    { contrato: "Salobo", valorMedido: 348 },
    { contrato: "ACG", valorMedido: 304 },
  ]);
  const soma = resultado.participacoes.reduce((s, p) => s + p.percentual, 0);
  assert.ok(Math.abs(soma - 100) < 1e-9);
});

test("CTO inválido em linha não-despesa vira pendência e permanece no denominador (não infla os válidos para 100%)", () => {
  const resultado = computarParticipacao([
    { contrato: "Salobo", valorMedido: 100 },
    { contrato: "#N/D", valorMedido: 50 },
    { contrato: "", valorMedido: 25 },
  ]);
  assert.equal(resultado.documentosPendentes, 2);
  assert.equal(resultado.valorTotal, 175);
  assert.equal(resultado.valorClassificado, 100);
  assert.equal(resultado.valorNaoClassificado, 75);
  assert.ok(Math.abs(resultado.percentualNaoClassificado - (75 / 175) * 100) < 1e-9);
  assert.ok(Math.abs(resultado.participacoes[0].percentual - (100 / 175) * 100) < 1e-9);
  assert.notEqual(resultado.participacoes[0].percentual, 100);
});

test("despesa não conta como pendência, mas entra no valorTotal (Total Medido já existente no BM/Portal inclui despesa)", () => {
  const resultado = computarParticipacao([
    { contrato: "Salobo", valorMedido: 100 },
    { contrato: "DESPESA TRANSPORTE", valorMedido: 999 },
  ]);
  assert.equal(resultado.documentosPendentes, 0);
  assert.equal(resultado.valorTotal, 1099);
  assert.equal(resultado.valorClassificado, 100);
});

test("caso real ADILSON EVERALDO GAIO: 1 linha com CTO inválido não pode zerar nem normalizar para 100% os demais contratos", () => {
  const resultado = computarParticipacao([
    { contrato: "#N/A", valorMedido: 15120 },
    { contrato: "Salobo", valorMedido: 560 },
    { contrato: "Salobo", valorMedido: 560 },
    { contrato: "Salobo", valorMedido: 560 },
    { contrato: "Salobo", valorMedido: 210 },
  ]);
  assert.equal(resultado.valorTotal, 17010);
  assert.equal(resultado.valorClassificado, 1890);
  assert.equal(resultado.valorNaoClassificado, 15120);
  assert.equal(resultado.participacoes.length, 1);
  assert.equal(resultado.participacoes[0].nome, "Salobo");
  assert.ok(Math.abs(resultado.participacoes[0].percentual - 11.111111111111112) < 1e-9);
  assert.ok(Math.abs(resultado.percentualNaoClassificado - 88.88888888888889) < 1e-9);
  assert.equal(resultado.documentosPendentes, 1);
  // a linha #N/A não pode invalidar as linhas Salobo válidas
  assert.notEqual(resultado.participacoes[0].percentual, 100);
  assert.notEqual(resultado.participacoes[0].percentual, 0);
});

test("fornecedor 100% classificado não gera pendência", () => {
  const resultado = computarParticipacao([{ contrato: "Salobo", valorMedido: 5000 }]);
  assert.equal(resultado.documentosPendentes, 0);
  assert.equal(resultado.participacoes[0].percentual, 100);
  assert.equal(resultado.valorNaoClassificado, 0);
});

test("fornecedor parcialmente classificado: soma dos contratos conhecidos fica abaixo de 100% de propósito", () => {
  const resultado = computarParticipacao([
    { contrato: "Salobo", valorMedido: 1000 },
    { contrato: "ACG", valorMedido: 500 },
    { contrato: "#N/D", valorMedido: 500 },
  ]);
  const salobo = resultado.participacoes.find((p) => p.nome === "Salobo")!;
  const acg = resultado.participacoes.find((p) => p.nome === "ACG")!;
  assert.equal(salobo.percentual, 50);
  assert.equal(acg.percentual, 25);
  assert.equal(resultado.percentualNaoClassificado, 25);
  const somaConhecidos = salobo.percentual + acg.percentual;
  assert.ok(somaConhecidos < 100); // nunca normalizar para 100%
});

test("CNPJ compartilhado: dois fornecedores diferentes, contratos calculados isoladamente por conjunto de documentos", () => {
  const fornecedorA = computarParticipacao([
    { contrato: "Salobo", valorMedido: 1000 },
  ]);
  const fornecedorB = computarParticipacao([
    { contrato: "ACG", valorMedido: 300 },
    { contrato: "Salobo", valorMedido: 700 },
  ]);
  assert.equal(fornecedorA.participacoes.length, 1);
  assert.equal(fornecedorA.participacoes[0].percentual, 100);
  assert.equal(fornecedorB.participacoes.find((p) => p.nome === "ACG")?.percentual, 30);
  assert.equal(fornecedorB.participacoes.find((p) => p.nome === "Salobo")?.percentual, 70);
});

test("normalizeContratoNome preserva acentuação/caixa para exibição", () => {
  assert.equal(normalizeContratoNome("  Salobo  "), "Salobo");
  assert.equal(normalizeContratoNome("Intr.  Sossego"), "Intr. Sossego");
});
