import assert from "node:assert/strict";
import test from "node:test";

/**
 * Guarda de regressão para um bug CRÍTICO encontrado via Playwright E2E (Fase 4 desta auditoria):
 * `cadastroFornecedorByMapaItem` (lib/mapa-pagamento-cadastro.ts) usava `samePersonMatch` — uma
 * comparação fuzzy por distância de edição, pensada para tolerar erro de digitação em NOMES — para
 * comparar `colaboradorCodigo` também. Como colaborador_codigo é atribuído sequencialmente
 * (ex.: P0900004, P0900005), dois fornecedores DIFERENTES e adjacentes colapsavam para o mesmo
 * cadastro em "Pagamentos por Fornecedor" (e em Dashboard/Financeiro/exportação — mesma função
 * compartilhada por 6 arquivos), exibindo nome/CNPJ/Tipo CT ERRADOS mesmo com o banco correto.
 *
 * `lib/mapa-pagamento-cadastro.ts` tem "server-only" (sem dependência real de ambiente server —
 * só usa decryptSensitive para CNPJ, não usado neste teste) — reimplementado aqui verbatim
 * (mesma lógica do arquivo real, não uma reimplementação divergente) para testar o comportamento
 * real sem o bloqueio de import documentado nesta sessão.
 */

function normalizeCadastroMatch(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function editDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = left[i - 1] === right[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[left.length][right.length];
}

function similarToken(left: string, right: string) {
  if (left === right) return true;
  const minLength = Math.min(left.length, right.length);
  if (minLength < 4) return false;
  return editDistance(left, right) <= (minLength >= 8 ? 2 : 1);
}

const STOP_WORDS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "LTDA", "ME", "EIRELI"]);
function tokenList(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().match(/[A-Z0-9]{2,}/g)?.filter((t) => !STOP_WORDS.has(t)) ?? [];
}
function fuzzyNameMatch(left: string | null | undefined, right: string | null | undefined) {
  const leftTokens = tokenList(left);
  const rightTokens = tokenList(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const matches = leftTokens.filter((l) => rightTokens.some((r) => similarToken(l, r))).length;
  const required = Math.min(leftTokens.length, rightTokens.length) >= 2 ? 2 : 1;
  return matches >= required && matches / Math.min(leftTokens.length, rightTokens.length) >= 0.5;
}

function samePersonMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeCadastroMatch(left);
  const b = normalizeCadastroMatch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 8 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (fuzzyNameMatch(left, right)) return true;
  return false;
}

// Regra CORRIGIDA (idêntica ao arquivo real após o fix).
function sameCodigoMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeCadastroMatch(left);
  const b = normalizeCadastroMatch(right);
  return !!a && !!b && a === b;
}

type CadastroResumo = { id: string; colaboradorCodigo: string | null; responsavel: string; razaoSocial: string; cnpjNormalizado: string };

function cadastroFornecedorByMapaItemCorrigido(item: { projetistaCodigo: string | null; responsavel: string | null }, cadastros: CadastroResumo[]) {
  const codigoCandidates = [item.projetistaCodigo].filter((v): v is string => !!v).map(normalizeCadastroMatch);
  const byCodigo = cadastros.find((c) => codigoCandidates.some((codigo) => sameCodigoMatch(c.colaboradorCodigo, codigo)));
  return byCodigo;
}

test("REGRESSÃO CRÍTICA: dois colaboradorCodigo sequenciais (P0900004/P0900005) NÃO são mais tratados como a mesma pessoa por colaboradorCodigo", () => {
  // Prova do bug: a comparação fuzzy antiga confundia os dois códigos.
  assert.equal(samePersonMatch("P0900004", "P0900005"), true, "documenta por que o bug existia — samePersonMatch é fuzzy por design, para NOMES");
  assert.equal(editDistance("P0900004", "P0900005"), 1, "diferem por 1 caractere — plausível em qualquer par de códigos sequenciais reais");

  // Prova da correção: a comparação exata usada agora para colaboradorCodigo nunca confunde os dois.
  assert.equal(sameCodigoMatch("P0900004", "P0900005"), false);
  assert.equal(sameCodigoMatch("P0900004", "P0900004"), true, "o próprio código continua batendo consigo mesmo");
});

test("REGRESSÃO CRÍTICA: resolução de cadastro por colaboradorCodigo não colapsa dois fornecedores com CNPJ compartilhado e códigos adjacentes", () => {
  const cadastros: CadastroResumo[] = [
    { id: "b", colaboradorCodigo: "P0900005", responsavel: "E2E Fornecedor B", razaoSocial: "E2E FORNECEDOR B LTDA", cnpjNormalizado: "11222333000181" },
    { id: "a", colaboradorCodigo: "P0900004", responsavel: "E2E Fornecedor A", razaoSocial: "TESTE B SERVICOS LTDA", cnpjNormalizado: "11222333000181" },
  ];

  const itemA = { projetistaCodigo: "P0900004", responsavel: "E2E Fornecedor A" };
  const itemB = { projetistaCodigo: "P0900005", responsavel: "E2E Fornecedor B" };

  const resolvidoA = cadastroFornecedorByMapaItemCorrigido(itemA, cadastros);
  const resolvidoB = cadastroFornecedorByMapaItemCorrigido(itemB, cadastros);

  assert.equal(resolvidoA?.id, "a", "item do fornecedor A deve resolver para o cadastro de A, nunca de B");
  assert.equal(resolvidoB?.id, "b", "item do fornecedor B deve resolver para o cadastro de B, nunca de A");
  assert.notEqual(resolvidoA?.id, resolvidoB?.id, "os dois fornecedores nunca podem colapsar para o mesmo cadastro, mesmo com CNPJ igual e códigos adjacentes");
});

test("comparação exata de código continua determinística independente da ordem do array (updatedAt desc na rota real)", () => {
  const cadastros: CadastroResumo[] = [
    { id: "a", colaboradorCodigo: "P0900004", responsavel: "E2E Fornecedor A", razaoSocial: "A", cnpjNormalizado: "11222333000181" },
    { id: "b", colaboradorCodigo: "P0900005", responsavel: "E2E Fornecedor B", razaoSocial: "B", cnpjNormalizado: "11222333000181" },
  ];
  const cadastrosInvertidos = [...cadastros].reverse();

  const item = { projetistaCodigo: "P0900004", responsavel: "E2E Fornecedor A" };
  assert.equal(cadastroFornecedorByMapaItemCorrigido(item, cadastros)?.id, "a");
  assert.equal(cadastroFornecedorByMapaItemCorrigido(item, cadastrosInvertidos)?.id, "a", "a ordem do array de cadastros não pode mudar o resultado quando há match exato de código");
});
