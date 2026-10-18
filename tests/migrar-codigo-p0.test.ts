import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// Migração para o P0 (docs/brain/specs/p2-vinculo-login-profissional.md): dry-run (T1) e aplicar,
// medir e reverter (T2). Só os logins desta suíte são migrados: o resto do banco de teste não muda.
const sufixo = `MIGP0${Date.now()}`;
const n = String(Date.now()).slice(-5);
const login = (letra: number) => `P07${letra}${n}`;
const L = { A: login(1), B: login(2), C: login(3), D: login(4), F1: login(5), F2: login(6), G: login(7), I: login(8), ADM: login(9), J: login(0) };
const codigo = (x: string) => `${x} ${sufixo}`;
const ciclo = `28${n.slice(-2)}`;
type Modulo = typeof import("../lib/migracao-codigo-p0");
let m: Modulo;
let getColaboradorEscopo: typeof import("../lib/colaborador-alias").getColaboradorEscopo;
let resolverIdentidadeOperacional: typeof import("../lib/profissional-identidade").resolverIdentidadeOperacional;
let plano: Awaited<ReturnType<Modulo["planejarMigracaoP0"]>>;
let profissionalG: string;
let sgcG: string;

async function fornecedor(loginUsuario: string, nome: string, codigoCadastro: string) {
  await db.usuario.create({ data: { usuario: loginUsuario, nome, perfil: "COLABORADOR", senhaHash: "x" } });
  await db.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigoCadastro, responsavel: nome, razaoSocial: nome } });
}

before(async () => {
  await assertConnectedToE2eDatabase();
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  m = await import("../lib/migracao-codigo-p0");
  ({ getColaboradorEscopo } = await import("../lib/colaborador-alias"));
  ({ resolverIdentidadeOperacional } = await import("../lib/profissional-identidade"));

  await db.usuario.create({ data: { usuario: L.ADM, nome: `ADMIN ${sufixo}`, perfil: "ADMIN", senhaHash: "x" } });
  // A: código antigo é o nome (convenção atual) → migrável, com 2 linhas no mapa (uma com caixa/espaço diferente).
  await db.profissional.create({ data: { codigo: codigo("A"), nome: codigo("A") } });
  await fornecedor(L.A, `NOME A ${sufixo}`, codigo("A"));
  await db.mapaPagamentoItem.createMany({
    data: [
      { ciclo, ordem: 1, projetistaCodigo: codigo("A"), sourceRowHash: `${sufixo}-1` },
      { ciclo, ordem: 2, projetistaCodigo: ` ${codigo("A").toLowerCase()} `, sourceRowHash: `${sufixo}-2` },
    ],
  });
  // B: nome do usuário bate com dois cadastros → sem identidade (falha fechado).
  await db.usuario.create({ data: { usuario: L.B, nome: `NOME B ${sufixo}`, perfil: "COLABORADOR", senhaHash: "x" } });
  await db.cadastroFornecedor.createMany({
    data: [
      { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigo("B1"), responsavel: `NOME B ${sufixo}`, razaoSocial: "B1" },
      { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigo("B2"), responsavel: `NOME B ${sufixo}`, razaoSocial: "B2" },
    ],
  });
  // C: o login já é o código de OUTRO Profissional.
  await db.profissional.create({ data: { codigo: codigo("C"), nome: codigo("C") } });
  await db.profissional.create({ data: { codigo: L.C, nome: `OUTRO ${sufixo}` } });
  await fornecedor(L.C, `NOME C ${sufixo}`, codigo("C"));
  // D: já migrado.
  await db.profissional.create({ data: { codigo: L.D, nome: codigo("D") } });
  await fornecedor(L.D, `NOME D ${sufixo}`, L.D);
  // F1 e F2: dois logins para o mesmo Profissional.
  await db.profissional.create({ data: { codigo: codigo("F"), nome: codigo("F") } });
  await fornecedor(L.F1, `NOME F1 ${sufixo}`, codigo("F"));
  await fornecedor(L.F2, `NOME F2 ${sufixo}`, codigo("F"));
  // I: o código antigo já é alias de OUTRO Profissional → depois da troca, a planilha ficaria ambígua.
  await db.profissional.create({ data: { codigo: codigo("I"), nome: codigo("I") } });
  const dono = await db.profissional.create({ data: { codigo: codigo("DONO"), nome: codigo("DONO") } });
  await db.profissionalAlias.create({ data: { profissionalId: dono.id, alias: codigo("I"), aliasNormalizado: codigo("I").toUpperCase(), origem: "MANUAL" } });
  await fornecedor(L.I, `NOME I ${sufixo}`, codigo("I"));
  // G: migrável com uma linha em cada tabela do inventário, inclusive BM PAGO.
  profissionalG = (await db.profissional.create({ data: { codigo: codigo("G"), nome: codigo("G") } })).id;
  await fornecedor(L.G, `NOME G ${sufixo}`, codigo("G"));
  const sgc = await db.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo("G"), ciclo, status: "PAGO", pagoAt: new Date("2026-09-30T12:00:00Z") } });
  sgcG = sgc.id;
  await db.divergenciaMedicao.create({
    data: { sgcId: sgc.id, colaboradorCodigo: codigo("G"), ciclo, nrVale: `${sufixo}-V`, fornecedorFormato: "A1", fornecedorA1eqHh: "1.5", fornecedorPercentualEmissao: "100", fornecedorTipo: "DOC" },
  });
  await db.bmAuxMedicao.create({ data: { responsavelCodigo: codigo("G"), ciclo, valorMedicao: "123.4567", sourceRowHash: `${sufixo}-aux` } });
  await db.sgcLog.create({ data: { sgcId: sgc.id, colaboradorCodigo: codigo("G"), ciclo, acao: "TESTE" } });
  await db.mapaPagamentoItem.create({ data: { ciclo, ordem: 3, projetistaCodigo: codigo("G"), sourceRowHash: `${sufixo}-g` } });
  // J: fornecedor inativo (cadastro e usuário inativos) também migra.
  await db.profissional.create({ data: { codigo: codigo("J"), nome: codigo("J") } });
  await fornecedor(L.J, `NOME J ${sufixo}`, codigo("J"));
  await db.usuario.update({ where: { usuario: L.J }, data: { ativo: false } });
  // Profissional sem login.
  await db.profissional.create({ data: { codigo: codigo("SEM"), nome: codigo("SEM") } });

  plano = await m.planejarMigracaoP0();
});

