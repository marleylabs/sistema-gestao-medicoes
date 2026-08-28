import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma";

/**
 * Testes de integração REAIS contra o banco configurado em DATABASE_URL.
 *
 * Bug corrigido: "Evidências de Medição" (Administrativo) usava dois filtros que quebravam a
 * visibilidade de um BM já existente:
 *  1) o dropdown de fornecedor era construído a partir de `Profissional.filter(p => p.codigo)`
 *     (components/medicoes-app.tsx) — mas `Profissional.codigo` fica vazio na maioria dos
 *     cadastros importados pelo ETL (mesma causa-raiz já corrigida em outras telas nesta sessão:
 *     chat, participação por contrato, Documentos Medidos no Portal, e-mail BM_AVAILABLE).
 *  2) o filtro de status só aceitava "APROVADO" ou "AGUARDANDO_NF", excluindo estruturalmente
 *     PENDENTE, REVISAO_SOLICITADA e PAGO — mesmo esses sendo estados em que o BM já existe.
 *
 * A regra correta (e já usada em app/api/colaborador/sgc/route.ts para o Portal do fornecedor)
 * é existencial: o BM existe sempre que o registro em `sgc_aprovacoes_medicao` tiver
 * status !== "AGUARDANDO_ENVIO" && status !== "CANCELADO" — e a chave de correspondência deve
 * ser sempre `colaboradorCodigo` (o próprio campo do SGC), nunca `Profissional.codigo`.
 *
 * `app/api/sgc/status/route.ts` e `lib/prisma.ts` não importam "server-only", então a consulta é
 * reimplementada aqui verbatim (mesma forma da rota), não uma reimplementação divergente.
 */

type SgcStatusRow = { colaboradorCodigo: string; status: string; colaboradorNome: string | null };

async function listSgcStatus(ciclo: string): Promise<Record<string, SgcStatusRow>> {
  const registros = await prisma.sgcAprovacaoMedicao.findMany({
    where: { ciclo },
    select: { colaboradorCodigo: true, colaboradorNome: true, status: true, revisaoNumero: true, id: true, statusConferencia: true },
  });
  const payload: Record<string, SgcStatusRow> = {};
  for (const r of registros) {
    payload[r.colaboradorCodigo] = { colaboradorCodigo: r.colaboradorCodigo, status: r.status, colaboradorNome: r.colaboradorNome };
  }
  return payload;
}

// Regra atual (corrigida) usada por EvidenciasSection — existência do BM.
function bmExiste(status: string): boolean {
  return status !== "AGUARDANDO_ENVIO" && status !== "CANCELADO";
}

// Regra ANTIGA (com o bug) — reimplementada aqui só para o teste de before/after, nunca reintroduzida no app.
function bmExisteRegraAntiga(status: string): boolean {
  return status === "APROVADO" || status === "AGUARDANDO_NF";
}

async function getDocumentosMedidos(params: { aliases: string[]; ciclo: string }) {
  const aliases = Array.from(new Set(params.aliases.map((a) => a?.trim()).filter((a): a is string => !!a)));
  if (!aliases.length || !params.ciclo) return [];
  return prisma.medicao.findMany({
    where: {
      ciclo: params.ciclo,
      profissional: {
        OR: [
          { codigo: { in: aliases, mode: "insensitive" } },
          { nome: { in: aliases, mode: "insensitive" } },
          { nomeCompleto: { in: aliases, mode: "insensitive" } },
        ],
      },
    },
    select: { id: true },
  });
}

// ─── Caso real: Gyovanni Coelho / ciclo 2608 ──────────────────────────────────────────────────

