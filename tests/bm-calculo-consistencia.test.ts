import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import type { BmData } from "../components/boletim-medicao";
import { calcularBoletim, centavos, normalizeText, parseCurrencyNumber } from "../lib/boletim-calculo";

/**
 * REGRESSÃO DE EQUIVALÊNCIA DO CÁLCULO DO BM — gate de release.
 *
 * Fonte única: lib/boletim-calculo.ts (fórmula do editor Novo/Editar pagamento, que grava
 * mapaPagamentoItem.valor). Todas as telas recebem a MESMA entrada das APIs (documentos de
 * getDocumentosMedidos e condições fixas de rawPayload.condicoesFixas) e passam pela mesma função:
 *
 *  - Portal do Fornecedor ............ calcularBoletim (components/colaborador-app.tsx)
 *  - BM/PDF, ComposicaoBoletim (drawers
 *    de Histórico e Evidências) e
 *    detalhe do Financeiro ............ resumoBoletim → calcularBoletim (components/boletim-medicao.tsx)
 *  - Listas de Histórico/Evidências .. valor gravado (mapaPagamentoItem.valor)
 *  - Valor gravado ................... editor de pagamento → calcularBoletim
 *
 * TOTAL DA MEDIÇÃO = fixo + adicionais + documentos − descontos (= valor gravado);
 * TOTAL A PAGAR = TOTAL DA MEDIÇÃO + REV. Tudo comparado em centavos.
 */

// resumoBoletim é uma função pura, mas mora num .tsx de UI: só os módulos visuais que ele importa
// (botão e ícone de impressão) são trocados por um stub, para o Node não carregar HeroUI. A função
// testada é a original, sem cópia.
const STUB = path.join(__dirname, "fixtures", "ui-stub.ts");
const moduleInterno = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const resolverOriginal = moduleInterno._resolveFilename;
moduleInterno._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "@/components/ui" || request === "lucide-react") return STUB;
  return resolverOriginal.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resumoBoletim } = require("../components/boletim-medicao") as typeof import("../components/boletim-medicao");
moduleInterno._resolveFilename = resolverOriginal;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Linha = { tipo2: string | null; valor: number; projeto?: string; numero?: string; contrato?: string };
type Cenario = {
  id: string;
  valorFixo: string | null;
  adicionaisFixos: string | null;
  linhas: Linha[];
  rev?: number;
  /** Só para BM sem composição: valor digitado no pagamento. */
  valorDigitado?: number;
  esperado: { totalMedicao: number; totalAPagar: number };
};

function documentos(linhas: Linha[]): BmData["documentos"] {
  return linhas.map((l, i) => ({
    id: `doc-${i}`,
    projetoReferente: l.projeto ?? "SE-E2E",
    tituloPrimario: null,
    contrato: l.contrato ?? "CTO-A",
    dataCadastro: null,
    formato: "A1",
    quantidade: 1,
    equivalenteA1Horas: 1,
    medidoHoras: 0,
    valorMedicao: l.valor,
    valorUnitario: 0,
    valorTotal: 0,
    percentualEmissao: 1,
    numeroDocumento: l.numero ?? `VALE-${i}`,
    tipo2: l.tipo2,
    condicao: String(l.valor),
    precoUnitario: l.valor,
    valorMedido: l.valor,
    obs: null,
  }));
}

/** Valor que o editor grava (total da composição formatado; sem composição, o digitado) — pela mesma função. */
function valorGravadoPeloEditor(c: Cenario, docs: BmData["documentos"]) {
  const calculo = calcularBoletim({ documentos: docs, condicoesFixas: { valorFixo: c.valorFixo, adicionaisFixos: c.adicionaisFixos } });
  return calculo.semComposicao ? (c.valorDigitado ?? 0) : parseCurrencyNumber(brl.format(calculo.totalComposicaoBruto));
}