after(async () => {
  await db.adminAuditLog.deleteMany({ where: { adminUsuario: L.ADM } });
  await db.sgcLog.deleteMany({ where: { sgcId: sgcG } });
  await db.divergenciaMedicao.deleteMany({ where: { sgcId: sgcG } });
  await db.sgcAprovacaoMedicao.deleteMany({ where: { id: sgcG } });
  await db.bmAuxMedicao.deleteMany({ where: { sourceRowHash: { startsWith: sufixo } } });
  await db.mapaPagamentoItem.deleteMany({ where: { sourceRowHash: { startsWith: sufixo } } });
  await db.cadastroFornecedor.deleteMany({ where: { responsavel: { contains: sufixo } } });
  await db.usuario.deleteMany({ where: { usuario: { in: Object.values(L) } } });
  await db.profissional.deleteMany({ where: { OR: [{ nome: { contains: sufixo } }, { codigo: { contains: sufixo } }] } });
});

const doLogin = (l: string) => plano.usuarios.find((u) => u.login === l);

test("dry-run P0: fornecedor com código antigo é MIGRAVEL e conta as linhas a reescrever", () => {
  const a = doLogin(L.A);
  assert.equal(a?.classe, "MIGRAVEL");
  assert.equal(a?.linhas.mapa_pagamento_itens, 2);
  assert.equal(a?.linhas.cadastros_fornecedores, 1);
});

test("dry-run P0: sem identidade única fica SEM_IDENTIDADE", () => {
  assert.equal(doLogin(L.B)?.classe, "SEM_IDENTIDADE");
});

