import assert from "node:assert/strict";
import test from "node:test";
import {
  computarParticipacao,
  consolidarDistribuicaoContratos,
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

// ─── Distribuição por contrato (Dashboard) — mesma fórmula de Pagamentos por Fornecedor ───

test("distribuição — teste 1: fornecedor 100% em um contrato", () => {
  const r = consolidarDistribuicaoContratos([
    { valorBase: 10000, participacoes: { salobo: 100 } },
  ]);
  assert.equal(r.valorPorContratoId.salobo, 10000);
  assert.equal(r.valorTotalConsiderado, 10000);
  assert.equal(r.valorNaoClassificado, 0);
});

test("distribuição — teste 2: fornecedor dividido entre dois contratos", () => {
  const r = consolidarDistribuicaoContratos([
    { valorBase: 10000, participacoes: { eng: 28.9, salobo: 71.1 } },
  ]);
  assert.ok(Math.abs(r.valorPorContratoId.eng - 2890) < 1e-9);
  assert.ok(Math.abs(r.valorPorContratoId.salobo - 7110) < 1e-9);
});

test("distribuição — teste 3: múltiplos fornecedores consolidados e participação global", () => {
  const r = consolidarDistribuicaoContratos([
    { valorBase: 10000, participacoes: { salobo: 100 } },
    { valorBase: 5000, participacoes: { salobo: 50, acg: 50 } },
  ]);
  assert.equal(r.valorPorContratoId.salobo, 12500);
  assert.equal(r.valorPorContratoId.acg, 2500);
  assert.equal(r.valorTotalConsiderado, 15000);
  const pctSalobo = (r.valorPorContratoId.salobo / r.valorTotalConsiderado) * 100;
  const pctAcg = (r.valorPorContratoId.acg / r.valorTotalConsiderado) * 100;
  assert.ok(Math.abs(pctSalobo - 83.33333333333333) < 1e-9);
  assert.ok(Math.abs(pctAcg - 16.666666666666664) < 1e-9);
});

test("distribuição — teste 4: fornecedor parcialmente não classificado não vira 100% no contrato conhecido", () => {
  const r = consolidarDistribuicaoContratos([
    { valorBase: 10000, participacoes: { salobo: 50 } }, // restante 50% já veio sem contrato (fora de "participacoes")
  ]);
  assert.equal(r.valorPorContratoId.salobo, 5000);
  assert.equal(r.valorNaoClassificado, 5000);
  assert.notEqual(r.valorPorContratoId.salobo, 10000);
});

test("distribuição — fornecedor sem nenhuma participação (sem Documentos Medidos) cai 100% em não classificado", () => {
  const r = consolidarDistribuicaoContratos([
    { valorBase: 8000, participacoes: {} },
  ]);
  assert.equal(r.valorTotalConsiderado, 8000);
  assert.equal(r.valorClassificado, 0);
  assert.equal(r.valorNaoClassificado, 8000);
});

test("distribuição — nunca normaliza para 100%: soma dos contratos pode ficar bem abaixo do total", () => {
  const r = consolidarDistribuicaoContratos([
    { valorBase: 500000, participacoes: { eng: 20, salobo: 50, acg: 10 } }, // 20% do próprio fornecedor já pendente
  ]);
  const somaContratos = Object.values(r.valorPorContratoId).reduce((s, v) => s + v, 0);
  assert.ok(somaContratos < r.valorTotalConsiderado);
  assert.ok(Math.abs(r.valorTotalConsiderado - (somaContratos + r.valorNaoClassificado)) < 1e-9);
});

test("distribuição — CNPJ compartilhado: dois fornecedores diferentes contribuem isoladamente, nunca consolidados por CNPJ", () => {
  // Fornecedor A (código A, CNPJ X) e Fornecedor B (código B, mesmo CNPJ X) chegam como entradas
  // separadas em `fornecedores` (uma por colaborador_codigo) — a função nunca olha para CNPJ.
  const r = consolidarDistribuicaoContratos([
    { valorBase: 1000, participacoes: { salobo: 100 } }, // Fornecedor A
    { valorBase: 2000, participacoes: { acg: 100 } },    // Fornecedor B, mesmo CNPJ de A
  ]);
  assert.equal(r.valorPorContratoId.salobo, 1000);
  assert.equal(r.valorPorContratoId.acg, 2000);
  assert.equal(r.valorTotalConsiderado, 3000); // nunca um fornecedor único de 3.000
});
