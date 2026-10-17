import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// T3 da P2 (docs/brain/specs/p2-vinculo-login-profissional.md): fornecedor novo nasce com o P0 como
// código, e o usuário nunca é achado pelo nome de outro fornecedor.
const sufixo = `NOVOP0${Date.now()}`;
const nomeA = `FORNECEDOR NOVO ${sufixo}`;
const admin = { id: "00000000-0000-4000-8000-000000000001", usuario: "TESTE-NOVO-P0", nome: "Admin de teste" };
type Cad = typeof import("../lib/cadastro-fornecedor");
let cad: Cad;
let getColaboradorEscopo: typeof import("../lib/colaborador-alias").getColaboradorEscopo;
let resolverIdentidadeOperacional: typeof import("../lib/profissional-identidade").resolverIdentidadeOperacional;
const criados = { logins: [] as string[], profissionais: [] as string[] };

const linha = (responsavel: string, extra: { email?: string; telefone?: string; razaoSocial?: string } = {}) => ({
  responsavel, cnpj: "11222333000181", cnpjNormalizado: "11222333000181", razaoSocial: extra.razaoSocial ?? `${responsavel} LTDA`,
  email: extra.email ?? `${sufixo.toLowerCase()}@example.test`, telefone: extra.telefone ?? "11999990000", rawPayload: {},
});

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
  ({ resolverIdentidadeOperacional } = await import("../lib/profissional-identidade"));
});

after(async () => {
  await db.adminAuditLog.deleteMany({ where: { adminUsuario: admin.usuario } });
  await db.cadastroFornecedor.deleteMany({ where: { responsavel: { contains: sufixo } } });
  await db.usuario.deleteMany({ where: { OR: [{ usuario: { in: criados.logins } }, { nome: { contains: sufixo } }] } });
  await db.profissional.deleteMany({ where: { OR: [{ id: { in: criados.profissionais } }, { nome: { contains: sufixo } }, { codigo: { contains: sufixo } }] } });
});

async function profissionalDoCodigo(codigo: string) {
  return db.profissional.findUniqueOrThrow({ where: { codigo }, select: { id: true, codigo: true, nome: true, nomeCompleto: true } });
}

let loginA = "";

test("novo fornecedor: o P0 é o login, o código do Profissional e o do cadastro; o nome vira alias", async () => {
  const r = await cad.upsertCadastroFornecedor(linha(nomeA), undefined, undefined, admin);
  assert.ok(r.usuarioCriado, "fornecedor novo cria usuário");
  loginA = r.usuarioCriado.usuario;
  criados.logins.push(loginA);
  assert.match(loginA, /^P0\d{6}$/);
  assert.equal(r.colaboradorCodigo, loginA);

  const p = await profissionalDoCodigo(loginA);
  criados.profissionais.push(p.id);
  assert.deepEqual({ nome: p.nome, nomeCompleto: p.nomeCompleto }, { nome: loginA, nomeCompleto: nomeA });
  assert.equal(await db.cadastroFornecedor.count({ where: { colaboradorCodigo: loginA } }), 1);
  assert.equal(await db.profissionalAlias.count({ where: { profissionalId: p.id, aliasNormalizado: nomeA, ativo: true } }), 1);

  const escopo = await getColaboradorEscopo(loginA);
  assert.equal(escopo.profissionalId, p.id);
  assert.ok(escopo.cadastroId);
  const pelaPlanilha = await resolverIdentidadeOperacional(nomeA);
  assert.ok(pelaPlanilha.status === "RESOLVIDO" && pelaPlanilha.profissionalId === p.id && pelaPlanilha.codigoCanonico === loginA, JSON.stringify(pelaPlanilha));
});

test("reimportar o mesmo fornecedor reusa o usuário pelo código, sem criar outro", async () => {
  const r = await cad.upsertCadastroFornecedor(linha(nomeA, { email: `outro-${sufixo.toLowerCase()}@example.test` }), undefined, undefined, admin);
  assert.equal(r.usuarioCriado, null);
  assert.equal(r.colaboradorCodigo, loginA);
  assert.equal(await db.usuario.count({ where: { nome: nomeA } }), 1);
});