test("dry-run P0: login que já é código de outro Profissional é CONFLITO", () => {
  assert.deepEqual([doLogin(L.C)?.classe, doLogin(L.C)?.motivo], ["CONFLITO", "LOGIN_EM_USO"]);
});

test("dry-run P0: código já igual ao login é JA_E_P0", () => {
  assert.equal(doLogin(L.D)?.classe, "JA_E_P0");
});

test("dry-run P0: dois logins para o mesmo Profissional são CONFLITO", () => {
  for (const l of [L.F1, L.F2]) {
    assert.deepEqual([doLogin(l)?.classe, doLogin(l)?.motivo], ["CONFLITO", "PROFISSIONAL_COM_VARIOS_LOGINS"]);
  }
});

test("dry-run P0: código antigo que já é alias de outro Profissional é CONFLITO", () => {
  assert.deepEqual([doLogin(L.I)?.classe, doLogin(L.I)?.motivo], ["CONFLITO", "ALIAS_EM_USO"]);
});

test("dry-run P0: fornecedor inativo também é MIGRAVEL", () => {
  assert.equal(doLogin(L.J)?.classe, "MIGRAVEL");
});

test("dry-run P0: conta Profissionais sem login", () => {
  assert.ok(plano.profissionaisSemLogin.total >= 2, JSON.stringify(plano.profissionaisSemLogin));
});

test("dry-run P0: não grava nada", async () => {
  const [a, mapa] = await Promise.all([
    db.profissional.findUnique({ where: { codigo: codigo("A") }, select: { id: true } }),
    db.mapaPagamentoItem.findMany({ where: { sourceRowHash: { in: [`${sufixo}-1`, `${sufixo}-2`] } }, select: { projetistaCodigo: true }, orderBy: { ordem: "asc" } }),
  ]);
  assert.ok(a);
  assert.deepEqual(mapa.map((r) => r.projetistaCodigo), [codigo("A"), ` ${codigo("A").toLowerCase()} `]);
  assert.equal(await db.profissionalAlias.count({ where: { origem: "MIGRACAO_P0", alias: { contains: sufixo } } }), 0);
});

// ─── T2: aplicar, medir e reverter ───────────────────────────────────────────────────────────

test("aplicar P0: exige um ADMIN ativo e não grava nada sem ele", async () => {
  await assert.rejects(m.aplicarMigracaoP0({ adminLogin: L.A, logins: [L.G] }), /ADMIN/);
  assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: profissionalG } })).codigo, codigo("G"));
});

test("aplicar P0: troca o código em todas as tabelas, cria o alias e audita; conflito não é tocado", async () => {
  const r = await m.aplicarMigracaoP0({ adminLogin: L.ADM, logins: [L.G, L.C] });
  assert.deepEqual(r.migrados, [L.G]);
  assert.deepEqual(r.falhas, []);

  const p = await db.profissional.findUniqueOrThrow({ where: { id: profissionalG }, select: { codigo: true, nome: true } });
  assert.deepEqual(p, { codigo: L.G, nome: codigo("G") });
  const alias = await db.profissionalAlias.findMany({ where: { profissionalId: profissionalG }, select: { alias: true, origem: true, ativo: true } });
  assert.deepEqual(alias, [{ alias: codigo("G"), origem: "MIGRACAO_P0", ativo: true }]);

  assert.equal(await db.cadastroFornecedor.count({ where: { colaboradorCodigo: L.G } }), 1);
  const sgc = await db.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgcG }, select: { colaboradorCodigo: true, status: true, pagoAt: true } });
  assert.deepEqual(sgc, { colaboradorCodigo: L.G, status: "PAGO", pagoAt: new Date("2026-09-30T12:00:00Z") });
  assert.equal(await db.divergenciaMedicao.count({ where: { sgcId: sgcG, colaboradorCodigo: L.G } }), 1);
  assert.equal(await db.sgcLog.count({ where: { sgcId: sgcG, colaboradorCodigo: L.G } }), 1);
  const aux = await db.bmAuxMedicao.findUniqueOrThrow({ where: { sourceRowHash: `${sufixo}-aux` }, select: { responsavelCodigo: true, valorMedicao: true } });
  assert.equal(aux.responsavelCodigo, L.G);
  assert.equal(aux.valorMedicao.toString(), "123.4567");
  assert.equal(await db.mapaPagamentoItem.count({ where: { sourceRowHash: `${sufixo}-g`, projetistaCodigo: L.G } }), 1);

  const auditoria = await db.adminAuditLog.findMany({ where: { action: "FORNECEDOR_CODIGO_P0", targetId: profissionalG }, select: { adminUsuario: true, targetCodigo: true } });
  assert.deepEqual(auditoria, [{ adminUsuario: L.ADM, targetCodigo: L.G }]);
  // C estava em conflito: nada muda.
  assert.equal(await db.cadastroFornecedor.count({ where: { colaboradorCodigo: codigo("C") } }), 1);
});

