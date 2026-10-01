import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { compararDocumentos } from "../lib/conferencia-medicao";
import {
  agruparPorDocumento,
  compararDivergencia,
  decisaoRegistrada,
  filtrarDocumentos,
  formatarEmissao,
  rotuloContagem,
  type DivergenciaDTO,
} from "../lib/divergencia-comparacao";

/**
 * Análise de divergências por DOCUMENTO (comparação campo a campo). Os valores são os snapshots
 * gravados no upload e "divergente" é a flag gravada pela comparação real (compararDocumentos) —
 * aqui a divergência é produzida pela própria função do upload, nunca montada à mão.
 */

function dtoDe(nrValeEquipe: string | null, equipe: { formato: string; a1: number; emissao: number; tipo: string } | null, fornecedor: { nrVale: string; formato: string; a1: number; emissao: number; tipo: string }, extra: Partial<DivergenciaDTO> = {}): DivergenciaDTO {
  const [c] = compararDocumentos(
    equipe ? [{ id: "med-1", numeroDocumento: nrValeEquipe, formato: equipe.formato, equivalenteA1Horas: equipe.a1, percentualEmissao: equipe.emissao, tipo2: equipe.tipo }] : [],
    [{ nrVale: fornecedor.nrVale, formato: fornecedor.formato, a1eqHh: fornecedor.a1, percentualEmissao: fornecedor.emissao, tipo: fornecedor.tipo }],
  );
  assert.ok(c, "a comparação real precisa gerar a divergência");
  return {
    id: extra.id ?? `div-${fornecedor.nrVale}`,
    nrVale: c.nrVale,
    idMedicaoExistente: c.idMedicaoExistente,
    documentoNaoMapeado: c.documentoNaoMapeado,
    comparacaoAmbigua: c.comparacaoAmbigua,
    formatoDivergente: c.formatoDivergente,
    a1eqDivergente: c.a1eqDivergente,
    emissaoDivergente: c.emissaoDivergente,
    tipoDivergente: c.tipoDivergente,
    equipe: { nrVale: c.idMedicaoExistente ? nrValeEquipe : null, formato: c.equipe?.formato ?? null, a1eqHh: c.equipe?.a1eqHh ?? null, percentualEmissao: c.equipe?.percentualEmissao ?? null, tipo: c.equipe?.tipo ?? null },
    fornecedor: { nrVale: c.nrVale, ...c.fornecedor },
    status: "PENDENTE",
    observacao: null,
    resolvidoPorNome: null,
    resolvidoEm: null,
    ...extra,
  };
}

// Caso real: Mascara_Conferencia_Medicao.xlsx (aba Documentos) — NR-TESTE · A1 · 1 · 100 · DOC; equipe com A1eq/HH = 2.
const NR_TESTE = () => dtoDe("NR-TESTE", { formato: "A1", a1: 2, emissao: 1, tipo: "DOC" }, { nrVale: "NR-TESTE", formato: "A1", a1: 1, emissao: 1, tipo: "DOC" });
const NR_002 = () => dtoDe("NR-002", { formato: "A3", a1: 2, emissao: 1, tipo: "DG" }, { nrVale: "NR-002", formato: "A1", a1: 1, emissao: 0.5, tipo: "DOC" });
const NR_NOVO = () => dtoDe(null, null, { nrVale: "NR-NOVO", formato: "A1", a1: 3, emissao: 1, tipo: "DOC" });

test("NR-TESTE: os 5 campos aparecem; só A1eq/HH é divergente (equipe 2 × fornecedor 1)", () => {
  const { tipo, campos, divergentes, resumo } = compararDivergencia(NR_TESTE());
  assert.equal(tipo, "CAMPOS");
  assert.deepEqual(campos.map((c) => [c.label, c.equipe, c.fornecedor, c.status]), [
    ["NR VALE", "NR-TESTE", "NR-TESTE", "IGUAL"],
    ["Formato", "A1", "A1", "IGUAL"],
    ["A1eq/HH", "2", "1", "DIVERGENTE"],
    ["% Emissão", "100%", "100%", "IGUAL"],
    ["Tipo", "DOC", "DOC", "IGUAL"],
  ]);
  assert.deepEqual(divergentes.map((c) => c.label), ["A1eq/HH"]);
  assert.equal(resumo, "A1eq/HH diverge: a equipe possui 2 e o fornecedor informou 1.");
  assert.equal(rotuloContagem(tipo, divergentes.length), "1 campo divergente");
});

