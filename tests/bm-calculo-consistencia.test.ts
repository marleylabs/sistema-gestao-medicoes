import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import type { BmData } from "../components/boletim-medicao";
import { composicaoPortal, type PortalDocumento } from "../lib/portal-fornecedor";

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

/**
 * MATRIZ DE CONSISTÊNCIA DO CÁLCULO DO BM — teste de CARACTERIZAÇÃO (não corrige nada).
 *
 * As duas APIs entregam a MESMA entrada às duas fórmulas (GET /api/colaborador/me → Portal;
 * GET /api/admin/bm e /api/colaborador/medicoes → resumoBoletim): mesmos documentos
 * (getDocumentosMedidos, valorMedido = A1eq × preço × %emissão) e mesmas condições fixas
 * (mapaPagamentoItem.rawPayload.condicoesFixas). Por isso a comparação pode ser feita aqui, em
 * centavos, sobre a mesma entrada:
 *
 *  - PORTAL      = composicaoPortal (lib/portal-fornecedor.ts) — também é a fórmula do editor de
 *                  pagamento (components/pagamento-editor.tsx) que GRAVA mapaPagamentoItem.valor.
 *  - INTERNO     = resumoBoletim (components/boletim-medicao.tsx) — BM/PDF, ComposicaoBoletim
 *                  (drawers de Histórico e Evidências) e detalhe do Financeiro.
 *  - PERSISTIDO  = mapaPagamentoItem.valor (+ rev = "a pagar" do Financeiro e "TOTAL DA MEDIÇÃO"
 *                  do PDF). Listas de Histórico/Evidências/Dashboard mostram esse valor.
 *
 * Os valores esperados abaixo são os de HOJE. Uma divergência registrada aqui é um achado a
 * decidir (fonte de verdade), não um comportamento aprovado; se a regra mudar, este teste precisa
 * ser atualizado junto, de propósito.
 */

type Linha = { tipo2: string | null; valor: number; projeto?: string; numero?: string; contrato?: string };
type Cenario = {
  id: string;
  descricao: string;
  valorFixo: string | null;
  adicionaisFixos: string | null;
  linhas: Linha[];
  rev?: number;
  /** Como o editor de pagamento grava mapaPagamentoItem.valor para esta entrada. */
  persistidoEditor: number;
};

const centavos = (v: number) => Math.round(v * 100);

function documentos(linhas: Linha[]): Array<PortalDocumento & BmData["documentos"][number]> {
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

function bmInterno(c: Cenario, docs: ReturnType<typeof documentos>): BmData {
  return {
    ciclo: "2612",
    revisaoNumero: 0,
    revisaoLabel: null,
    aprovadoAt: null,
    colaborador: { nome: "Fornecedor", cpf: null, cnpj: "11.222.333/0001-81", razaoSocial: null, funcao: null },
    contexto: null,
    pagamento: {
      ato: null, valor: c.persistidoEditor, rev: c.rev ?? 0, horas: 0,
      intrSossego: 0, salobo: 0, acg: 0, escadasAlumar: 0, razaoSocial: null, cpfCnpj: null,
      condicoesFixas: { valorFixo: c.valorFixo, tipoContratacao: null, adicionaisFixos: c.adicionaisFixos, observacoesContrato: null },
    },
    documentos: docs,
  };
}

function comparar(c: Cenario) {
  const docs = documentos(c.linhas);
  const portal = composicaoPortal(docs, { valorFixo: c.valorFixo, adicionaisFixos: c.adicionaisFixos, tipoContratacao: null, observacoesContrato: null });
  const interno = resumoBoletim(bmInterno(c, docs));
  const totalInternoExibido = interno.totalMedidoLiquido || interno.totalMedicao; // ComposicaoBoletim, Financeiro, linha final do PDF
  return {
    cenario: c.id,
    portalPagamentoPrevisto: centavos(c.persistidoEditor),
    portalTotalLiquido: centavos(portal.totalLiquido),
    internoTotalLiquido: centavos(totalInternoExibido),
    pdfTotalDaMedicao: centavos(interno.totalMedicao), // valor + rev
    persistido: centavos(c.persistidoEditor),
    portalFixas: centavos(portal.totalCondicoesFixas),
    internoFixas: centavos(interno.ccFixoClt + interno.ccFixoPj),
    portalDocs: centavos(portal.totalDocumentos),
    internoDocs: centavos(interno.totalDocumentosMedidos),
    portalDescontos: centavos(portal.totalDescontos),
    internoDescontos: centavos(interno.ccDescontos),
  };
}

const CENARIOS: Cenario[] = [
  { id: "1 normal", descricao: "produção sem fixo/adicional/desconto", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DOC", valor: 500 }], persistidoEditor: 1500 },
  { id: "2 fixo", descricao: "condição fixa + produção", valorFixo: "R$ 2.000,00", adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }], persistidoEditor: 3000 },
  { id: "3 adicional", descricao: "condição fixa + adicional fixo + produção", valorFixo: "R$ 2.000,00", adicionaisFixos: "R$ 300,00",
    linhas: [{ tipo2: "DG", valor: 1000 }], persistidoEditor: 3300 },
  { id: "3b adicional sem fixo", descricao: "só adicional fixo + produção", valorFixo: null, adicionaisFixos: "300",
    linhas: [{ tipo2: "DG", valor: 1000 }], persistidoEditor: 1300 },
  { id: "4 desconto tipo2", descricao: "desconto marcado em tipo2", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DESCONTO", valor: -100 }], persistidoEditor: 900 },
  { id: "5 desconto projeto", descricao: "desconto só pelo projeto (valor negativo)", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, projeto: "DESCONTO", valor: -100 }], persistidoEditor: 900 },
  { id: "5b desconto projeto (+)", descricao: "desconto só pelo projeto gravado com sinal POSITIVO", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, projeto: "DESCONTO", valor: 100 }], persistidoEditor: 900 },
  { id: "6 desconto número", descricao: "desconto só pelo número do documento (valor negativo)", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, numero: "DESCONTO", valor: -100 }], persistidoEditor: 900 },
  { id: "7 contratos", descricao: "múltiplos contratos", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000, contrato: "CTO-A" }, { tipo2: "DOC", valor: 500, contrato: "CTO-B" }, { tipo2: "HH", valor: 300, contrato: "CTO-A" }], persistidoEditor: 1800 },
  { id: "8 combinação", descricao: "fixo + adicional + produção + desconto", valorFixo: "2000", adicionaisFixos: "300",
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DOC", valor: 500 }, { tipo2: "DESCONTO", valor: -200 }], persistidoEditor: 3600 },
  { id: "9 tipo2 vazio", descricao: "documento sem tipo2 (fora de DG/DOC/HH/MC), sem fixo", valorFixo: null, adicionaisFixos: null,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: null, valor: 400 }], persistidoEditor: 1400 },
  { id: "10 rev", descricao: "pagamento com REV ≠ 0", valorFixo: null, adicionaisFixos: null, rev: 250,
    linhas: [{ tipo2: "DG", valor: 1000 }, { tipo2: "DOC", valor: 500 }], persistidoEditor: 1500 },
];

