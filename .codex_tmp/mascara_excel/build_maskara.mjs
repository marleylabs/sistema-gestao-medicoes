import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.join(repoRoot, "outputs", "mascara-medicoes");
const outputPath = path.join(outputDir, "Mascara_Importacao_Medicoes.xlsx");

const COLORS = {
  primary: "#AF1B1B",
  secondary: "#8C1616",
  background: "#F5F5F5",
  text: "#1A1A1A",
  muted: "#6B7280",
  header: "#F3F4F6",
  border: "#D9DEE8",
  input: "#FFF7ED",
  locked: "#F9FAFB",
  ok: "#DCFCE7",
  warn: "#FEF3C7",
};

function colName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function padRows(rows, width, targetRows) {
  const out = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill(null)]);
  while (out.length < targetRows) out.push(Array(width).fill(null));
  return out;
}

function styleTitle(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.format = {
    fill: COLORS.primary,
    font: { bold: true, color: "#FFFFFF", size: 14 },
    horizontalAlignment: "left",
    verticalAlignment: "middle",
  };
  range.format.rowHeight = 28;
}

function styleHeader(range) {
  range.format = {
    fill: COLORS.header,
    font: { bold: true, color: COLORS.text },
    borders: { preset: "all", style: "thin", color: COLORS.border },
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "middle",
  };
  range.format.rowHeight = 32;
}

function styleInputArea(range) {
  range.format = {
    fill: "#FFFFFF",
    font: { color: COLORS.text },
    borders: {
      insideHorizontal: { style: "thin", color: "#E5E7EB" },
      insideVertical: { style: "thin", color: "#EEF2F7" },
    },
    verticalAlignment: "middle",
  };
}

function applyList(sheet, range, values) {
  sheet.dataValidations.add({
    range,
    rule: { type: "list", values },
  });
}

const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "Anderson Marley" });

const instrucoes = workbook.worksheets.add("Instruções");
const geral = workbook.worksheets.add("Geral");
const base = workbook.worksheets.add("BASE");
const mapa = workbook.worksheets.add("MAPA PAGTO");
const listas = workbook.worksheets.add("Listas");

for (const sheet of [instrucoes, geral, base, mapa, listas]) {
  sheet.showGridLines = false;
}

// Instruções
instrucoes.getRange("A1:H1").merge();
instrucoes.getRange("A1").values = [["Máscara de Importação - Medições e Pagamentos"]];
styleTitle(instrucoes, "A1:H1");
instrucoes.getRange("A3:H12").values = [
  ["Objetivo", "Preencher esta máscara para atualizar a aplicação via Importar Planilha.", null, null, null, null, null, null],
  ["Fluxo", "1. Preencha BASE com os dados dos colaboradores. 2. Preencha Geral com todas as medições. 3. Preencha MAPA PAGTO com pagamentos por contrato. A aba BM AUX não é mais utilizada.", null, null, null, null, null, null],
  ["Aba Geral", "A coluna Número da Medição deve iniciar com BM. Projeto Referente e PROJETISTA são obrigatórios para a linha ser importada.", null, null, null, null, null, null],
  ["Aba BASE", "A coluna Codigo é a chave do colaborador e deve bater com PROJETISTA nas demais abas.", null, null, null, null, null, null],
  ["Aba MAPA PAGTO", "Mantenha a tabela chamada Tabela5. A coluna ATO define atuação: PRODUÇÃO mantém produção; qualquer outro valor com VALOR maior que zero vira ATO.", null, null, null, null, null, null],
  ["Contratos", "Preencha percentuais nas colunas Intr. Sossego, Salobo, ACG e Escadas Alumar. Use 100% como 100%, não como texto.", null, null, null, null, null, null],
  ["Datas", "Use datas reais do Excel. Exemplo: 21/04/2026.", null, null, null, null, null, null],
  ["Valores", "Digite números, sem R$ como texto. A formatação visual já exibe moeda.", null, null, null, null, null, null],
  ["Importante", "Não altere nomes das abas e cabeçalhos. Não exclua a tabela Tabela5.", null, null, null, null, null, null],
  ["Ciclo", "Se deixar o ciclo em branco na aplicação, o sistema deriva pelo texto em MAPA PAGTO!H1, por exemplo: Maio de 2026 => 2605.", null, null, null, null, null, null],
];
instrucoes.getRange("A3:A12").format = { fill: COLORS.header, font: { bold: true, color: COLORS.text } };
instrucoes.getRange("B3:H12").format = { fill: "#FFFFFF", font: { color: COLORS.text }, wrapText: true };
instrucoes.getRange("A3:H12").format.borders = { preset: "all", style: "thin", color: COLORS.border };
instrucoes.getRange("A:A").format.columnWidth = 18;
instrucoes.getRange("B:H").format.columnWidth = 22;

