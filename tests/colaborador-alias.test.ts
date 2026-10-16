import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { filtrarAliasesDaIdentidade } from "../lib/colaborador-alias-filtro";
import type { ResolucaoIdentidade } from "../lib/profissional-identidade";

// Resolver de mentira com o mesmo contrato do oficial (lib/profissional-identidade.ts).
const A = "prof-a";
const B = "prof-b";
const tabela: Record<string, ResolucaoIdentidade> = {
  P0000001: { status: "RESOLVIDO", via: "CODIGO", profissionalId: A, codigoCanonico: "P0000001" },
  "JOAO A SILVA": { status: "RESOLVIDO", via: "ALIAS", profissionalId: A, codigoCanonico: "P0000001" },
  P0000002: { status: "RESOLVIDO", via: "CODIGO", profissionalId: B, codigoCanonico: "P0000002" },
  "JOAO SILVA": { status: "AMBIGUO", valor: "JOAO SILVA", candidatos: [] },
  "JOAO DA SILVA": { status: "NAO_RESOLVIDO", valor: "JOAO DA SILVA" },
};
const resolver = async (valor: string): Promise<ResolucaoIdentidade> => tabela[valor] ?? { status: "NAO_RESOLVIDO", valor };

test("filtro: código e alias formal do próprio fornecedor ficam", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade(["P0000001", "JOAO A SILVA"], resolver, A), ["P0000001", "JOAO A SILVA"]);
});

test("filtro: código de outro fornecedor (V1/V2/V4) sai", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade(["P0000001", "P0000002"], resolver, A), ["P0000001"]);
});

test("filtro: nome ambíguo ou não resolvido (V3) sai", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade(["P0000001", "JOAO SILVA", "JOAO DA SILVA"], resolver, A), ["P0000001"]);
});

test("filtro: vazios e repetidos são ignorados", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade([" P0000001 ", "P0000001", "", null, undefined], resolver, A), ["P0000001"]);
});

// ─── Integração: getColaboradorCodigoAliases no banco de teste (vetores da spec) ─────────────

const sufixo = `ESCOPO${Date.now()}`;
const loginA = `P09${String(Date.now()).slice(-6)}`;
const codigoA = `PA-${sufixo}`;
const codigoB = `PB-${sufixo}`;
const nomeUsuarioA = `FORNECEDOR A ${sufixo}`;
const homonimo = `HOMONIMO ${sufixo}`;
const aliasFormalA = `APELIDO A ${sufixo}`;
const ciclo = `29${String(Date.now()).slice(-2)}`;
let getColaboradorCodigoAliases: (usuario: string, ciclo?: string | null) => Promise<string[]>;
let getColaboradorEscopo: typeof import("../lib/colaborador-alias").getColaboradorEscopo;
let getDocumentosMedidos: typeof import("../lib/documentos-medidos").getDocumentosMedidos;

before(async () => {
  await assertConnectedToE2eDatabase();
  // lib/colaborador-alias usa lib/prisma (DATABASE_URL): só roda se ele aponta para o banco de teste.
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  ({ getColaboradorCodigoAliases, getColaboradorEscopo } = await import("../lib/colaborador-alias"));
  ({ getDocumentosMedidos } = await import("../lib/documentos-medidos"));

  const a = await db.profissional.create({ data: { codigo: codigoA, nome: homonimo } });
  // V3: `nome` é único, mas o nomeCompleto de B pode ser igual ao nome de A.
  await db.profissional.create({ data: { codigo: codigoB, nome: `OUTRO ${sufixo}`, nomeCompleto: homonimo } });
  await db.profissionalAlias.create({ data: { profissionalId: a.id, alias: aliasFormalA, aliasNormalizado: aliasFormalA, origem: "MANUAL" } });
  await db.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigoA, responsavel: nomeUsuarioA, razaoSocial: "A LTDA" } });
  await db.usuario.create({ data: { usuario: loginA, nome: nomeUsuarioA, perfil: "COLABORADOR", senhaHash: "x" } });
  await db.mapaPagamentoItem.createMany({
    data: [
      { ciclo, ordem: 1, projetistaCodigo: codigoA, responsavel: nomeUsuarioA, sourceRowHash: `${sufixo}-a` },
      // V1: linha de B cujo responsável tem o nome do usuário A.
      { ciclo, ordem: 2, projetistaCodigo: codigoB, responsavel: nomeUsuarioA, sourceRowHash: `${sufixo}-b` },
    ],
  });
});