test("homônimo novo (Nenhuma dessas identidades) ganha outro P0 e não reusa o usuário do primeiro", async () => {
  const homonimo = linha(nomeA, { email: `homonimo-${sufixo.toLowerCase()}@example.test`, telefone: "21988887777", razaoSocial: `OUTRA EMPRESA ${sufixo}` });
  await assert.rejects(cad.upsertCadastroFornecedor(homonimo, undefined, undefined, admin), cad.FornecedorIdentityConflictError);

  const r = await cad.resolverIdentidadeManualmente(homonimo, { tipo: "NENHUMA_IDENTIDADE" }, admin);
  assert.ok(r.usuarioCriado, "homônimo recebe usuário próprio");
  const loginB = r.usuarioCriado.usuario;
  criados.logins.push(loginB);
  assert.notEqual(loginB, loginA);
  assert.equal(r.colaboradorCodigo, loginB);
  const pB = await profissionalDoCodigo(loginB);
  criados.profissionais.push(pB.id);

  assert.equal((await getColaboradorEscopo(loginA)).profissionalId, criados.profissionais[0]);
  assert.equal((await getColaboradorEscopo(loginB)).profissionalId, pB.id);
  // O nome sozinho não distingue os dois: a planilha fica pendente para o ADMIN, nunca escolhe um.
  assert.equal((await resolverIdentidadeOperacional(nomeA)).status, "AMBIGUO");
});

test("fornecedor antigo sem P0 (código = nome, usuário pelo nome) passa para o P0 do próprio login ao ser reimportado", async () => {
  const nomeL = `LEGADO ${sufixo}`;
  const loginL = `P05${String(Date.now()).slice(-5)}`;
  criados.logins.push(loginL);
  const p = await db.profissional.create({ data: { codigo: nomeL, nome: nomeL, nomeCompleto: nomeL } });
  criados.profissionais.push(p.id);
  await db.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: nomeL, responsavel: nomeL, razaoSocial: `${nomeL} LTDA`, email: null } });
  await db.usuario.create({ data: { usuario: loginL, nome: nomeL, perfil: "COLABORADOR", senhaHash: "x" } });

  const r = await cad.upsertCadastroFornecedor(linha(nomeL), undefined, undefined, admin);
  assert.equal(r.usuarioCriado, null);
  assert.equal(r.colaboradorCodigo, loginL);
  assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: p.id } })).codigo, loginL);
  assert.equal(await db.cadastroFornecedor.count({ where: { colaboradorCodigo: loginL } }), 1);
  assert.equal(await db.adminAuditLog.count({ where: { action: "FORNECEDOR_CODIGO_P0", targetId: p.id } }), 1);
  const antigo = await resolverIdentidadeOperacional(nomeL);
  assert.ok(antigo.status === "RESOLVIDO" && antigo.codigoCanonico === loginL, JSON.stringify(antigo));
});

test("usuário homônimo de OUTRO fornecedor já em P0 nunca é reaproveitado pelo nome", async () => {
  // Y já está em P0 (login = código) e o usuário dele se chama N. X é legado (código = nome) e o
  // responsável dele também se chama N. Reimportar X não pode pegar o usuário de Y pelo nome.
  const nomeN = `HOMONIMO N ${sufixo}`;
  const loginY = `P04${String(Date.now()).slice(-5)}`;
  criados.logins.push(loginY);
  const y = await db.profissional.create({ data: { codigo: loginY, nome: loginY, nomeCompleto: `Y ${sufixo}` } });
  const x = await db.profissional.create({ data: { codigo: `X ${sufixo}`, nome: `X ${sufixo}`, nomeCompleto: nomeN } });
  criados.profissionais.push(y.id, x.id);
  await db.usuario.create({ data: { usuario: loginY, nome: nomeN, perfil: "COLABORADOR", senhaHash: "x" } });

  const r = await cad.upsertCadastroFornecedor(linha(nomeN), undefined, undefined, admin);
  assert.ok(r.usuarioCriado, "X ganha usuário próprio");
  criados.logins.push(r.usuarioCriado.usuario);
  assert.notEqual(r.usuarioCriado.usuario, loginY);
  assert.equal(r.colaboradorCodigo, r.usuarioCriado.usuario);
  assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: x.id } })).codigo, r.usuarioCriado.usuario);
  assert.equal((await db.profissional.findUniqueOrThrow({ where: { id: y.id } })).codigo, loginY);
});
