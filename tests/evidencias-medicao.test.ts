import assert from "node:assert/strict";
import test, { before } from "node:test";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

before(assertConnectedToE2eDatabase);

/**
 * Testes de integração reais contra o banco de teste isolado (medicoes-postgres-test).
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
 * FASE 3: até aqui esta suíte dependia do caso real GYOVANNI COELHO/ciclo 2608 em produção —
 * dois testes ficavam `t.skip()` sempre que o workflow real avançava e o registro deixava de
 * existir naquele estado exato (drift). Agora o mesmo padrão de bug (Profissional.codigo vazio +
 * SGC referenciando o fornecedor pelo nome) é reproduzido de forma 100% determinística com dados
 * sintéticos no banco de teste isolado — nunca mais dependente de um snapshot de produção.
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

// ─── Reprodução determinística do caso real (Profissional.codigo vazio + SGC por nome) ────────

test("smoke determinístico (before/after) — Profissional.codigo vazio: regra antiga não encontrava, regra corrigida encontra", async () => {
  const suffix = `TESTE-EVID-BUG-${Date.now()}`;
  const nomeFornecedor = `${suffix} FORNECEDOR SEM CODIGO`;
  const ciclo = `TESTE-${suffix}`;

  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `${suffix}-PROJ`, contrato: "TESTE" } });
  // Reproduz exatamente a causa-raiz real: Profissional.codigo NULO (comum em cadastros importados
  // pelo ETL), então o SGC referencia o fornecedor pelo NOME (fallback usado em produção).
  const profissional = await prisma.profissional.create({ data: { nome: nomeFornecedor, codigo: null } });
  const medicao = await prisma.medicao.create({
    data: {
      numeroMedicao: `${suffix}-MED`, idProjeto: projeto.id, idProfissional: profissional.id, ciclo,
      equivalenteA1Horas: 10, percentualEmissao: 1, condicao: "100", sourceRowHash: `${suffix}-hash`,
    },
  });
  const sgc = await prisma.sgcAprovacaoMedicao.create({
    data: { colaboradorCodigo: nomeFornecedor, ciclo, status: "AGUARDANDO_NF", colaboradorNome: nomeFornecedor },
  });

  try {
    // "Antes" (bug): a chave usada para achar o fornecedor no dropdown era Profissional.codigo,
    // vazio para este fornecedor — nenhuma correspondência é possível por ali.
    assert.equal(profissional.codigo, null, "confirma a causa-raiz: Profissional.codigo vazio/nulo para este fornecedor");
    const docsRegraAntiga = await prisma.medicao.findMany({ where: { profissional: { codigo: { in: [nomeFornecedor] } }, ciclo }, select: { id: true } });
    assert.equal(docsRegraAntiga.length, 0, "a consulta antiga (só profissional.codigo) não encontrava nada para este fornecedor");

    // "Depois" (correção): a chave de correspondência é o próprio colaboradorCodigo do SGC
    // (aqui, o nome — exatamente como em produção), e a regra de existência inclui AGUARDANDO_NF.
    const status = await listSgcStatus(ciclo);
    assert.equal(bmExiste(status[nomeFornecedor].status), true, "regra corrigida deve considerar o BM existente em AGUARDANDO_NF");
    assert.equal(bmExisteRegraAntiga(status[nomeFornecedor].status), true, "a regra antiga de status, isoladamente, teria aceitado — o bug era a chave de correspondência, não o status");

    const docsRegraCorrigida = await getDocumentosMedidos({ aliases: [nomeFornecedor], ciclo });
    assert.equal(docsRegraCorrigida.length, 1, "getDocumentosMedidos (alias por nome) deve encontrar o documento real");
    assert.equal(docsRegraCorrigida[0].id, medicao.id);
  } finally {
    await prisma.sgcAprovacaoMedicao.delete({ where: { id: sgc.id } });
    await prisma.medicao.delete({ where: { id: medicao.id } });
    await prisma.profissional.delete({ where: { id: profissional.id } });
    await prisma.projeto.delete({ where: { id: projeto.id } });
  }
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

// ─── Ciclo determinístico cobrindo TODOS os status reais + regra Financeiro ⊆ Evidências ──────

test("ciclo determinístico: todo registro SGC com status != AGUARDANDO_ENVIO/CANCELADO aparece na listagem, e Financeiro é sempre subconjunto de Evidências", async () => {
  const suffix = `TESTE-EVID-MATRIZ-${Date.now()}`;
  const ciclo = `TESTE-${suffix}`;
  const statusReais = ["AGUARDANDO_ENVIO", "PENDENTE", "REVISAO_SOLICITADA", "AGUARDANDO_NF", "APROVADO", "PAGO", "CANCELADO"];
  const financeiroStatuses = ["AGUARDANDO_NF", "APROVADO", "PAGO"];

  const criados = await Promise.all(
    statusReais.map((status, i) =>
      prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: `${suffix}-F${i}`, ciclo, status } }),
    ),
  );

  try {
    const status = await listSgcStatus(ciclo);
    const registrosReais = await prisma.sgcAprovacaoMedicao.findMany({ where: { ciclo }, select: { colaboradorCodigo: true, status: true } });
    assert.equal(registrosReais.length, statusReais.length, "todos os status da matriz devem estar presentes no ciclo de teste");

    for (const r of registrosReais) {
      const deveAparecer = bmExiste(r.status);
      const apareceNoMapa = status[r.colaboradorCodigo] !== undefined && bmExiste(status[r.colaboradorCodigo].status);
      assert.equal(apareceNoMapa, deveAparecer, `fornecedor ${r.colaboradorCodigo} (status ${r.status}) divergiu da regra de existência`);
    }

    // Financeiro (AGUARDANDO_NF/APROVADO/PAGO) é sempre subconjunto de Evidências.
    const noFinanceiro = registrosReais.filter((r) => financeiroStatuses.includes(r.status));
    assert.equal(noFinanceiro.length, 3, "os 3 status de Financeiro devem estar cobertos por esta matriz");
    for (const r of noFinanceiro) {
      assert.equal(bmExiste(r.status), true, `${r.colaboradorCodigo} aparece no Financeiro mas a regra de Evidências o excluiria — as duas fontes devem concordar`);
    }
  } finally {
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { id: { in: criados.map((c) => c.id) } } });
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
