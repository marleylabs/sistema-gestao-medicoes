import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const PAGE = "components/medicoes-app.tsx";

/**
 * Guarda de regressão para a correção de responsividade de "Histórico de Medições" — mesmo padrão
 * já aplicado em Evidências de Medição (tests/evidencias-medicao.test.ts): a tabela precisa estar
 * dentro de um wrapper com overflow-x-auto (scroll interno, nunca na página inteira), e os
 * containers ancestrais precisam poder encolher (min-w-0).
 */

function historicoSectionBlock() {
  const source = readSource(PAGE);
  const start = source.indexOf("function HistoricoSection(");
  const end = source.indexOf("\n// ───", start + 1);
  return source.slice(start, end > -1 ? end : undefined);
}

test("HistoricoSection nunca usa w-screen/100vw", () => {
  assert.doesNotMatch(historicoSectionBlock(), /w-screen|100vw/);
});

test("HistoricoSection: raiz do componente tem min-w-0 (encolhe dentro do ancestral flex/grid do AppShell)", () => {
  const block = historicoSectionBlock();
  const returnIndex = block.indexOf("return (");
  const rootDivIndex = block.indexOf("<div", returnIndex);
  const rootDivEnd = block.indexOf(">", rootDivIndex);
  assert.match(block.slice(rootDivIndex, rootDivEnd), /min-w-0/);
});

test("HistoricoSection: a tabela tem um wrapper DIRETO com overflow-x-auto (scroll interno, nunca global)", () => {
  const block = historicoSectionBlock();
  const tableIndex = block.indexOf("<table");
  const before = block.slice(0, tableIndex);
  const wrapperIndex = before.lastIndexOf("overflow-x-auto");
  assert.ok(wrapperIndex > -1, "esperava um wrapper com overflow-x-auto ANTES da tabela");
  const between = before.slice(wrapperIndex, tableIndex);
  assert.equal((between.match(/<div/g) ?? []).length <= 1, true, "precisa ser o wrapper DIRETO da tabela, não um ancestral distante");
});

test("HistoricoSection: Card da tabela tem min-w-0/max-w-full (HeroUI Card é flex-col por padrão)", () => {
  const block = historicoSectionBlock();
  const cardIndex = block.indexOf("<Card");
  const cardTagEnd = block.indexOf(">", cardIndex);
  const cardTag = block.slice(cardIndex, cardTagEnd);
  assert.match(cardTag, /min-w-0/);
  assert.match(cardTag, /max-w-full/);
});

test("HistoricoSection: tabela tem min-width definido (não comprime colunas até ficarem ilegíveis)", () => {
  const block = historicoSectionBlock();
  assert.match(block, /<table className="[^"]*min-w-\[\d+px\]/);
});

test("HistoricoSection: input 'Ex: 2606' e botões Novo/Excluir ciclo são responsivos (full-width no mobile, auto no desktop)", () => {
  const block = historicoSectionBlock();
  const toolbarIndex = block.indexOf('placeholder="Ex: 2606"');
  const inputTagStart = block.lastIndexOf("<input", toolbarIndex);
  const inputTagEnd = block.indexOf(">", toolbarIndex);
  const inputTag = block.slice(inputTagStart, inputTagEnd);
  assert.match(inputTag, /w-full/);
  assert.match(inputTag, /sm:w-32|sm:w-auto/);

  const novoCicloIndex = block.indexOf("Novo ciclo");
  const buttonStart = block.lastIndexOf("<Button", novoCicloIndex);
  const buttonTagEnd = block.indexOf(">", buttonStart);
  assert.match(block.slice(buttonStart, buttonTagEnd), /w-full sm:w-auto/);
});

test("HistoricoSection: coluna 'Última atualização' não quebra a data no meio (whitespace-nowrap)", () => {
  const block = historicoSectionBlock();
  const cellIndex = block.indexOf("{dateLabel(c.updatedAt)}");
  const tdStart = block.lastIndexOf("<td", cellIndex);
  assert.match(block.slice(tdStart, cellIndex), /whitespace-nowrap/);
});

test("HistoricoSection: nenhuma coluna foi escondida com hidden/table-cell (scroll interno preserva todas as colunas)", () => {
  const block = historicoSectionBlock();
  assert.doesNotMatch(block, /hidden\s+(sm|md|lg|xl):table-cell/);
});
