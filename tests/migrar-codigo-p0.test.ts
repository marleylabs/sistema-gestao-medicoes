import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// Dry-run da migração para o P0 (docs/brain/specs/p2-vinculo-login-profissional.md, T1).
const sufixo = `MIGP0${Date.now()}`;
const n = String(Date.now()).slice(-5);
const login = (letra: number) => `P07${letra}${n}`;
const L = { A: login(1), B: login(2), C: login(3), D: login(4), F1: login(5), F2: login(6) };
const codigo = (x: string) => `${x} ${sufixo}`;
const ciclo = `28${n.slice(-2)}`;
let planejarMigracaoP0: typeof import("../lib/migracao-codigo-p0").planejarMigracaoP0;
let plano: Awaited<ReturnType<typeof planejarMigracaoP0>>;

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
  ({ planejarMigracaoP0 } = await import("../lib/migracao-codigo-p0"));

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
  // Profissional sem login.
  await db.profissional.create({ data: { codigo: codigo("SEM"), nome: codigo("SEM") } });

  plano = await planejarMigracaoP0();
});

after(async () => {
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

test("dry-run P0: conta Profissionais sem login", () => {
  assert.ok(plano.profissionaisSemLogin.total >= 2, JSON.stringify(plano.profissionaisSemLogin));
});

test("dry-run P0: não grava nada", async () => {
  const [profissionais, mapa] = await Promise.all([
    db.profissional.findMany({ where: { OR: [{ nome: { contains: sufixo } }, { codigo: { contains: sufixo } }] }, select: { codigo: true } }),
    db.mapaPagamentoItem.findMany({ where: { sourceRowHash: { startsWith: sufixo } }, select: { projetistaCodigo: true }, orderBy: { ordem: "asc" } }),
  ]);
  assert.deepEqual(profissionais.map((p) => p.codigo).sort(), [codigo("A"), codigo("C"), codigo("F"), codigo("SEM"), L.C, L.D].sort());
  assert.deepEqual(mapa.map((m) => m.projetistaCodigo), [codigo("A"), ` ${codigo("A").toLowerCase()} `]);
  assert.equal(await db.profissionalAlias.count({ where: { origem: "MIGRACAO_P0", alias: { contains: sufixo } } }), 0);
});