// Resultado observado hoje, em centavos: [portal total líquido, interno total líquido, PDF "TOTAL DA MEDIÇÃO"].
const ESPERADO: Record<string, [number, number, number]> = {
  "1 normal": [150000, 150000, 150000],
  "2 fixo": [300000, 300000, 300000],
  "3 adicional": [330000, 300000, 330000],          // interno ignora adicionaisFixos
  "3b adicional sem fixo": [130000, 130000, 130000], // igual por coincidência: o fallback do interno "absorve" o adicional
  "4 desconto tipo2": [90000, 90000, 90000],
  "5 desconto projeto": [90000, 90000, 90000],      // mesmo total; quebra visual diferente (desconto vira documento negativo)
  "5b desconto projeto (+)": [90000, 110000, 90000], // interno SOMA o "desconto" positivo
  "6 desconto número": [90000, 90000, 90000],       // mesmo total; quebra visual diferente
  "7 contratos": [180000, 180000, 180000],
  "8 combinação": [360000, 330000, 360000],         // interno ignora adicionaisFixos
  "9 tipo2 vazio": [140000, 180000, 140000],        // fallback do interno trata o doc sem tipo2 como condição fixa (conta 2x)
  "10 rev": [150000, 150000, 175000],               // PDF/Financeiro somam rev; portal mostra rev separado
};

test("matriz: Portal × BM interno (PDF/Histórico/Evidências/Financeiro) × persistido, em centavos", () => {
  const linhas = CENARIOS.map(comparar);
  console.table(linhas.map((l) => ({
    cenario: l.cenario,
    portal: l.portalTotalLiquido / 100,
    interno: l.internoTotalLiquido / 100,
    pdfTotalMedicao: l.pdfTotalDaMedicao / 100,
    persistido: l.persistido / 100,
    iguais: l.portalTotalLiquido === l.internoTotalLiquido && l.portalTotalLiquido === l.persistido && l.pdfTotalDaMedicao === l.persistido,
  })));
  for (const l of linhas) {
    assert.deepEqual([l.portalTotalLiquido, l.internoTotalLiquido, l.pdfTotalDaMedicao], ESPERADO[l.cenario], l.cenario);
    // O total do portal é sempre o valor que o editor grava (mesma fórmula).
    assert.equal(l.portalTotalLiquido, l.persistido, `${l.cenario}: portal × persistido`);
  }
});

test("quebra visual: desconto só por projeto/número aparece como documento negativo no interno", () => {
  for (const id of ["5 desconto projeto", "6 desconto número"]) {
    const l = comparar(CENARIOS.find((c) => c.id === id)!);
    assert.deepEqual([l.portalDocs, l.portalDescontos], [100000, 10000], id);
    assert.deepEqual([l.internoDocs, l.internoDescontos], [90000, 0], id);
  }
});

test("distribuição por contrato: mesma participação nos dois cálculos (cenário 7)", async () => {
  const { computarParticipacao } = await import("../lib/contratos");
  const docs = documentos(CENARIOS.find((c) => c.id === "7 contratos")!.linhas);
  const portal = computarParticipacao(composicaoPortal(docs, null).documentosMedidos.map((d) => ({ contrato: d.contrato, valorMedido: d.valorMedido })));
  const interno = computarParticipacao(resumoBoletim(bmInterno(CENARIOS.find((c) => c.id === "7 contratos")!, docs)).documentosProdutivos.map((d) => ({ contrato: d.contrato, valorMedido: d.valorMedido })));
  assert.deepEqual(portal.participacoes.map((p) => [p.nome, p.percentual]), interno.participacoes.map((p) => [p.nome, p.percentual]));
});