test("aplicar P0: depois da troca, login, código antigo e nome levam ao mesmo Profissional", async () => {
  const escopo = await getColaboradorEscopo(L.G);
  assert.equal(escopo.profissionalId, profissionalG);
  assert.ok(escopo.cadastroId);
  const antigo = await resolverIdentidadeOperacional(codigo("G"));
  assert.ok(antigo.status === "RESOLVIDO" && antigo.profissionalId === profissionalG && antigo.codigoCanonico === L.G, JSON.stringify(antigo));
});

test("aplicar P0: rodar de novo não muda nada", async () => {
  const r = await m.aplicarMigracaoP0({ adminLogin: L.ADM, logins: [L.G] });
  assert.deepEqual(r.migrados, []);
  assert.equal(await db.adminAuditLog.count({ where: { action: "FORNECEDOR_CODIGO_P0", targetId: profissionalG } }), 1);
});

test("medir P0: fornecedor migrado tem login resolvendo, cadastro pelo código e as mesmas linhas", async () => {
  const medicao = await m.medirMigracaoP0({ logins: [L.G] });
  assert.deepEqual(medicao, [{ login: L.G, ok: true, problemas: [] }]);
});

test("reverter P0: volta o código antigo, remove o alias da migração e audita", async () => {
  const r = await m.reverterMigracaoP0({ adminLogin: L.ADM, logins: [L.G] });
  assert.deepEqual(r, { revertidos: [L.G], falhas: [] });
  assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: profissionalG } })).codigo, codigo("G"));
  assert.equal(await db.profissionalAlias.count({ where: { profissionalId: profissionalG } }), 0);
  assert.equal((await db.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgcG } })).colaboradorCodigo, codigo("G"));
  assert.equal(await db.mapaPagamentoItem.count({ where: { sourceRowHash: `${sufixo}-g`, projetistaCodigo: codigo("G") } }), 1);
  assert.equal(await db.adminAuditLog.count({ where: { action: "FORNECEDOR_CODIGO_P0_REVERTIDO", targetId: profissionalG } }), 1);
  assert.equal((await m.planejarMigracaoP0()).usuarios.find((u) => u.login === L.G)?.classe, "MIGRAVEL");
});

test("aplicar e reverter P0: Profissional legado sem código volta sem código", async () => {
  const loginH = `P06${n}1`;
  const legado = await db.profissional.create({ data: { codigo: null, nome: codigo("H") } });
  await fornecedor(loginH, `NOME H ${sufixo}`, codigo("H"));
  try {
    assert.deepEqual((await m.aplicarMigracaoP0({ adminLogin: L.ADM, logins: [loginH] })).migrados, [loginH]);
    assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: legado.id } })).codigo, loginH);
    assert.deepEqual((await m.reverterMigracaoP0({ adminLogin: L.ADM, logins: [loginH] })).revertidos, [loginH]);
    assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: legado.id } })).codigo, null);
    assert.equal(await db.cadastroFornecedor.count({ where: { colaboradorCodigo: codigo("H") } }), 1);
  } finally {
    await db.usuario.deleteMany({ where: { usuario: loginH } });
  }
});
