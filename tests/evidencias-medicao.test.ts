import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const ROUTE = "app/api/sgc/status/route.ts";
const PAGE = "components/medicoes-app.tsx";

/**
 * Guarda de regressão para o bug corrigido: "Evidências de Medição" com fornecedor selecionado e
 * SEM ciclo escolhido mostrava só o BM do ciclo mais recente — a causa real era o FRONTEND
 * (não a rota) montando um `Map<colaboradorCodigo, ...>` por ciclo e sobrescrevendo entradas mais
 * antigas a cada ciclo processado. Estes testes leem o código-fonte real (rota + página) para
 * garantir que a correção — filtros independentes, resultado sempre em lista — não regrida.
 */

test("GET /api/sgc/status usa findMany (nunca findFirst/take:1) e retorna ARRAY, nunca objeto indexado por colaboradorCodigo", () => {
  const source = readSource(ROUTE);
  assert.match(source, /prisma\.sgcAprovacaoMedicao\.findMany/);
  assert.doesNotMatch(source, /sgcAprovacaoMedicao\.findFirst/);
  assert.doesNotMatch(source, /take:\s*1/);
  assert.doesNotMatch(source, /\[0\]/);
  // resposta é o resultado de um .map(...) sobre o array — não um objeto Record<string, ...>
  // construído por um for..of que faz payload[colaboradorCodigo] = ...
  assert.doesNotMatch(source, /payload\[[^\]]+\]\s*=/, "não pode mais colapsar por colaboradorCodigo num objeto indexado");
  assert.match(source, /registros\.map\(/);
});

test("GET /api/sgc/status aceita ciclo e colaboradorCodigo como filtros INDEPENDENTES e opcionais", () => {
  const source = readSource(ROUTE);
  const whereIndex = source.indexOf("where: {");
  const whereEnd = source.indexOf("},", whereIndex);
  const whereBlock = source.slice(whereIndex, whereEnd);
  assert.match(whereBlock, /\.\.\.\(ciclo \? \{ ciclo \} : \{\}\)/, "ciclo precisa ser um filtro condicional independente");
  assert.match(whereBlock, /\.\.\.\(colaboradorCodigo \? \{ colaboradorCodigo \} : \{\}\)/, "colaboradorCodigo precisa ser um filtro condicional independente");
});

