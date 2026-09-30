import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function read(file: string) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}
const panel = () => read("components/financeiro-panel.tsx");
const table = () => read("components/financeiro/financeiro-table.tsx");
const shared = () => read("components/financeiro/shared.ts");
const drawer = () => read("components/financeiro/financeiro-drawer.tsx");

/**
 * Guarda de regressão do Financeiro (redesign): responsividade sem scroll global, lista compacta no
 * mobile, uma única fonte de valor, status internos preservados e ações no detalhe lateral.
 */

test("Financeiro nunca usa w-screen/100vw", () => {
  for (const source of [panel(), table(), drawer()]) assert.doesNotMatch(source, /w-screen|100vw/);
});

test("Tabela: wrapper DIRETO com overflow-x-auto antes de <table>", () => {
  const source = table();
  const tableIndex = source.indexOf("<table");
  const before = source.slice(0, tableIndex);
  const wrapperIndex = before.lastIndexOf("overflow-x-auto");
  assert.ok(wrapperIndex > -1, "esperava um wrapper com overflow-x-auto ANTES da tabela");
  const between = before.slice(wrapperIndex, tableIndex);
  assert.equal((between.match(/<div/g) ?? []).length <= 1, true, "precisa ser o wrapper direto, não um ancestral distante");
});

test("Colunas secundárias somem progressivamente (lg/xl/1400) e o mobile vira lista compacta", () => {
  const source = table();
  assert.match(source, /hidden xl:table-cell/);
  assert.match(source, /hidden lg:table-cell/);
  assert.match(source, /data-testid="financeiro-lista-mobile"/);
  assert.match(source, /md:hidden/);
});

test("Card da tabela tem min-w-0/max-w-full (HeroUI Card é flex-col por padrão)", () => {
  const source = panel();
  const tableCardIndex = source.indexOf("{/* Tabela");
  const cardIndex = source.indexOf("<Card", tableCardIndex);
  const cardTag = source.slice(cardIndex, source.indexOf(">", cardIndex));
  assert.match(cardTag, /min-w-0/);
  assert.match(cardTag, /max-w-full/);
});

test("Valor a pagar = valor + rev, fonte ÚNICA para tabela, rodapé, resumo e detalhe", () => {
  assert.match(shared(), /return item\.valor \+ item\.rev;/);
  assert.match(table(), /valorAPagar\(item\)/);
  assert.match(panel(), /valorAPagar\(item\)/);
  assert.match(drawer(), /valorAPagar\(item\)/);
  assert.doesNotMatch(panel(), /item\.valor \+ item\.rev/, "o painel não pode refazer a conta por conta própria");
});

test("Valor, CNPJ e status nunca quebram no meio (whitespace-nowrap)", () => {
  const source = table();
  const valorIndex = source.indexOf("<BlurValue>{currency.format(valorAPagar(item))}");
  assert.match(source.slice(source.lastIndexOf("<td", valorIndex), valorIndex), /whitespace-nowrap/);
  const cnpjIndex = source.indexOf("<BlurValue>{item.cpfCnpj");
  assert.match(source.slice(source.lastIndexOf("<p", cnpjIndex), cnpjIndex), /whitespace-nowrap/);
});

test("Status internos preservados exatamente (3 status da API, mesmos rótulos, nenhum novo)", () => {
  const source = shared();
  assert.match(source, /STATUS_FINANCEIROS = \["AGUARDANDO_NF", "APROVADO", "PAGO"\] as const/);
  assert.match(source, /AGUARDANDO_NF: "Aguardando NF"/);
  assert.match(source, /APROVADO: "Aguardando pgto\."/);
  assert.match(source, /PAGO: "Concluído"/);
});

test("Ciclo continua alimentado pela prop `ciclos` (nunca lista hardcoded) e Buscar fica sempre visível", () => {
  const source = panel();
  assert.match(source, /\{ciclos\.map\(\(c\) => <option key=\{c\.ciclo\} value=\{c\.ciclo\}>\{c\.ciclo\}<\/option>\)\}/);
  assert.match(source, /placeholder="Nome, ID ou empresa\.\.\."/);
});

test("'Marcar pago' só para APROVADO e mantém comprovante opcional no mesmo PATCH", () => {
  assert.match(drawer(), /item\.status === "APROVADO"/);
  assert.match(drawer(), /accept="\.pdf,\.jpg,\.jpeg,\.png"/);
  assert.match(panel(), /fetch\("\/api\/admin\/financeiro", \{ method: "PATCH", body: form \}\)/);
});

test("Header (Exportar) é responsivo — full-width no mobile, auto no desktop", () => {
  const source = panel();
  const exportarIndex = source.indexOf("Exportar concluídos");
  const buttonStart = source.lastIndexOf("<Button", exportarIndex);
  assert.match(source.slice(buttonStart, exportarIndex), /w-full sm:w-auto/);
});
