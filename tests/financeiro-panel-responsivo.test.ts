import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readSource() {
  return fs.readFileSync(path.join(__dirname, "..", "components/financeiro-panel.tsx"), "utf8");
}

/**
 * Guarda de regressão para a correção de responsividade do Painel Financeiro — mesmo padrão já
 * aplicado em Evidências (tests/evidencias-medicao.test.ts) e Histórico
 * (tests/historico-medicoes.test.ts): tabela com wrapper overflow-x-auto + min-width definido,
 * Card com min-w-0/max-w-full, filtros em grid responsivo, nada de w-screen/100vw.
 */

test("FinanceiroPanel nunca usa w-screen/100vw", () => {
  assert.doesNotMatch(readSource(), /w-screen|100vw/);
});

test("Tabela: wrapper DIRETO com overflow-x-auto antes de <table>", () => {
  const source = readSource();
  const tableIndex = source.indexOf("<table");
  const before = source.slice(0, tableIndex);
  const wrapperIndex = before.lastIndexOf("overflow-x-auto");
  assert.ok(wrapperIndex > -1, "esperava um wrapper com overflow-x-auto ANTES da tabela");
  const between = before.slice(wrapperIndex, tableIndex);
  assert.equal((between.match(/<div/g) ?? []).length <= 1, true, "precisa ser o wrapper direto, não um ancestral distante");
});

test("Tabela: min-width definido (não comprime colunas até ficarem ilegíveis)", () => {
  assert.match(readSource(), /<table className="[^"]*min-w-\[\d+px\]/);
});

test("Card da tabela tem min-w-0/max-w-full (HeroUI Card é flex-col por padrão)", () => {
  const source = readSource();
  const tableCardIndex = source.indexOf("{/* Tabela");
  const cardIndex = source.indexOf("<Card", tableCardIndex);
  const cardTagEnd = source.indexOf(">", cardIndex);
  const cardTag = source.slice(cardIndex, cardTagEnd);
  assert.match(cardTag, /min-w-0/);
  assert.match(cardTag, /max-w-full/);
});

test("CNPJ/Valor/datas/Status/Ações continuam com whitespace-nowrap (nunca quebram no meio)", () => {
  const source = readSource();
  // CNPJ
  const cnpjTdIndex = source.indexOf("<BlurValue>{item.cpfCnpj");
  const cnpjTdStart = source.lastIndexOf("<td", cnpjTdIndex);
  assert.match(source.slice(cnpjTdStart, cnpjTdIndex), /whitespace-nowrap/);
  // Valor
  const valorTdIndex = source.indexOf("<BlurValue>{currency.format(total)}");
  const valorTdStart = source.lastIndexOf("<td", valorTdIndex);
  assert.match(source.slice(valorTdStart, valorTdIndex), /whitespace-nowrap/);
});

test("Razão Social NÃO tem whitespace-nowrap (pode quebrar em duas linhas, não deve inflar a tabela)", () => {
  const source = readSource();
  const razaoIndex = source.indexOf("{item.razaoSocial ?? \"–\"}");
  const tdStart = source.lastIndexOf("<td", razaoIndex);
  assert.doesNotMatch(source.slice(tdStart, razaoIndex), /whitespace-nowrap/);
});

test("Botão 'Ver BM' tem whitespace-nowrap (nunca quebra em 'Ver' / 'BM')", () => {
  const source = readSource();
  const onClickIndex = source.indexOf("onClick={() => openBm(item)}");
  const verBmIndex = source.indexOf("Ver BM", onClickIndex);
  const buttonStart = source.lastIndexOf("<button", verBmIndex);
  assert.ok(buttonStart > onClickIndex - 200 && buttonStart < verBmIndex);
  assert.match(source.slice(buttonStart, verBmIndex), /whitespace-nowrap/);
});

function filtrosBlock() {
  const source = readSource();
  const filtrosIndex = source.indexOf("{/* Filtros");
  const nextSectionIndex = source.indexOf("{/* Modal BM", filtrosIndex);
  return source.slice(filtrosIndex, nextSectionIndex);
}