// Geral
const geralHeaders = [
  "Número da Medição", "Projeto Referente", "Título Primário", "Centro de Custo", "Coordenador", "Mesclado",
  "Número do Documento", "Evidência", "Data de Cadastro", "Coluna1", "Formato", "Quantidade", "Multiplicador",
  "Equivalente (A1 ou Horas)", "Porcentagem de Revisão", "Emissão Inicial", "Retorno Vale", "Encerramento",
  "Arquivamento", "Medido (Horas)", "Item da QQP", "Valor Unitário", "Valor Bruto", "Valor Total", "Coluna12",
  "Coluna2", "Coluna3", "OBS", "FUNÇÃO", "Localização.1", "Valor do Reajuste", "CICLO", "PROJETISTA",
  "REFERÊNCIA", "% EMISSÃO", "CONTRATO", "TIPO2", "CONDIÇÃO", "VALOR DE MEDIÇÃO",
];
const geralSamples = [
  ["BM17", "ORC-MANU-202501-2406", "FORNECIMENTO DE MAO DE OBRA ATO", "CC1370136", "MARCO LEITE", "MARCO LEITE", "ALEXANDRE BORGES", "ALEXANDRE BORGES", new Date(2026, 4, 20), null, "HH", 160, 1, 160, 1, 0.8, null, null, 0.2, 160, 8, 148.95, 23832.17, 23832.17, null, null, null, null, "ANALISTA SÊNIOR", "MARABÁ - PA", 0, "2605", "ALEXANDRE BORGES", "A", 1, "Salobo", "HH", 90, 14400],
  ["BM17", "ORC-SLBO-202503-2446", "ATO - GESTÃO DE ATIVOS_Rev_1", "1370058", "MARCO LEITE", "MARCO LEITE", "JOAO QUARESMA", "JOAO QUARESMA", new Date(2026, 4, 20), null, "HH", 176.4, 1, 176.4, 1, 0.8, null, null, 0.2, 176.4, 3, 178.49, 30343.79, 30343.79, null, null, null, null, "ENGENHEIRO SÊNIOR", "MARABÁ - PA", 0, "2605", "JOAO QUARESMA", "A", 1, "Salobo", "HH", 100, 17640],
];
geral.getRangeByIndexes(0, 0, 101, geralHeaders.length).values = [geralHeaders, ...padRows(geralSamples, geralHeaders.length, 100)];
styleHeader(geral.getRangeByIndexes(0, 0, 1, geralHeaders.length));
styleInputArea(geral.getRangeByIndexes(1, 0, 100, geralHeaders.length));
geral.tables.add(`A1:${colName(geralHeaders.length - 1)}101`, true, "TabelaGeral");
geral.freezePanes.freezeRows(1);
geral.getRange("A:A").format.columnWidth = 18;
geral.getRange("B:C").format.columnWidth = 26;
geral.getRange("I:I").format.numberFormat = "dd/mm/yyyy";
geral.getRange("L:N").format.numberFormat = "#,##0.00";
geral.getRange("O:S").format.numberFormat = "0.0%";
geral.getRange("U:X").format.numberFormat = "#,##0.00";
geral.getRange("AI:AI").format.numberFormat = "0.0%";
geral.getRange("AM:AM").format.numberFormat = '"R$" #,##0.00';
applyList(geral, "K2:K101", ["HH", "A1", "UN"]);
applyList(geral, "AK2:AK101", ["HH", "A1", "UN"]);

