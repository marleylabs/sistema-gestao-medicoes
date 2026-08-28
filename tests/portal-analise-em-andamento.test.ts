import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Guarda de regressão para o ajuste de UX do Portal do Fornecedor: quando
 * `statusConferencia === "DIVERGENCIA"`, o fornecedor deve ver "Análise em andamento"/"Em
 * análise" — nunca a palavra "Divergência" — enquanto o status técnico interno continua
 * DIVERGENCIA (a Equipe de Medição não muda). Este projeto não tem infraestrutura de renderização
 * de componentes React nos testes `tsx --test` existentes (todos os testes de UI desta sessão são
 * de fonte real, não mocks) — por isso o bloco JSX real é lido e verificado aqui, garantindo que a
 * condição, o texto e o texto PROIBIDO não sejam reintroduzidos por engano numa futura edição.
 */
function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function extractBlock(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.ok(start > -1, `marcador não encontrado: ${marker}`);
  // Bloco JSX condicional termina no fechamento "        )}" (mesma indentação usada no arquivo).
  const end = source.indexOf("\n        )}", start);
  assert.ok(end > -1, `fim do bloco não encontrado após: ${marker}`);
  return source.slice(start, end);
}

test("Portal do Fornecedor: card de DIVERGENCIA continua condicionado ao status técnico real, sem alterá-lo", () => {
  const source = readSource("components/colaborador-app.tsx");
  assert.match(source, /precisaConferencia && data\.sgc\.statusConferencia === "DIVERGENCIA"/);
});

test("Portal do Fornecedor: card de DIVERGENCIA mostra 'Análise em andamento' e o texto neutro pedido, nunca a palavra Divergência", () => {
  const source = readSource("components/colaborador-app.tsx");
  const block = extractBlock(source, 'data.sgc.statusConferencia === "DIVERGENCIA" && (');

  assert.match(block, /Análise em andamento/);
  assert.match(block, /As informações enviadas estão sendo analisadas pela Equipe de Medição\./);
  assert.match(block, /Aguarde a conclusão da análise\./);
  assert.match(block, /Em análise/);

  assert.doesNotMatch(block, /Divergência/i);
  assert.doesNotMatch(block, /divergências/i);
  assert.doesNotMatch(block, /diferenças/i);
  assert.doesNotMatch(block, /Conferência em andamento/);
});

test("Portal do Fornecedor: card de DIVERGENCIA não usa mais aparência de erro (badge/ícone neutros)", () => {
  const source = readSource("components/colaborador-app.tsx");
  const block = extractBlock(source, 'data.sgc.statusConferencia === "DIVERGENCIA" && (');

  assert.doesNotMatch(block, /variant="danger"/);
  assert.doesNotMatch(block, /<AlertTriangle/);
  assert.doesNotMatch(block, /var\(--error/);
  assert.match(block, /variant="warning"/);
  assert.match(block, /<Clock/);
});

test("Portal do Fornecedor: não expõe quantidade de divergências nem detalhes técnicos nesta etapa", () => {
  const source = readSource("components/colaborador-app.tsx");
  const block = extractBlock(source, 'data.sgc.statusConferencia === "DIVERGENCIA" && (');
  assert.doesNotMatch(block, /quantidade/i);
  assert.doesNotMatch(block, /NR VALE/i);
  assert.doesNotMatch(block, /documento[s]? divergente/i);
});

test("Equipe de Medição (Pagamentos por Fornecedor / mapa-pagamento-table.tsx) continua usando DIVERGENCIA sem alteração", () => {
  const source = readSource("components/mapa-pagamento-table.tsx");
  assert.match(source, /statusConferencia === "DIVERGENCIA"/);
});

test("BM_DIVERGENCE (e-mail para a Equipe de Medição) não foi alterado por esta tarefa", () => {
  const source = readSource("lib/email/templates/bm-divergence.ts");
  assert.match(source, /Foi identificada divergência/);
  assert.match(source, /Quantidade de divergências/);
});

test("statusConferencia no banco/backend continua podendo ser 'DIVERGENCIA' — nenhuma rota troca esse valor por EM_ANALISE", () => {
  const source = readSource("app/api/colaborador/conferencia/upload/route.ts");
  assert.match(source, /statusConferencia: "DIVERGENCIA"/);
  assert.doesNotMatch(source, /EM_ANALISE/);
});
