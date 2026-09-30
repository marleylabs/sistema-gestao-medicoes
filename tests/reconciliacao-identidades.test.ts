import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { aplicarPar, auditar, avaliar, carregarCadastros, totalMovido, type Par } from "../scripts/lib/reconciliacao-identidades";

/**
 * Reconciliação de identidades (legado do ETL → canônico do CadastroFornecedor) contra o banco E2E.
 * Cada caso roda numa transação que é SEMPRE desfeita (ROLLBACK), exceto o teste de rollback
 * integral, que usa fixtures commitadas e as remove no fim.
 */

const ROLLBACK = "ROLLBACK_TESTE_RECONCILIACAO";
// Só letras: dígitos no rótulo fariam o rótulo ser classificado como "não pessoa".
const letras = () => Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

before(async () => { await assertConnectedToE2eDatabase(); });
after(async () => { await prisma.$disconnect(); });

async function desfeita(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(async (tx) => { await fn(tx); throw new Error(ROLLBACK); }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }
}

/** Cenário: cadastro canônico sem Profissional + legado artificial com referências em todas as tabelas. */
async function cenario(tx: Prisma.TransactionClient, opts: { legado?: string; canonico?: string } = {}) {
  const S = letras();
  const canonico = opts.canonico ?? `FULANO${S} DE TAL SOUZA`;
  const legado = opts.legado ?? `FULANO${S} SOUZA`;
  await tx.cadastroFornecedor.create({ data: { colaboradorCodigo: canonico, responsavel: canonico, razaoSocial: `${canonico} LTDA`, cnpjNormalizado: "11222333000181" } });
  const leg = await tx.profissional.create({ data: { nome: legado, codigo: legado } });
  const projeto = await tx.projeto.create({ data: { codigoProjeto: `RECON-${S}` } });
  const medicao = await tx.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: leg.id, ciclo: "2601", numeroDocumento: `DOC-${S}`, tipo2: "DG", condicao: "100", equivalenteA1Horas: 2, percentualEmissao: 1, sourceRowHash: `recon-${S}-m` } });
  await tx.mapaPagamentoItem.create({ data: { ciclo: "2601", ordem: 1, projetistaCodigo: legado, responsavel: legado, valor: 1234.56, sourceRowHash: `recon-${S}-mapa` } });
  await tx.bmAuxMedicao.create({ data: { responsavelCodigo: legado, ciclo: "2601", sourceRowHash: `recon-${S}-bm` } });
  const sgc = await tx.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: legado, colaboradorNome: legado, ciclo: "2601", status: "AGUARDANDO_NF" } });
  await tx.sgcLog.create({ data: { colaboradorCodigo: legado, ciclo: "2601", acao: "ENVIO", sgcId: sgc.id } });
  return { S, canonico, legado, legadoId: leg.id, medicaoId: medicao.id, sgcId: sgc.id };
}

async function avaliarPar(tx: Prisma.TransactionClient, par: Par, lista: Par[] = [par]) {
  return avaliar(tx, par, await carregarCadastros(tx), lista);
}

test("DRY-RUN: canônico ausente é detectado, referências contadas e nada é gravado", async () => {
  await desfeita(async (tx) => {
    const c = await cenario(tx);
    // Contagens restritas às fixtures deste teste (outros arquivos rodam em paralelo no mesmo banco).
    const doTeste = { OR: [{ codigo: c.canonico }, { codigo: c.legado }] };
    const antes = await tx.profissional.count({ where: doTeste });
    const a = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    assert.equal(a.status, "APROVAR", a.motivos.join("; "));
    assert.equal(a.canonico, null);
    assert.ok(a.motivos.some((m) => m.includes("canônico ausente")));
    assert.deepEqual({ ...a.refsLegado }, { medicoes: 1, coordenador: 0, mapa: 1, bmAux: 1, sgc: 1, sgcLogs: 1, divergencias: 0 });
    assert.equal(await tx.profissional.count({ where: doTeste }), antes, "avaliar não escreve");
  });
  const cli = fs.readFileSync(path.join(__dirname, "..", "scripts", "prod-reconciliar-identidades.ts"), "utf8");
  assert.match(cli.slice(cli.indexOf("if (!apply) {"), cli.indexOf("// ─── APPLY")), /SET TRANSACTION READ ONLY/);
});