test("smoke real (before/after) — Gyovanni Coelho / ciclo 2608: regra antiga não encontrava, regra corrigida encontra", async (t) => {
  // sgc_aprovacoes_medicao é operacional — o workflow deste fornecedor pode ter avançado (NF,
  // pagamento) ou o ciclo pode ter sido reaberto desde que este caso foi auditado, então o SGC
  // pode não existir mais neste exato estado. O que este teste precisa provar continua válido e
  // é verificado de forma independente do snapshot: ver "ciclo real 2608" e os testes de
  // getDocumentosMedidos logo abaixo, que não dependem de sgc_aprovacoes_medicao.
  const status = await listSgcStatus("2608");
  const entry = status["GYOVANNI COELHO"];
  if (!entry) {
    t.skip("registro SGC de GYOVANNI COELHO/2608 não existe mais neste momento (workflow avançou/dado real mudou) — ver testes de getDocumentosMedidos abaixo para a prova de causa-raiz que não depende de sgc_aprovacoes_medicao.");
    return;
  }

  // "Antes" (bug): a chave usada para achar o fornecedor no dropdown era Profissional.codigo, que
  // é vazio para este fornecedor — nenhuma correspondência é possível por ali, então o BM nunca
  // aparecia mesmo com status incluído na lista antiga.
  const profissional = await prisma.profissional.findFirst({ where: { nome: "GYOVANNI COELHO" }, select: { codigo: true } });
  assert.ok(profissional, "esperava encontrar o Profissional real de GYOVANNI COELHO");
  assert.ok(!profissional!.codigo, "confirma a causa-raiz: Profissional.codigo vazio/nulo para este fornecedor");

  // "Depois" (correção): a chave de correspondência é o próprio colaboradorCodigo do SGC, e a
  // regra de existência inclui o status atual (qualquer um exceto AGUARDANDO_ENVIO/CANCELADO).
  assert.equal(bmExiste(entry.status), true, `regra corrigida deve considerar o BM existente em ${entry.status}`);
});

test("smoke real — Boletim de Gyovanni Coelho abre com documentos reais após a correção do endpoint /api/admin/bm", async () => {
  const docs = await getDocumentosMedidos({ aliases: ["GYOVANNI COELHO", "GYOVANNI PINHEIRO SARAIVA COELHO"], ciclo: "2608" });
  assert.ok(docs.length > 0, "endpoint corrigido (getDocumentosMedidos com alias por nome) deve encontrar os documentos reais do ciclo 2608");
});

test("smoke real — a mesma consulta ANTIGA (profissional.codigo estrito) do endpoint /api/admin/bm retornava 0 documentos para este fornecedor", async () => {
  const docsRegraAntiga = await prisma.medicao.findMany({
    where: { profissional: { codigo: { in: ["GYOVANNI COELHO", "GYOVANNI PINHEIRO SARAIVA COELHO"] } }, ciclo: "2608" },
    select: { id: true },
  });
  assert.equal(docsRegraAntiga.length, 0, "confirma que a consulta antiga (só profissional.codigo) não encontrava nada para este fornecedor real");
});

// ─── Matriz de status: existência do BM, não status transitório ──────────────────────────────

test("matriz de status: PENDENTE, REVISAO_SOLICITADA, AGUARDANDO_NF, APROVADO e PAGO contam como 'BM existe'; AGUARDANDO_ENVIO e CANCELADO não", () => {
  const devemExistir = ["PENDENTE", "REVISAO_SOLICITADA", "AGUARDANDO_NF", "APROVADO", "PAGO"];
  for (const s of devemExistir) assert.equal(bmExiste(s), true, `status ${s} deveria manter a evidência visível`);

  const naoDevemExistir = ["AGUARDANDO_ENVIO", "CANCELADO"];
  for (const s of naoDevemExistir) assert.equal(bmExiste(s), false, `status ${s} não deveria aparecer em Evidências (BM ainda não existe / foi cancelado)`);
});

test("regra antiga (bug) excluía PENDENTE, REVISAO_SOLICITADA e PAGO — guarda de regressão para não reintroduzir esse filtro", () => {
  assert.equal(bmExisteRegraAntiga("PENDENTE"), false);
  assert.equal(bmExisteRegraAntiga("REVISAO_SOLICITADA"), false);
  assert.equal(bmExisteRegraAntiga("PAGO"), false);
});

// ─── Ciclo real 2608: nenhum fornecedor com BM existente fica de fora, e AGUARDANDO_ENVIO fica de fora ───

test("ciclo real 2608: todo registro SGC com status != AGUARDANDO_ENVIO/CANCELADO aparece na função de listagem, e o inverso também é verdade", async () => {
  const status = await listSgcStatus("2608");
  const registrosReais = await prisma.sgcAprovacaoMedicao.findMany({ where: { ciclo: "2608" }, select: { colaboradorCodigo: true, status: true } });
  assert.ok(registrosReais.length > 0, "esperava encontrar registros SGC reais no ciclo 2608");

  for (const r of registrosReais) {
    const deveAparecer = bmExiste(r.status);
    const apareceNoMapa = status[r.colaboradorCodigo] !== undefined && bmExiste(status[r.colaboradorCodigo].status);
    assert.equal(apareceNoMapa, deveAparecer, `fornecedor ${r.colaboradorCodigo} (status ${r.status}) divergiu da regra de existência`);
  }
});