// BASE
const baseHeaders = ["Codigo", "Nome Completo", "CPF", "Razão Social", "CNPJ", "E-mail", "Função"];
const baseSamples = [
  ["ALEXANDRE BORGES", "Alexandre Borges de Sousa", null, "BCCP PROJETOS INDUSTRIAIS", "33.522.659/0001-67", "alexandre@email.com", "ANALISTA SÊNIOR"],
  ["JOAO QUARESMA", "João Pedro Quaresma Correa", null, "CORREA ENGENHARIA E CONSULTORIA LTDA", "22.876.865/0001-59", "joao@email.com", "ENGENHEIRO SÊNIOR"],
];
base.getRangeByIndexes(0, 0, 101, baseHeaders.length).values = [baseHeaders, ...padRows(baseSamples, baseHeaders.length, 100)];
styleHeader(base.getRangeByIndexes(0, 0, 1, baseHeaders.length));
styleInputArea(base.getRangeByIndexes(1, 0, 100, baseHeaders.length));
base.tables.add("A1:G101", true, "TabelaBASE");
base.freezePanes.freezeRows(1);
base.getRange("A:A").format.columnWidth = 24;
base.getRange("B:B").format.columnWidth = 34;
base.getRange("D:D").format.columnWidth = 34;
base.getRange("F:F").format.columnWidth = 28;

// MAPA PAGTO context
mapa.getRange("A1:E1").merge();
mapa.getRange("A1").values = [["Mapa de Pagamento - Contexto do Ciclo"]];
styleTitle(mapa, "A1:E1");
mapa.getRange("G1:K6").values = [
  [null, "Maio de 2026", null, null, null],
  ["PRODUÇÃO", new Date(2026, 3, 21), null, null, new Date(2026, 4, 20)],
  [null, "ATO", null, null, "2605"],
  ["Intr. Sossego", "Salobo", "ACG", "Escadas Alumar", "TOTAL"],
  [null, null, null, null, null],
  [null, null, null, null, null],
];
mapa.getRange("G1:K6").format.borders = { preset: "all", style: "thin", color: COLORS.border };
mapa.getRange("G1:K4").format = { fill: COLORS.header, font: { bold: true, color: COLORS.text }, horizontalAlignment: "center", verticalAlignment: "middle" };
mapa.getRange("H2:K2").format.numberFormat = "dd/mm/yyyy";
mapa.getRange("G5:K5").format.numberFormat = '"R$" #,##0.00';
mapa.getRange("G6:K6").format.numberFormat = "0.0%";