function avaliar(c: Cenario) {
  const docs = documentos(c.linhas);
  const condicoesFixas = { valorFixo: c.valorFixo, tipoContratacao: null, adicionaisFixos: c.adicionaisFixos, observacoesContrato: null };
  const gravado = valorGravadoPeloEditor(c, docs);
  const rev = c.rev ?? 0;
  const portal = calcularBoletim({ documentos: docs, condicoesFixas, valorInformado: gravado, rev });
  const interno = resumoBoletim({
    ciclo: "2612", revisaoNumero: 0, revisaoLabel: null, aprovadoAt: null,
    colaborador: { nome: "Fornecedor", cpf: null, cnpj: "11.222.333/0001-81", razaoSocial: null, funcao: null },
    contexto: null,
    pagamento: { ato: null, valor: gravado, rev, horas: 0, intrSossego: 0, salobo: 0, acg: 0, escadasAlumar: 0, razaoSocial: null, cpfCnpj: null, condicoesFixas },
    documentos: docs,
  });
  return {
    cenario: c.id,
    portal: centavos(portal.totalMedicao),
    historicoLista: centavos(gravado),
    historicoDrawer: centavos(interno.totalMedicao),  // ComposicaoBoletim
    evidenciasLista: centavos(gravado),
    evidenciasDrawer: centavos(interno.totalMedicao), // ComposicaoBoletim
    pdfComposicao: centavos(interno.totalCondicoesFixas + interno.totalDocumentos - interno.totalDescontos),
    pdfTotalMedicao: centavos(interno.totalMedicao),
    persistido: centavos(gravado),
    portalAPagar: centavos(portal.totalAPagar),
    pdfAPagar: centavos(interno.totalAPagar),
    financeiroAPagar: centavos(gravado + rev),       // components/financeiro/shared.ts: valorAPagar = valor + rev
    portalRev: centavos(portal.rev),
    pdfRev: centavos(interno.rev),
    quebraIgual: centavos(portal.totalCondicoesFixas) === centavos(interno.totalCondicoesFixas)
      && centavos(portal.totalDocumentos) === centavos(interno.totalDocumentos)
      && centavos(portal.totalDescontos) === centavos(interno.totalDescontos),
    semComposicao: portal.semComposicao,
    diferencaValorGravado: interno.diferencaValorGravado,
  };
}

const CENARIOS: Cenario[] = [
  { id: "1 normal", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DOC", valor: 500 }], esperado: { totalMedicao: 1500, totalAPagar: 1500 } },
  { id: "2 fixo", valorFixo: "R$ 2.000,00", adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }], esperado: { totalMedicao: 3000, totalAPagar: 3000 } },
  { id: "3 fixo + adicional", valorFixo: "R$ 2.000,00", adicionaisFixos: "R$ 300,00", linhas: [{ tipo2: "DG", valor: 1000 }], esperado: { totalMedicao: 3300, totalAPagar: 3300 } },
  { id: "3b só adicional", valorFixo: null, adicionaisFixos: "300", linhas: [{ tipo2: "DG", valor: 1000 }], esperado: { totalMedicao: 1300, totalAPagar: 1300 } },
  { id: "4 desconto pelo tipo", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DESCONTO", valor: -100 }], esperado: { totalMedicao: 900, totalAPagar: 900 } },
  { id: "5 desconto pelo projeto", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, projeto: "DESCONTO", valor: -100 }], esperado: { totalMedicao: 900, totalAPagar: 900 } },
  { id: "5b desconto pelo projeto (+)", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, projeto: "DESCONTO", valor: 100 }], esperado: { totalMedicao: 900, totalAPagar: 900 } },
  { id: "6 desconto pelo número", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, numero: "DESCONTO", valor: -100 }], esperado: { totalMedicao: 900, totalAPagar: 900 } },
  { id: "7 vários contratos", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000, contrato: "CTO-A" }, { tipo2: "DOC", valor: 500, contrato: "CTO-B" }, { tipo2: "HH", valor: 300, contrato: "CTO-A" }], esperado: { totalMedicao: 1800, totalAPagar: 1800 } },
  { id: "8 combinação", valorFixo: "2000", adicionaisFixos: "300", linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DOC", valor: 500 }, { tipo2: "DESCONTO", valor: -200 }], esperado: { totalMedicao: 3600, totalAPagar: 3600 } },
  { id: "9 documento sem tipo, sem fixo", valorFixo: null, adicionaisFixos: null, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, valor: 400 }], esperado: { totalMedicao: 1400, totalAPagar: 1400 } },
  { id: "10 REV", valorFixo: null, adicionaisFixos: null, rev: 250, linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DOC", valor: 500 }], esperado: { totalMedicao: 1500, totalAPagar: 1750 } },
  { id: "11 sem composição (valor digitado)", valorFixo: null, adicionaisFixos: null, linhas: [], valorDigitado: 777.77, esperado: { totalMedicao: 777.77, totalAPagar: 777.77 } },
];