test("vários campos no mesmo documento: um único item com Formato, A1eq/HH, % Emissão e Tipo destacados", () => {
  const { campos, divergentes, resumo } = compararDivergencia(NR_002());
  assert.deepEqual(divergentes.map((c) => c.label), ["Formato", "A1eq/HH", "% Emissão", "Tipo"]);
  assert.equal(campos.find((c) => c.chave === "nrVale")?.status, "IGUAL");
  assert.deepEqual(campos.find((c) => c.chave === "percentualEmissao"), { chave: "percentualEmissao", label: "% Emissão", equipe: "100%", fornecedor: "50%", status: "DIVERGENTE" });
  assert.equal(resumo, "4 campos divergem neste documento: Formato, A1eq/HH, % Emissão e Tipo.");
});

test("documento só do fornecedor: registro completo, lado da equipe 'Não existe', sem undefined", () => {
  const { tipo, campos, resumo, acoes } = compararDivergencia(NR_NOVO());
  assert.equal(tipo, "SO_FORNECEDOR");
  assert.ok(campos.every((c) => c.equipe === null && c.status === "AUSENTE_EQUIPE"));
  assert.deepEqual(campos.map((c) => c.fornecedor), ["NR-NOVO", "A1", "3", "100%", "DOC"]);
  assert.equal(resumo, "Documento informado pelo fornecedor e não localizado na medição da equipe.");
  assert.equal(acoes.fornecedor.label, "Incluir documento na medição");
  assert.equal(acoes.equipe.label, "Não incluir documento");
  assert.doesNotMatch(JSON.stringify(campos), /undefined/);
});

test("% Emissão: 100 na planilha (fração 1 no banco) aparece como 100%, sem mudar o valor comparado", () => {
  assert.equal(formatarEmissao(1), "100%");
  assert.equal(formatarEmissao(0.5), "50%");
  assert.equal(formatarEmissao(0.333), "33,3%");
  // NR VALE/formato/tipo em caixa diferente são iguais pela MESMA normalização do upload → nenhuma divergência.
  assert.equal(compararDocumentos([{ id: "m", numeroDocumento: "NR-X", formato: "A1", equivalenteA1Horas: 1.5, percentualEmissao: 1, tipo2: "DOC" }], [{ nrVale: "nr-x", formato: "a1", a1eqHh: 1.5, percentualEmissao: 1, tipo: "doc" }]).length, 0);
  // Valor numérico legível sem alteração: 1,5 continua 1,5.
  const { campos } = compararDivergencia(dtoDe("NR-Y", { formato: "A1", a1: 1.5, emissao: 1, tipo: "DOC" }, { nrVale: "NR-Y", formato: "A1", a1: 2.25, emissao: 1, tipo: "DOC" }));
  assert.deepEqual(campos.find((c) => c.chave === "a1eqHh"), { chave: "a1eqHh", label: "A1eq/HH", equipe: "1,5", fornecedor: "2,25", status: "DIVERGENTE" });
});

test("ações com a semântica real do backend: aceitar (incluir) atualiza só os campos divergentes; manter (descartar) exige motivo", () => {
  const { acoes } = compararDivergencia(NR_TESTE());
  assert.equal(acoes.fornecedor.acao, "incluir");
  assert.equal(acoes.fornecedor.label, "Aceitar dados do fornecedor");
  assert.equal(acoes.fornecedor.exigeObservacao, false);
  assert.match(acoes.fornecedor.consequencia, /A1eq\/HH de 2 para 1/);
  assert.equal(acoes.equipe.acao, "descartar");
  assert.equal(acoes.equipe.label, "Manter dados da equipe");
  assert.equal(acoes.equipe.exigeObservacao, true);
  assert.match(acoes.equipe.consequencia, /não é alterada \(A1eq\/HH = 2\)/);
  assert.match(acoes.equipe.consequencia, /Documentos não considerados/);
});

