import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// T4 da P2 (docs/brain/specs/p2-vinculo-login-profissional.md): usuário e cadastro do fornecedor se
// ligam só pelo P0 (login = código). Um usuário homônimo nunca é atingido nem escolhido pelo nome.
const sufixo = `SEMNOME${Date.now()}`;
const n = String(Date.now()).slice(-5);
const loginA = `P03${n}1`;
const loginH = `P03${n}2`;
const loginSemVinculo = `P03${n}3`;
const nome = `FORNECEDOR HOMONIMO ${sufixo}`;
const admin = { id: "00000000-0000-4000-8000-000000000002", usuario: "TESTE-SEM-NOME", nome: "Admin de teste" };
let cad: typeof import("../lib/cadastro-fornecedor");
let getColaboradorEscopo: typeof import("../lib/colaborador-alias").getColaboradorEscopo;
let profissionalA = "";
let cadastroA = "";

before(async () => {
  await assertConnectedToE2eDatabase();
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  cad = await import("../lib/cadastro-fornecedor");
  ({ getColaboradorEscopo } = await import("../lib/colaborador-alias"));

  // A em P0: login = código do Profissional = código do cadastro.
  profissionalA = (await db.profissional.create({ data: { codigo: loginA, nome: loginA, nomeCompleto: nome } })).id;
  cadastroA = (await db.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: loginA, responsavel: nome, razaoSocial: "A LTDA" } })).id;
  // H: outro usuário fornecedor com o MESMO nome, sem cadastro nem Profissional.
  await db.usuario.createMany({
    data: [
      { usuario: loginA, nome, perfil: "COLABORADOR", senhaHash: "x" },
      { usuario: loginH, nome, perfil: "COLABORADOR", senhaHash: "x" },
      // Usuário cujo nome bate com o responsável de um cadastro, mas sem P0 ligado a ele.
      { usuario: loginSemVinculo, nome: `SO PELO NOME ${sufixo}`, perfil: "COLABORADOR", senhaHash: "x" },
    ],
  });
  await db.profissional.create({ data: { codigo: `X ${sufixo}`, nome: `X ${sufixo}` } });
  await db.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: `X ${sufixo}`, responsavel: `SO PELO NOME ${sufixo}`, razaoSocial: "X LTDA" } });
});

after(async () => {
  await db.adminAuditLog.deleteMany({ where: { adminUsuario: admin.usuario } });
  await db.cadastroFornecedor.deleteMany({ where: { OR: [{ responsavel: { contains: sufixo } }, { colaboradorCodigo: loginA }] } });
  await db.usuario.deleteMany({ where: { usuario: { in: [loginA, loginH, loginSemVinculo] } } });
  await db.profissional.deleteMany({ where: { OR: [{ id: profissionalA }, { nome: { contains: sufixo } }, { codigo: { contains: sufixo } }] } });
});

const usuario = (login: string) => db.usuario.findUniqueOrThrow({ where: { usuario: login }, select: { ativo: true, excluidoAt: true, nome: true } });

test("escopo: usuário sem P0 ligado não herda o cadastro de quem tem o mesmo nome", async () => {
  const escopo = await getColaboradorEscopo(loginSemVinculo);
  assert.deepEqual({ p: escopo.profissionalId, c: escopo.cadastroId }, { p: null, c: null });
  assert.equal((await getColaboradorEscopo(loginA)).cadastroId, cadastroA);
});

test("listagem do Administrativo: acesso do cadastro é o usuário do código, não o homônimo", async () => {
  const acessos = await cad.findColaboradorUsuarios([loginA]);
  assert.equal(acessos.get(loginA)?.usuario, loginA);
});

test("resumo de candidatos: usuário do Profissional é o do código", async () => {
  const [resumo] = await cad.getIdentityCandidateSummaries([loginA]);
  assert.equal(resumo.usuarioLogin, loginA);
});

test("renomear o responsável renomeia só o usuário do código, mesmo com homônimo", async () => {
  await db.$transaction((tx) => cad.sincronizarUsuarioDoFornecedor(tx, loginA, { nome: `${nome} NOVO`, email: null }));
  assert.equal((await usuario(loginA)).nome, `${nome} NOVO`);
  assert.equal((await usuario(loginH)).nome, nome);
  await db.usuario.update({ where: { usuario: loginA }, data: { nome } });
});

test("inativar e reativar o fornecedor atinge só o usuário do código, nunca o homônimo", async () => {
  await cad.setFornecedoresAtivos([cadastroA], false, admin);
  assert.equal((await usuario(loginA)).ativo, false);
  assert.equal((await usuario(loginH)).ativo, true);
  await cad.setFornecedoresAtivos([cadastroA], true, admin);
  assert.equal((await usuario(loginA)).ativo, true);
});

test("exclusão definitiva desativa só o usuário do código, nunca o homônimo", async () => {
  const r = await cad.deleteFornecedoresDefinitivamente([cadastroA], admin, "teste T4");
  assert.deepEqual(r.errors, []);
  assert.ok((await usuario(loginA)).excluidoAt);
  assert.equal((await usuario(loginH)).excluidoAt, null);
});