test("matriz: TOTAL DA MEDIÇÃO idêntico em Portal, Histórico (lista/drawer), Evidências (lista/drawer), PDF e valor gravado", () => {
  const linhas = CENARIOS.map(avaliar);
  console.table(linhas.map((l) => ({
    cenario: l.cenario, portal: l.portal / 100, historico: l.historicoDrawer / 100, evidencias: l.evidenciasDrawer / 100,
    pdf: l.pdfTotalMedicao / 100, persistido: l.persistido / 100, rev: l.pdfRev / 100, aPagar: l.pdfAPagar / 100,
  })));
  for (const l of linhas) {
    const c = CENARIOS.find((x) => x.id === l.cenario)!;
    const esperado = centavos(c.esperado.totalMedicao);
    for (const ponto of ["portal", "historicoLista", "historicoDrawer", "evidenciasLista", "evidenciasDrawer", "pdfTotalMedicao", "persistido"] as const) {
      assert.equal(l[ponto], esperado, `${l.cenario}: ${ponto}`);
    }
    if (!l.semComposicao) assert.equal(l.pdfComposicao, esperado, `${l.cenario}: composição do PDF fecha no total`);
    assert.equal(l.quebraIgual, true, `${l.cenario}: mesma quebra (fixas/documentos/descontos)`);
    assert.equal(l.diferencaValorGravado, 0, `${l.cenario}: sem alerta de integridade`);
  }
});

test("REV separado: TOTAL A PAGAR = TOTAL DA MEDIÇÃO + REV em Portal, PDF e Financeiro", () => {
  for (const l of CENARIOS.map(avaliar)) {
    const c = CENARIOS.find((x) => x.id === l.cenario)!;
    assert.equal(l.portalAPagar, centavos(c.esperado.totalAPagar), `${l.cenario}: portal a pagar`);
    assert.equal(l.pdfAPagar, centavos(c.esperado.totalAPagar), `${l.cenario}: PDF a pagar`);
    assert.equal(l.financeiroAPagar, centavos(c.esperado.totalAPagar), `${l.cenario}: Financeiro a pagar`);
    assert.equal(l.portalRev, l.pdfRev, `${l.cenario}: REV`);
  }
  const rev = avaliar(CENARIOS.find((c) => c.id === "10 REV")!);
  assert.deepEqual([rev.pdfTotalMedicao, rev.pdfRev, rev.pdfAPagar], [150000, 25000, 175000]);
});

test("GATE: valor mostrado ao fornecedor antes de aprovar = TOTAL DA MEDIÇÃO do PDF depois da aprovação", () => {
  for (const l of CENARIOS.map(avaliar)) {
    assert.equal(l.portal, l.pdfTotalMedicao, `${l.cenario}: portal × PDF`);
    assert.equal(l.portalAPagar, l.pdfAPagar, `${l.cenario}: a pagar portal × PDF`);
  }
});

test("distribuição por contrato: a mesma no Portal e no PDF (cenário 7)", () => {
  const c = CENARIOS.find((x) => x.id === "7 vários contratos")!;
  const docs = documentos(c.linhas);
  const portal = calcularBoletim({ documentos: docs, condicoesFixas: null });
  const pdf = resumoBoletim({ ciclo: "2612", revisaoNumero: 0, revisaoLabel: null, aprovadoAt: null, colaborador: { nome: "F", cpf: null, cnpj: null, razaoSocial: null, funcao: null }, contexto: null, pagamento: null, documentos: docs });
  assert.deepEqual(portal.participacao.participacoes.map((p) => [p.nome, p.percentual]), pdf.participacao.participacoes.map((p) => [p.nome, p.percentual]));
  assert.deepEqual(portal.participacao.participacoes.map((p) => p.nome), ["CTO-A", "CTO-B"]);
});

test("integridade: valor gravado que não bate com a composição é sinalizado (não escondido)", () => {
  const docs = documentos([{ tipo2: "DG", valor: 1000 }]);
  const calculo = calcularBoletim({ documentos: docs, condicoesFixas: null, valorInformado: 1200 });
  assert.equal(calculo.totalMedicao, 1000);
  assert.equal(calculo.diferencaValorGravado, -200);
  assert.equal(calcularBoletim({ documentos: docs, condicoesFixas: null, valorInformado: 1000 }).diferencaValorGravado, 0);
});