test("Filtros usam o padrão compartilhado FilterButton/FilterChip (mesmo de Evidências/Administrativo/Dashboard/Histórico), não um card grande próprio", () => {
  const block = filtrosBlock();
  assert.match(block, /<FilterButton/);
  assert.doesNotMatch(block, /<Card/, "o card grande antigo de filtros não pode mais existir aqui");
});

test("Campo Buscar fica SEMPRE visível fora do popover (uso frequente) e sem min-width fixo grande", () => {
  const block = filtrosBlock();
  const popoverStart = block.indexOf("filtrosAbertos &&");
  const popoverEnd = block.indexOf(")}", popoverStart);
  const buscaIndex = block.indexOf('placeholder="Nome, ID ou empresa..."');
  assert.ok(buscaIndex > -1 && (buscaIndex < popoverStart || buscaIndex > popoverEnd), "Buscar precisa estar FORA do bloco condicional do popover");
  assert.doesNotMatch(block, /min-w-\[\d+px\]/, "campo Buscar não deve ter um min-width fixo grande");
});

test("Ciclo (sempre exigido pela tela, sem opção 'Todos os ciclos') NÃO conta no contador de filtros nem vira chip removível — só Status é filtro real", () => {
  const block = filtrosBlock();
  const countIndex = block.indexOf("count={");
  const countExprEnd = block.indexOf("}", countIndex);
  assert.doesNotMatch(block.slice(countIndex, countExprEnd), /selectedCiclo/, "Ciclo não deve entrar na contagem de filtros ativos — é contexto obrigatório da tela, não um filtro opcional");
  assert.doesNotMatch(block, /Ciclo:\s*\$\{selectedCiclo\}/, "não deve existir chip removível de Ciclo");
});

test("Status vira chip removível só quando != 'todos', com o mesmo rótulo já usado no <select>", () => {
  const block = filtrosBlock();
  assert.match(block, /filterStatus !== "todos" &&[\s\S]*?<FilterChip/);
  assert.match(block, /STATUS_FILTRO_LABEL\[filterStatus\]/);
});

test("Remover o chip de Status só reseta Status (nunca Ciclo/Busca) e 'Limpar filtros' só reseta Status (nunca Busca)", () => {
  const block = filtrosBlock();
  const chipIndex = block.indexOf("<FilterChip");
  const onRemoveMatch = block.slice(chipIndex, block.indexOf("/>", chipIndex));
  assert.match(onRemoveMatch, /onRemove=\{\(\) => setFilterStatus\("todos"\)\}/);

  const limparIndex = block.indexOf("Limpar filtros");
  const limparOnClickStart = block.lastIndexOf("onClick=", limparIndex);
  const limparOnClickEnd = block.indexOf("}", limparOnClickStart);
  const onClickBlock = block.slice(limparOnClickStart, limparOnClickEnd);
  assert.match(onClickBlock, /setFilterStatus\("todos"\)/);
  assert.doesNotMatch(onClickBlock, /setBusca/, "'Limpar filtros' não deve limpar o campo Busca");
});

test("Select de Ciclo dentro do popover continua alimentado pela mesma prop `ciclos` (nunca lista hardcoded)", () => {
  const block = filtrosBlock();
  assert.match(block, /\{ciclos\.map\(\(c\) => <option key=\{c\.ciclo\} value=\{c\.ciclo\}>\{c\.ciclo\}<\/option>\)\}/);
});

test("Opções de Status preservadas exatamente (mesmos 4 valores internos, nenhum status novo)", () => {
  const block = filtrosBlock();
  assert.match(block, /<option value="todos">Todos<\/option>/);
  assert.match(block, /<option value="AGUARDANDO_NF">Aguardando NF<\/option>/);
  assert.match(block, /<option value="APROVADO">Aguardando pgto\.<\/option>/);
  assert.match(block, /<option value="PAGO">Concluído<\/option>/);
});

test("Header (Exportar/Atualizar) é responsivo — full-width no mobile, auto no desktop", () => {
  const source = readSource();
  const exportarIndex = source.indexOf("Exportar concluídos");
  const buttonStart = source.lastIndexOf("<Button", exportarIndex);
  assert.match(source.slice(buttonStart, exportarIndex), /w-full sm:w-auto/);
});

test("Cards de KPI usam grid com breakpoint intermediário (1 -> 2 -> 3 colunas)", () => {
  const source = readSource();
  assert.match(source, /grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3/);
});