test("GET /api/sgc/status ordena por ciclo desc (mais recente primeiro)", () => {
  const source = readSource(ROUTE);
  assert.match(source, /orderBy:\s*\[\{\s*ciclo:\s*"desc"/);
});

test("EvidenciasSection não reconstrói mais o Map por colaboradorCodigo que sobrescrevia ciclos antigos", () => {
  const source = readSource(PAGE);
  assert.doesNotMatch(source, /aprovadosMap/, "o Map que causava o bug (fornecedor -> só o ciclo mais recente) precisa ter sido removido");
});

test("EvidenciasSection.verBoletim usa colaboradorCodigo/ciclo do PRÓPRIO item da lista — nunca reconstrói a busca por nome", () => {
  const source = readSource(PAGE);
  const fnIndex = source.indexOf("async function verBoletim(item: EvidenciaListItem)");
  assert.ok(fnIndex > -1, "esperava encontrar verBoletim(item: EvidenciaListItem)");
  const fnEnd = source.indexOf("\n  }\n", fnIndex);
  const block = source.slice(fnIndex, fnEnd);
  assert.match(block, /item\.colaboradorCodigo/);
  assert.match(block, /item\.ciclo/);
});

test("EvidenciasSection: sem nenhum filtro selecionado, resultados fica null (estado inicial, sem carregar tudo à toa)", () => {
  const source = readSource(PAGE);
  const effectIndex = source.indexOf("if (!selectedCiclo && !selectedFornecedor)");
  assert.ok(effectIndex > -1, "esperava a guarda 'sem filtro nenhum' antes de buscar");
  const nearby = source.slice(effectIndex, effectIndex + 120);
  assert.match(nearby, /setResultados\(null\)/);
});

test("EvidenciasSection: filtro de fornecedor guarda colaboradorCodigo (identidade canônica), nunca o texto digitado", () => {
  const source = readSource(PAGE);
  assert.match(source, /selectedFornecedor:\s*\{\s*codigo:\s*string;\s*nome:\s*string\s*\}|useState<\{\s*codigo:\s*string;\s*nome:\s*string\s*\}\s*\|\s*null>/);
  assert.doesNotMatch(source, /colaboradorCodigo:\s*fornecedorQuery/, "nunca usar o texto livre digitado como colaboradorCodigo");
});

test("BoletimMedicao encapsula a tabela num wrapper com overflow-x-auto (scroll fica dentro do boletim, nunca na página)", () => {
  const source = readSource("components/boletim-medicao.tsx");
  assert.doesNotMatch(source, /w-screen|100vw/, "boletim nunca deve usar w-screen/100vw — a área de conteúdo tem sidebar");
  const tableIndex = source.indexOf("<table");
  const before = source.slice(0, tableIndex);
  const wrapperIndex = before.lastIndexOf("overflow-x-auto");
  assert.ok(wrapperIndex > -1, "esperava um wrapper com overflow-x-auto ANTES da tabela");
  // Confirma que não há nenhuma outra tag <div> abrindo entre o wrapper com overflow-x-auto e a
  // tabela (garante que é o wrapper DIRETO, não um ancestral distante).
  const between = before.slice(wrapperIndex, tableIndex);
  assert.equal((between.match(/<div/g) ?? []).length <= 1, true);
});

test("BoletimMedicao: raiz do componente tem min-w-0 (permite encolher dentro de Card flex-col do HeroUI)", () => {
  const source = readSource("components/boletim-medicao.tsx");
  const returnIndex = source.indexOf("return (");
  const rootDivIndex = source.indexOf("<div", returnIndex);
  const rootDivEnd = source.indexOf(">", rootDivIndex);
  const rootDiv = source.slice(rootDivIndex, rootDivEnd);
  assert.match(rootDiv, /min-w-0/);
});

test("CNPJ do boletim tem whitespace-nowrap (nunca quebra no meio do número)", () => {
  const source = readSource("components/boletim-medicao.tsx");
  const cnpjLabelIndex = source.indexOf(">CNPJ<");
  const cnpjValueIndex = source.indexOf("{cpfCnpj}", cnpjLabelIndex);
  const before = source.slice(cnpjLabelIndex, cnpjValueIndex);
  assert.match(before, /whitespace-nowrap/);
});

test("Card do Boletim (medicoes-app.tsx) nunca usa overflow-x-auto duplicado — BoletimMedicao já rola por conta própria", () => {
  const source = readSource(PAGE);
  const bmCardIndex = source.indexOf("Boletim de Medição{bmContext");
  const wrapperIndex = source.lastIndexOf("<div", bmCardIndex);
  const boletimCallIndex = source.indexOf("<BoletimMedicao", bmCardIndex);
  const between = source.slice(wrapperIndex, boletimCallIndex);
  assert.doesNotMatch(between, /className="[^"]*overflow-x-auto/, "não duplicar overflow-x-auto aqui — evita dois containers de scroll aninhados");
});

test("EvidenciasSection usa o novo padrão visual compartilhado (FilterButton/FilterChip), não o card grande antigo de filtros", () => {
  const source = readSource(PAGE);
  const sectionIndex = source.indexOf("function EvidenciasSection(");
  const nextFnIndex = source.indexOf("\nfunction ", sectionIndex + 1);
  const block = source.slice(sectionIndex, nextFnIndex > -1 ? nextFnIndex : undefined);
  assert.match(block, /<FilterButton/);
  assert.match(block, /<FilterChip/);
  assert.doesNotMatch(block, /Selecione o ciclo e o fornecedor para visualizar o boletim/, "texto do card grande antigo não pode mais existir");
});