test("documento resolvido: decisão descrita pelo que a ação fez; responsável/data só se gravados", () => {
  const aceito = { ...NR_TESTE(), status: "INCLUIDA", observacao: "Conferido com o fornecedor", resolvidoPorNome: "Equipe", resolvidoEm: "2026-10-01T12:00:00.000Z" };
  assert.deepEqual(decisaoRegistrada(aceito), { acao: "incluir", label: "Aceitar dados do fornecedor" });
  assert.deepEqual(decisaoRegistrada({ ...NR_TESTE(), status: "DESCARTADA" }), { acao: "descartar", label: "Manter dados da equipe" });
  assert.deepEqual(decisaoRegistrada({ ...NR_NOVO(), status: "DESCARTADA" }), { acao: "descartar", label: "Não incluir documento" });
  assert.equal(decisaoRegistrada(NR_TESTE()), null);
});

test("agrupamento por documento: nada é escondido, pendentes primeiro; filtros e busca por NR VALE", () => {
  const resolvido = { ...NR_002(), status: "INCLUIDA" };
  const { documentos, total, pendentes, resolvidos } = agruparPorDocumento([resolvido, NR_TESTE(), NR_NOVO()]);
  assert.equal(total, 3);
  assert.deepEqual([pendentes, resolvidos], [2, 1]);
  assert.deepEqual(documentos.map((d) => d.nrVale), ["NR-TESTE", "NR-NOVO", "NR-002"]);
  assert.deepEqual(filtrarDocumentos(documentos, "pendentes", "").map((d) => d.nrVale), ["NR-TESTE", "NR-NOVO"]);
  assert.deepEqual(filtrarDocumentos(documentos, "resolvidos", "").map((d) => d.nrVale), ["NR-002"]);
  assert.deepEqual(filtrarDocumentos(documentos, "todos", " nr-te ").map((d) => d.nrVale), ["NR-TESTE"]);
});

test("NR VALE repetido no arquivo: campos não comparados, ação descrita sem prometer alteração", () => {
  const [c] = compararDocumentos(
    [{ id: "m", numeroDocumento: "NR-DUP", formato: "A1", equivalenteA1Horas: 1, percentualEmissao: 1, tipo2: "DOC" }],
    [{ nrVale: "NR-DUP", formato: "A1", a1eqHh: 1, percentualEmissao: 1, tipo: "DOC" }, { nrVale: "NR-DUP", formato: "A3", a1eqHh: 2, percentualEmissao: 1, tipo: "DG" }],
  );
  const d: DivergenciaDTO = { ...NR_TESTE(), nrVale: c.nrVale, comparacaoAmbigua: true, formatoDivergente: false, a1eqDivergente: false, emissaoDivergente: false, tipoDivergente: false, idMedicaoExistente: "m" };
  const r = compararDivergencia(d);
  assert.equal(r.tipo, "AMBIGUA");
  assert.ok(r.campos.slice(1).every((x) => x.status === "NAO_COMPARADO"));
  assert.equal(r.acoes.fornecedor.label, "Encerrar mantendo a medição");
});

test("tela: comparação acessível, sem window.confirm, ações e rotas de sempre", () => {
  const ui = fs.readFileSync(path.join(__dirname, "..", "components", "divergencias", "divergencias-medicao.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "..", "components", "pagamento-editor.tsx"), "utf8");
  assert.match(ui, /role="alertdialog"/);
  assert.match(ui, /aria-expanded=\{aberto\}/);
  assert.match(ui, /htmlFor=\{campoObsId\}/);
  assert.match(ui, /Observação da análise/);
  assert.doesNotMatch(ui + editor, /window\.(confirm|alert)/);
  assert.match(editor, /fetch\(`\/api\/admin\/conferencia\/\$\{id\}\/\$\{acao\}`/);
});