type LinhaEditor = { tipo2: string; se: string; numeroDocumento: string; equivalenteA1Horas: string; percentualEmissao: string; condicao: string };

/** Fórmula do editor de pagamento ANTES da refatoração (components/pagamento-editor.tsx em b69b40d), congelada como referência. */
function editorAntes(docs: LinhaEditor[], valorFixo: string, adicionaisFixos: string) {
  const isDiscountDoc = (d: LinhaEditor) => normalizeText(d.tipo2) === "DESCONTO" || normalizeText(d.se) === "DESCONTO" || normalizeText(d.numeroDocumento) === "DESCONTO";
  const docValorMedido = (d: LinhaEditor) => isDiscountDoc(d)
    ? -Math.abs(parseCurrencyNumber(d.condicao))
    : (parseFloat(d.equivalenteA1Horas) || 0) * (parseFloat(d.condicao) || 0) * ((parseFloat(d.percentualEmissao) || 0) / 100);
  const documentosMedidos = docs.filter((d) => !isDiscountDoc(d));
  const descontos = docs.filter(isDiscountDoc);
  const totalDocsValorBruto = documentosMedidos.reduce((s, d) => s + docValorMedido(d), 0);
  const totalDescontos = descontos.reduce((s, d) => s + Math.abs(docValorMedido(d)), 0);
  const totalCondicoesFixas = parseCurrencyNumber(valorFixo) + parseCurrencyNumber(adicionaisFixos);
  const valorPrevistoBase = totalCondicoesFixas + totalDocsValorBruto;
  return { liquido: valorPrevistoBase - totalDescontos, usaLiquido: valorPrevistoBase > 0 || totalDescontos > 0, temProducao: totalDocsValorBruto > 0, docValorMedido };
}

test("editor: valor gravado idêntico em centavos antes × depois da refatoração (2.000 entradas aleatórias)", () => {
  let semente = 20261001;
  const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
  const escolha = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  for (let i = 0; i < 2000; i++) {
    const docs: LinhaEditor[] = Array.from({ length: Math.floor(rnd() * 6) }, () => {
      const desconto = rnd() < 0.25;
      const marca = escolha(["tipo2", "se", "numeroDocumento"] as const);
      return {
        tipo2: desconto && marca === "tipo2" ? "desconto" : escolha(["DG", "DOC", "HH", "MC", "", "0"]),
        se: desconto && marca === "se" ? " Desconto " : `SE-${i}`,
        numeroDocumento: desconto && marca === "numeroDocumento" ? "DESCONTO" : `VALE-${i}`,
        equivalenteA1Horas: (rnd() * 40).toFixed(rnd() < 0.5 ? 3 : 1),
        percentualEmissao: escolha(["100", "80", "50", "33.3", "0"]),
        condicao: desconto ? (rnd() * 900).toFixed(2) : (rnd() * 300).toFixed(escolha([0, 2, 3])),
      };
    });
    const valorFixo = rnd() < 0.5 ? "" : brl.format(Math.round(rnd() * 500000) / 100);
    const adicionais = rnd() < 0.7 ? "" : (rnd() * 800).toFixed(2);
    const antes = editorAntes(docs, valorFixo, adicionais);
    const depois = calcularBoletim({
      documentos: docs.map((d) => ({ tipo2: d.tipo2, projetoReferente: d.se, numeroDocumento: d.numeroDocumento, contrato: null, valorMedido: antes.docValorMedido(d) })),
      condicoesFixas: { valorFixo, adicionaisFixos: adicionais },
    });
    assert.equal(brl.format(depois.totalComposicaoBruto), brl.format(antes.liquido), `caso ${i}: valor gravado`);
    assert.equal(!depois.semComposicao, antes.usaLiquido, `caso ${i}: usa o total calculado`);
    assert.equal(depois.temProducao, antes.temProducao, `caso ${i}: condição CONDICIONAL_PRODUCAO`);
    if (antes.usaLiquido) {
      // O total exibido em todas as telas é exatamente o valor que o editor grava.
      assert.equal(centavos(depois.totalMedicao), centavos(parseCurrencyNumber(brl.format(antes.liquido))), `caso ${i}: total da medição × gravado`);
    }
  }
});
