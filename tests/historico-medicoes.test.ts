import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const PAGE = "components/medicoes-app.tsx";

/**
 * Histórico = somente consulta. A manutenção de ciclos (Novo/Selecionar/Excluir) saiu daqui para
 * Fornecedores → Gerenciar ciclos, e a publicação no portal para o controle "Ciclo publicado". Guardas:
 * nenhuma ação operacional volta ao Histórico, containers continuam podendo encolher (min-w-0), e o
 * painel de Fornecedores preserva as mesmas regras (formato YYMM, exclusão só ADMIN, sem window.confirm).
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

test("Histórico não tem nenhuma ação de manutenção de ciclo (Novo/Abrir/Excluir/Publicar)", () => {
  const sources = [
    historicoSectionBlock(),
    readSource("components/historico/historico-workspace.tsx"),
    readSource("components/historico/drawers.tsx"),
    readSource("components/historico/listas.tsx"),
  ].join("\n");
  assert.doesNotMatch(sources, /Novo ciclo|Excluir ciclo|Abrir ciclo|Gerenciar ciclos|Publicar ciclo|Ativar medição/);
  assert.doesNotMatch(sources, /\/api\/ciclos|method:\s*"(POST|PATCH|DELETE|PUT)"/);
});

test("Histórico carrega os dados numa chamada (GET /api/historico), sem uma requisição de mapa por ciclo", () => {
  const dados = readSource("components/historico/dados.ts");
  assert.match(dados, /fetch\("\/api\/historico"\)/);
  assert.doesNotMatch(dados, /\/api\/mapa-pagamento/);
});

test("Gerenciar ciclos (Fornecedores): input YYMM responsivo, mesma API, exclusão via modal (sem window.confirm)", () => {
  const painel = readSource("components/fornecedores/gerenciar-ciclos.tsx");
  const inputIndex = painel.indexOf('placeholder="Ex: 2606"');
  const inputTag = painel.slice(painel.lastIndexOf("<input", inputIndex), painel.indexOf(">", inputIndex));
  assert.match(inputTag, /w-full/);
  assert.match(inputTag, /sm:w-32/);
  assert.ok(painel.includes("/^\\d{4}$/"), "mesma validação YYMM de antes");
  assert.match(painel, /role="alertdialog"/);
  assert.doesNotMatch(painel, /window\.confirm\(|fetch\(/, "o painel só chama callbacks — as requisições continuam as mesmas em medicoes-app.tsx");
});

test("medicoes-app: Novo/Excluir ciclo continuam na mesma API (POST/DELETE /api/ciclos, payload de confirmação preservado)", () => {
  const source = readSource(PAGE);
  const criar = source.slice(source.indexOf("async function criarCicloApi("), source.indexOf("async function criarCiclo()"));
  assert.match(criar, /fetch\("\/api\/ciclos", \{\s*method: "POST"/);
  const excluir = source.slice(source.indexOf("async function excluirCiclo("), source.indexOf("function markSeen("));
  assert.match(excluir, /method: "DELETE"/);
  assert.match(excluir, /confirmacao: "RESETAR_CICLOS"/);
  assert.doesNotMatch(excluir, /window\.confirm/);
});