test("APPLY: cria o canônico, move só a identidade, preserva o legado e valores; segunda execução = 0 mudanças", async () => {
  await desfeita(async (tx) => {
    const c = await cenario(tx);
    const medAntes = await tx.medicao.findUniqueOrThrow({ where: { id: c.medicaoId } });
    const a = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    const m = await aplicarPar(tx, a);
    assert.equal(m.canonicoCriado, true);
    assert.deepEqual({ ...m.movidos }, { medicoes: 1, coordenador: 0, mapa: 1, bmAux: 1, sgc: 1, sgcLogs: 1, divergencias: 0 });
    const canonico = await tx.profissional.findFirstOrThrow({ where: { codigo: c.canonico } });
    assert.equal(canonico.nomeCompleto, c.canonico);
    const medDepois = await tx.medicao.findUniqueOrThrow({ where: { id: c.medicaoId } });
    assert.equal(medDepois.idProfissional, canonico.id);
    for (const campo of ["ciclo", "sourceRowHash", "valorMedicao", "numeroDocumento", "createdAt"] as const) assert.deepEqual(medDepois[campo], medAntes[campo], campo);
    assert.equal((await tx.mapaPagamentoItem.findFirstOrThrow({ where: { sourceRowHash: `recon-${c.S}-mapa` } })).valor.toString(), "1234.56");
    assert.equal((await tx.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: c.sgcId } })).status, "AGUARDANDO_NF");
    assert.ok(await tx.profissional.findUnique({ where: { id: c.legadoId } }), "legado preservado");

    const admin = await tx.usuario.findFirstOrThrow({ where: { perfil: "ADMIN" } });
    await auditar(tx, admin, a, m, "fp-teste");
    assert.equal(await tx.adminAuditLog.count({ where: { action: "IDENTIDADE_RECONCILIADA", targetId: canonico.id } }), 1);

    const doTeste = { OR: [{ codigo: c.canonico }, { codigo: c.legado }] };
    const perfis = await tx.profissional.count({ where: doTeste });
    const b = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    assert.equal(b.status, "APROVAR");
    assert.ok(b.motivos.some((x) => x.includes("já reconciliado")));
    const m2 = await aplicarPar(tx, b);
    assert.equal(totalMovido(m2), 0, "idempotente");
    assert.equal(await tx.profissional.count({ where: doTeste }), perfis, "sem Profissional duplicado");
    assert.equal(perfis, 2, "exatamente o legado preservado + o canônico");
  });
});

test("COLISÃO: SGC do canônico no mesmo ciclo → REVISAR (nunca escolhe automaticamente)", async () => {
  await desfeita(async (tx) => {
    const c = await cenario(tx);
    await tx.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: c.canonico, colaboradorNome: c.canonico, ciclo: "2601" } });
    const a = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    assert.equal(a.status, "REVISAR");
    assert.ok(a.colisoes.some((x) => x.startsWith("SGC 2601")), a.motivos.join("; "));
  });
});

test("AMBIGUIDADE: o rótulo sugere dois cadastros → REVISAR", async () => {
  await desfeita(async (tx) => {
    const c = await cenario(tx);
    const outro = `${c.legado.split(" ")[0]} OUTRO SOUZA`;
    await tx.cadastroFornecedor.create({ data: { colaboradorCodigo: outro, responsavel: outro, razaoSocial: "X LTDA", cnpjNormalizado: "11222333000181" } });
    const a = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    assert.equal(a.status, "REVISAR");
    assert.ok(a.motivos.some((m) => m.startsWith("ambíguo")), a.motivos.join("; "));
  });
});

test("EMPRESA e NÃO-PESSOA: rótulo empresarial → REVISAR; GRD/documento → REJEITAR", async () => {
  await desfeita(async (tx) => {
    const S = letras();
    const c = await cenario(tx, { legado: `ALFA${S} ENGENHARIA`, canonico: `ALFA${S} ENGENHARIA E PROJETOS` });
    assert.equal((await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico })).status, "REVISAR");
    const g = await cenario(tx, { legado: `GRD-SE-KN-${S}-0014`, canonico: `GRD-SE-KN-${S}-0014 X` });
    assert.equal((await avaliarPar(tx, { legado: g.legado, codigoCanonico: g.canonico })).status, "REJEITAR");
  });
});