after(async () => {
  await db.mapaPagamentoItem.deleteMany({ where: { sourceRowHash: { startsWith: sufixo } } });
  await db.usuario.deleteMany({ where: { usuario: loginA } });
  await db.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: codigoA } });
  await db.profissional.deleteMany({ where: { codigo: { in: [codigoA, codigoB] } } });
});

test("escopo: identidade vem do cadastro do usuário; código e alias formal de A entram", async () => {
  const lista = await getColaboradorCodigoAliases(loginA, ciclo);
  assert.ok(lista.includes(codigoA), JSON.stringify(lista));
  assert.ok(lista.includes(aliasFormalA), JSON.stringify(lista));
});

test("escopo V1: código de B vindo de linha do mapa com o nome de A não entra", async () => {
  assert.ok(!(await getColaboradorCodigoAliases(loginA, ciclo)).includes(codigoB));
  assert.ok(!(await getColaboradorCodigoAliases(loginA)).includes(codigoB));
});

test("escopo V3: nome de A que é o nomeCompleto de B não entra na lista de A", async () => {
  assert.ok(!(await getColaboradorCodigoAliases(loginA, ciclo)).includes(homonimo));
});

test("escopo V4: usuário cujo nome bate com dois cadastros fica só com o próprio login", async () => {
  const login = `P08${String(Date.now()).slice(-6)}`;
  const nome = `DUPLO ${sufixo}`;
  await db.usuario.create({ data: { usuario: login, nome, perfil: "COLABORADOR", senhaHash: "x" } });
  await db.cadastroFornecedor.createMany({
    data: [
      { cnpjNormalizado: "11222333000181", colaboradorCodigo: `D1-${sufixo}`, responsavel: nome, razaoSocial: "D1" },
      { cnpjNormalizado: "11222333000181", colaboradorCodigo: `D2-${sufixo}`, responsavel: nome, razaoSocial: "D2" },
    ],
  });
  try {
    assert.deepEqual(await getColaboradorCodigoAliases(login, ciclo), [login]);
  } finally {
    await db.cadastroFornecedor.deleteMany({ where: { responsavel: nome } });
    await db.usuario.deleteMany({ where: { usuario: login } });
  }
});

test("escopo T4: Documentos Medidos do portal não traz medição de outro Profissional cujo nome é um alias de A", async () => {
  // C (outro fornecedor, com código) tem `nome` igual ao alias formal de A — valor legítimo da lista de A.
  const a = await db.profissional.findFirstOrThrow({ where: { codigo: codigoA }, select: { id: true } });
  const c = await db.profissional.create({ data: { codigo: `PC-${sufixo}`, nome: aliasFormalA } });
  const projeto = await db.projeto.create({ data: { codigoProjeto: `${sufixo}-PROJ`, contrato: "TESTE" } });
  const medicao = (id: string, n: string) => ({
    numeroMedicao: `${sufixo}-${n}`, idProjeto: projeto.id, idProfissional: id, ciclo,
    equivalenteA1Horas: 1, percentualEmissao: 1, condicao: "100", sourceRowHash: `${sufixo}-med-${n}`,
  });
  await db.medicao.createMany({ data: [medicao(a.id, "A"), medicao(c.id, "C")] });
  try {
    const escopo = await getColaboradorEscopo(loginA, ciclo);
    assert.ok(escopo.aliases.includes(aliasFormalA), "fixture: o alias de A precisa estar na lista");
    const docs = await getDocumentosMedidos({ ...escopo, ciclo });
    const donos = await db.medicao.findMany({ where: { id: { in: docs.map((d) => d.id) } }, select: { idProfissional: true } });
    assert.deepEqual(donos.map((d) => d.idProfissional), [a.id]);
  } finally {
    await db.medicao.deleteMany({ where: { numeroMedicao: { startsWith: sufixo } } });
    await db.projeto.delete({ where: { id: projeto.id } });
    await db.profissional.delete({ where: { id: c.id } });
  }
});
