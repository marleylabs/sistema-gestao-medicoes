import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  eventosMedicao,
  filtrarMedicoes,
  proximoPasso,
  resumoPorStatus,
  ultimaAtualizacao,
  valoresMedicao,
  type MedicaoFornecedor,
} from "../lib/minhas-medicoes";

/**
 * "Minhas Medições" (Portal do Fornecedor): valores pelo cálculo canônico, status pelos rótulos
 * do portal, ordem do backend preservada e nenhuma data/etapa inventada.
 */

function medicao(overrides: Partial<MedicaoFornecedor> = {}): MedicaoFornecedor {
  return {
    id: overrides.id ?? "m1",
    ciclo: "2608",
    status: "APROVADO",
    revisaoLabel: null,
    aprovadoAt: "2026-08-13T12:00:00.000Z",
    nfArquivoNome: "nf.pdf",
    nfCarregadoAt: "2026-08-14T12:00:00.000Z",
    comprovanteArquivoNome: null,
    comprovanteCarregadoAt: null,
    pagamento: { valor: 1500, rev: 0, condicoesFixas: null },
    documentos: [
      { tipo2: "DG", projetoReferente: "SE-1", numeroDocumento: "V-1", contrato: "CTO-A", valorMedido: 1000 },
      { tipo2: "DOC", projetoReferente: "SE-1", numeroDocumento: "V-2", contrato: "CTO-A", valorMedido: 500 },
    ],
    ...overrides,
  };
}

const fonte = (arquivo: string) => fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8");

test("valores: TOTAL DA MEDIÇÃO 1.500 + REV 250 = TOTAL A PAGAR 1.750 (cálculo canônico)", () => {
  const v = valoresMedicao(medicao({ pagamento: { valor: 1500, rev: 250, condicoesFixas: null } }));
  assert.deepEqual([v.totalMedicao, v.rev, v.totalAPagar], [1500, 250, 1750]);
  const semRev = valoresMedicao(medicao());
  assert.deepEqual([semRev.totalMedicao, semRev.rev, semRev.totalAPagar], [1500, 0, 1500]);
});

test("lista vazia, uma e várias medições: resumo pelos status reais com os rótulos do portal", () => {
  assert.deepEqual(resumoPorStatus([]).map((r) => r.total), [0, 0, 0]);
  const lista = [medicao({ id: "a", status: "AGUARDANDO_NF" }), medicao({ id: "b", status: "APROVADO" }), medicao({ id: "c", status: "PAGO" }), medicao({ id: "d", status: "PAGO" })];
  assert.deepEqual(resumoPorStatus(lista).map((r) => [r.label, r.total]), [["Aguardando envio da NF", 1], ["Aguardando pagamento", 1], ["Medição concluída", 2]]);
  assert.deepEqual(resumoPorStatus([medicao()]).map((r) => r.total), [0, 1, 0]);
});

test("ordem do backend (aprovação mais recente primeiro) é preservada por filtro e busca", () => {
  const lista = [medicao({ id: "novo", ciclo: "2610" }), medicao({ id: "meio", ciclo: "2608", status: "PAGO" }), medicao({ id: "velho", ciclo: "2612" })];
  assert.deepEqual(filtrarMedicoes(lista, "todos", "").map((m) => m.id), ["novo", "meio", "velho"]);
  assert.deepEqual(filtrarMedicoes(lista, "APROVADO", "").map((m) => m.id), ["novo", "velho"]);
  assert.deepEqual(filtrarMedicoes(lista, "PAGO", "").map((m) => m.id), ["meio"]);
});

test("busca por ciclo e por competência (formatCicloLabel), sem acento/caixa", () => {
  const lista = [medicao({ id: "ago", ciclo: "2608" }), medicao({ id: "dez", ciclo: "2612" })];
  assert.deepEqual(filtrarMedicoes(lista, "todos", "2612").map((m) => m.id), ["dez"]);
  assert.deepEqual(filtrarMedicoes(lista, "todos", "ago").map((m) => m.id), ["ago"]);
  assert.deepEqual(filtrarMedicoes(lista, "todos", "inexistente"), []);
});

test("andamento só com datas gravadas: nada inventado a partir do status", () => {
  assert.deepEqual(eventosMedicao(medicao({ status: "AGUARDANDO_NF", nfArquivoNome: null, nfCarregadoAt: null })).map((e) => [e.titulo, e.data]), [
    ["Boletim aprovado", "2026-08-13T12:00:00.000Z"],
    ["Aguardando nota fiscal", null],
  ]);
  const pago = eventosMedicao(medicao({ status: "PAGO", comprovanteArquivoNome: "c.pdf", comprovanteCarregadoAt: "2026-08-20T12:00:00.000Z" }));
  assert.deepEqual(pago.map((e) => e.titulo), ["Boletim aprovado", "Nota fiscal recebida", "Comprovante de pagamento disponível", "Pagamento concluído"]);
  assert.equal(pago.at(-1)?.data, null, "data de pagamento não vem na API: não é inventada");
  assert.deepEqual(eventosMedicao(medicao({ aprovadoAt: null, nfCarregadoAt: null })).map((e) => e.titulo), ["Aguardando pagamento"]);
});

test("última atualização = data gravada mais recente; próximo passo pelo status real", () => {
  assert.equal(ultimaAtualizacao(medicao()), "2026-08-14T12:00:00.000Z");
  assert.equal(ultimaAtualizacao(medicao({ aprovadoAt: null, nfCarregadoAt: null })), null);
  assert.equal(proximoPasso("AGUARDANDO_NF"), "Seu boletim foi aprovado. Envie a nota fiscal para continuar.");
  assert.equal(proximoPasso("APROVADO"), "Nota fiscal recebida. A medição está aguardando o pagamento.");
  assert.equal(proximoPasso("PAGO"), "Pagamento concluído.");
  assert.equal(proximoPasso("PENDENTE"), null);
});

test("tela: valores canônicos com rótulos certos, estados de vazio/erro/carregando e BM pelo BoletimMedicao", () => {
  const ui = fonte("components/minhas-medicoes.tsx");
  assert.match(ui, /valoresMedicao\(/);
  assert.doesNotMatch(ui, /\.reduce\(|valor \+ .*rev|\.valor \?\? 0\) \+/, "nenhum cálculo paralelo");
  assert.match(ui, /Total a pagar<\/p>\s*<p[^>]*data-testid="minhas-medicoes-total-pagar">\{brl\.format\(v\.totalAPagar\)\}/);
  assert.match(ui, /Total da medição<\/dt><dd[^>]*data-testid="minhas-medicoes-total-medicao">\{brl\.format\(v\.totalMedicao\)\}/);
  assert.match(ui, /v\.rev !== 0 &&/, "REV só aparece quando diferente de zero");
  assert.match(ui, /<PortalStatusBadge status=/);
  assert.match(ui, /Você ainda não possui medições disponíveis\./);
  assert.match(ui, /Nenhuma medição encontrada com estes filtros\./);
  assert.match(ui, /Não foi possível carregar suas medições\./);
  assert.match(ui, /Tentar novamente/);
  assert.match(ui, /aria-busy="true"/);
  assert.match(ui, /<BoletimMedicao data=\{m\} \/>/);
  assert.match(ui, /onKeyDown=\{\(e\) => \{ if \(e\.key === "Enter" \|\| e\.key === " "\)/, "linha acessível por teclado");
  const app = fonte("components/colaborador-app.tsx");
  assert.match(app, /setMedErro\("Não foi possível carregar suas medições\."\)/, "sem loading infinito em falha");
  assert.doesNotMatch(app, /function MedicaoAprovadaCard/);
});