test("PROTEÇÕES: legado com Usuario de mesmo nome → REVISAR; legado com CadastroFornecedor próprio → REJEITAR", async () => {
  await desfeita(async (tx) => {
    const c = await cenario(tx);
    await tx.usuario.create({ data: { usuario: `U${c.S}`, nome: c.legado, senhaHash: "x", perfil: "COLABORADOR" } });
    const a = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    assert.equal(a.status, "REVISAR");
    assert.ok(a.motivos.some((m) => m.includes("não é artefato do ETL")), a.motivos.join("; "));
  });
  await desfeita(async (tx) => {
    const c = await cenario(tx);
    await tx.cadastroFornecedor.create({ data: { colaboradorCodigo: c.legado, responsavel: c.legado, razaoSocial: "Y LTDA", cnpjNormalizado: "11222333000181" } });
    const a = await avaliarPar(tx, { legado: c.legado, codigoCanonico: c.canonico });
    assert.equal(a.status, "REJEITAR");
    assert.ok(a.motivos.some((m) => m.includes("CadastroFornecedor próprio")), a.motivos.join("; "));
  });
});

test("ROLLBACK INTEGRAL: falha no meio da transação não deixa nenhuma mudança", async () => {
  // Fixtures commitadas (fora da transação) para poder conferir o estado depois do rollback.
  const S = letras();
  const canonico = `BELTRANO${S} DE SOUZA LIMA`; const legado = `BELTRANO${S} LIMA`;
  const cad = await prisma.cadastroFornecedor.create({ data: { colaboradorCodigo: canonico, responsavel: canonico, razaoSocial: "Z LTDA", cnpjNormalizado: "11222333000181" } });
  const leg = await prisma.profissional.create({ data: { nome: legado, codigo: legado } });
  const mapa = await prisma.mapaPagamentoItem.create({ data: { ciclo: "2601", ordem: 1, projetistaCodigo: legado, valor: 10, sourceRowHash: `recon-rb-${S}` } });
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const a = await avaliarPar(tx, { legado, codigoCanonico: canonico });
      assert.equal(a.status, "APROVAR", a.motivos.join("; "));
      await aplicarPar(tx, a);
      throw new Error("falha simulada no segundo item");
    }), /falha simulada/);
    assert.equal(await prisma.profissional.count({ where: { codigo: canonico } }), 0, "canônico não ficou criado");
    assert.equal((await prisma.mapaPagamentoItem.findUniqueOrThrow({ where: { id: mapa.id } })).projetistaCodigo, legado, "referência não foi movida");
    assert.ok(await prisma.profissional.findUnique({ where: { id: leg.id } }));
  } finally {
    await prisma.mapaPagamentoItem.deleteMany({ where: { id: mapa.id } });
    await prisma.profissional.deleteMany({ where: { OR: [{ id: leg.id }, { codigo: canonico }] } });
    await prisma.cadastroFornecedor.deleteMany({ where: { id: cad.id } });
  }
});

test("APPLY do CLI exige todas as travas e roda numa única transação", () => {
  const cli = fs.readFileSync(path.join(__dirname, "..", "scripts", "prod-reconciliar-identidades.ts"), "utf8");
  const apply = cli.slice(cli.indexOf("// ─── APPLY"));
  for (const trava of [
    /ALLOW_PROD_IDENTITY_RECONCILIATION !== "true"/,
    /"--confirm"\) !== "RECONCILIAR_IDENTIDADES_PRODUCAO"/,
    /argValue\("--alvo"\) !== alvoDb/,
    /SHA-256 do backup não confere/,
    /admin\.perfil !== "ADMIN" \|\| !admin\.ativo/,
    /bloqueados\.length\) throw/,
    /fpInformado !== fp/,
  ]) assert.match(apply, trava);
  assert.equal((apply.match(/prisma\.\$transaction\(/g) ?? []).length, 1, "uma única transação para todos os pares");
  const lib = fs.readFileSync(path.join(__dirname, "..", "scripts", "lib", "reconciliacao-identidades.ts"), "utf8");
  assert.doesNotMatch(lib, /profissional\.(delete|deleteMany)\(/, "o legado nunca é apagado");
  assert.doesNotMatch(lib, /cnpj[^\n]*(equals|===)/i, "CNPJ nunca define identidade");
});