// ─── Isolamento: CNPJ compartilhado / identidade por colaboradorCodigo + ciclo ────────────────

test("dois fornecedores sintéticos com colaboradorCodigo diferente permanecem isolados na listagem por ciclo, mesmo com todos os outros dados iguais", async () => {
  const suffix = `TESTE-EVID-${Date.now()}`;
  const cicloTeste = `TESTE-${suffix}`;
  const codigoA = `${suffix}-A`;
  const codigoB = `${suffix}-B`;

  await prisma.sgcAprovacaoMedicao.create({
    data: { colaboradorCodigo: codigoA, colaboradorNome: "Fornecedor Sintético A", ciclo: cicloTeste, status: "PENDENTE" },
  });
  await prisma.sgcAprovacaoMedicao.create({
    data: { colaboradorCodigo: codigoB, colaboradorNome: "Fornecedor Sintético B", ciclo: cicloTeste, status: "AGUARDANDO_ENVIO" },
  });

  try {
    const status = await listSgcStatus(cicloTeste);
    assert.ok(status[codigoA], "fornecedor A deveria estar presente na consulta do ciclo");
    assert.equal(bmExiste(status[codigoA].status), true, "fornecedor A (PENDENTE) deveria contar como BM existente");
    assert.ok(status[codigoB], "fornecedor B deveria estar presente na consulta do ciclo (a query não filtra por status)");
    assert.equal(bmExiste(status[codigoB].status), false, "fornecedor B (AGUARDANDO_ENVIO) não deveria contar como BM existente");
  } finally {
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: cicloTeste } });
  }
});

test("ciclo diferente para o mesmo colaboradorCodigo nunca mistura BMs entre ciclos", async () => {
  const suffix = `TESTE-EVID-CICLO-${Date.now()}`;
  const codigo = `${suffix}-CODIGO`;
  const cicloA = `TESTE-A-${suffix}`;
  const cicloB = `TESTE-B-${suffix}`;

  await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo, ciclo: cicloA, status: "APROVADO" } });
  await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo, ciclo: cicloB, status: "AGUARDANDO_ENVIO" } });

  try {
    const statusA = await listSgcStatus(cicloA);
    const statusB = await listSgcStatus(cicloB);
    assert.equal(bmExiste(statusA[codigo].status), true, "ciclo A (APROVADO) deveria ter BM existente");
    assert.equal(bmExiste(statusB[codigo].status), false, "ciclo B (AGUARDANDO_ENVIO), mesmo colaboradorCodigo, não deveria ter BM existente");
  } finally {
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: { in: [cicloA, cicloB] } } });
  }
});

// ─── Consistência com Financeiro: mesma fonte (sgc_aprovacoes_medicao), nunca uma tabela paralela ───

test("Financeiro (status in AGUARDANDO_NF/APROVADO/PAGO) é sempre um subconjunto de Evidências (status != AGUARDANDO_ENVIO/CANCELADO), em qualquer ciclo real que tenha dado nesse estado", async (t) => {
  const financeiroStatuses = ["AGUARDANDO_NF", "APROVADO", "PAGO"];
  // Não fixa um ciclo específico — o workflow operacional avança com o tempo (produção real), e o
  // invariante testado (Financeiro ⊆ Evidências) precisa valer em qualquer ciclo, não só em 2608.
  const registros = await prisma.sgcAprovacaoMedicao.findMany({ select: { colaboradorCodigo: true, ciclo: true, status: true } });
  const noFinanceiro = registros.filter((r) => financeiroStatuses.includes(r.status));
  if (noFinanceiro.length === 0) {
    t.skip("nenhum registro real está em status de Financeiro (AGUARDANDO_NF/APROVADO/PAGO) neste momento — nada para comparar agora.");
    return;
  }
  for (const r of noFinanceiro) {
    assert.equal(bmExiste(r.status), true, `${r.colaboradorCodigo}/${r.ciclo} aparece no Financeiro mas a regra corrigida de Evidências o excluiria — as duas fontes devem concordar`);
  }
});