const mapaHeaders = ["ATO", "PROJETISTA", "RESPONSÁVEL", "CPF / CNPJ", "RAZÃO SOCIAL", "Intr. Sossego", "Salobo", "ACG", "Escadas Alumar", "VALOR", "REV", "STATUS"];
const mapaSamples = [
  ["Salobo", "ALEXANDRE BORGES", "Alexandre Borges de Sousa", "33.522.659/0001-67", "BCCP PROJETOS INDUSTRIAIS", null, 1, null, null, 15467.5, null, "PENDENTE"],
  ["PRODUÇÃO", "JOAO QUARESMA", "João Pedro Quaresma Correa", "22.876.865/0001-59", "CORREA ENGENHARIA E CONSULTORIA LTDA", 1, null, null, null, 17640, null, "PENDENTE"],
];
mapa.getRangeByIndexes(7, 0, 101, mapaHeaders.length).values = [mapaHeaders, ...padRows(mapaSamples, mapaHeaders.length, 100)];
styleHeader(mapa.getRangeByIndexes(7, 0, 1, mapaHeaders.length));
styleInputArea(mapa.getRangeByIndexes(8, 0, 100, mapaHeaders.length));
mapa.tables.add("A8:L108", true, "Tabela5");
mapa.getRange("G5").formulas = [['=SUMPRODUCT(Tabela5[Intr. Sossego],Tabela5[VALOR])']];
mapa.getRange("H5").formulas = [['=SUMPRODUCT(Tabela5[Salobo],Tabela5[VALOR])']];
mapa.getRange("I5").formulas = [['=SUMPRODUCT(Tabela5[ACG],Tabela5[VALOR])']];
mapa.getRange("J5").formulas = [['=SUMPRODUCT(Tabela5[Escadas Alumar],Tabela5[VALOR])']];
mapa.getRange("K5").formulas = [["=SUM(G5:J5)"]];
mapa.getRange("G6").formulas = [['=IF($K$5=0,0,G5/$K$5)']];
mapa.getRange("G6:K6").fillRight();
mapa.freezePanes.freezeRows(8);
mapa.getRange("A:A").format.columnWidth = 16;
mapa.getRange("B:C").format.columnWidth = 24;
mapa.getRange("D:D").format.columnWidth = 20;
mapa.getRange("E:E").format.columnWidth = 32;
mapa.getRange("F:I").format.columnWidth = 14;
mapa.getRange("J:J").format.columnWidth = 16;
mapa.getRange("K:L").format.columnWidth = 14;
mapa.getRange("G:K").format.columnWidth = 16;
mapa.getRange("F9:I108").format.numberFormat = "0.0%";
mapa.getRange("J9:J108").format.numberFormat = '"R$" #,##0.00';
applyList(mapa, "A9:A108", ["PRODUÇÃO", "Intr. Sossego", "Salobo", "ACG", "Escadas Alumar"]);
applyList(mapa, "L9:L108", ["PENDENTE", "APROVADO", "REVISAO_SOLICITADA", "REENVIADO"]);

// Lists/reference
listas.getRange("A1:D1").values = [["Formatos", "Atuação / ATO", "Status SGC", "Contratos"]];
listas.getRange("A2:D6").values = [
  ["HH", "PRODUÇÃO", "PENDENTE", "Intr. Sossego"],
  ["A1", "Intr. Sossego", "APROVADO", "Salobo"],
  ["UN", "Salobo", "REVISAO_SOLICITADA", "ACG"],
  [null, "ACG", "REENVIADO", "Escadas Alumar"],
  [null, "Escadas Alumar", null, null],
];
styleHeader(listas.getRange("A1:D1"));
styleInputArea(listas.getRange("A2:D6"));
listas.getRange("A:D").format.columnWidth = 22;

// Comments on key cells
workbook.comments.addThread({ cell: mapa.getRange("H1") }, "Texto usado para derivar o ciclo quando o ciclo não for informado na aplicação. Exemplo: Maio de 2026 => 2605.");
workbook.comments.addThread({ cell: mapa.getRange("A8") }, "Regra da aplicação: PRODUÇÃO permanece produção; qualquer outro valor com VALOR maior que zero é tratado como ATO.");
workbook.comments.addThread({ cell: geral.getRange("A1") }, "Obrigatório. O valor deve iniciar com BM para a linha ser importada como medição.");
workbook.comments.addThread({ cell: base.getRange("A1") }, "Chave do colaborador. Deve bater com PROJETISTA nas abas Geral e MAPA PAGTO.");

// Visual verification and export
await fs.mkdir(outputDir, { recursive: true });
const inspect = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 6000,
  tableMaxRows: 3,
  tableMaxCols: 8,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["Instruções", "Geral", "BASE", "MAPA PAGTO", "Listas"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName.replaceAll(" ", "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(outputPath);
