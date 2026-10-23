import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// Aprovação das horas pelo fiscal (docs/brain/specs/timesheet-aprovacao-fiscal.md).
// Ciclo 3907 (21/06/2039 a 20/07/2039), separado dos ciclos de tests/timesheet*.test.ts.
const CICLO = "3907";
const HOJE = "2039-07-20";
const sufixo = `TSF${Date.now()}`;
const medicao = { id: "00000000-0000-4000-8000-0000000000d4", usuario: `TESTE-${sufixo}`, nome: "Medição de teste" };

type Lib = typeof import("../lib/timesheet");
type Fis = typeof import("../lib/timesheet-fiscal");
type Med = typeof import("../lib/timesheet-medicao");
let ts: Lib;
let fis: Fis;
let med: Med;
const ids = { f1: "", f2: "", naoFiscal: "", p1: "", p2: "", semContrato: "", c1: "", c2: "" };
let f1 = { id: "", usuario: "", nome: "" };

before(async () => {
  await assertConnectedToE2eDatabase();
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  ts = await import("../lib/timesheet");
  fis = await import("../lib/timesheet-fiscal");
  med = await import("../lib/timesheet-medicao");
  const usuario = (nome: string, perfil: string) =>
    db.usuario.create({ data: { usuario: `${nome}-${sufixo}`, nome: `${nome} ${sufixo}`, perfil, senhaHash: "x" }, select: { id: true, usuario: true, nome: true } });
  const u1 = await usuario("F1", "FISCAL");
  f1 = u1;
  ids.f1 = u1.id;
  ids.f2 = (await usuario("F2", "FISCAL")).id;
  ids.naoFiscal = (await usuario("MED", "MEDICAO")).id;
  ids.c1 = (await db.contrato.create({ data: { nome: `C1 ${sufixo}`, fiscalId: ids.f1 }, select: { id: true } })).id;
  ids.c2 = (await db.contrato.create({ data: { nome: `C2 ${sufixo}`, fiscalId: ids.f2 }, select: { id: true } })).id;
  const prof = async (nome: string, contratoId: string | null) => {
    const p = await db.profissional.create({ data: { nome: `${nome} ${sufixo}`, codigo: `${nome}-${sufixo}`, statusColaborador: "ATO" }, select: { id: true } });
    await db.timesheetConfig.create({ data: { profissionalId: p.id, contratoId } });
    return p.id;
  };
  ids.p1 = await prof("P1", ids.c1);
  ids.p2 = await prof("P2", ids.c2);
  ids.semContrato = await prof("P3", null);
});

after(async () => {
  const profs = [ids.p1, ids.p2, ids.semContrato].filter(Boolean);
  await db.adminAuditLog.deleteMany({ where: { OR: [{ adminUsuario: { endsWith: sufixo } }, { targetCodigo: { endsWith: sufixo } }] } });
  await db.timesheetFolha.deleteMany({ where: { profissionalId: { in: profs } } });
  await db.timesheetConfig.deleteMany({ where: { profissionalId: { in: profs } } });
  await db.profissional.deleteMany({ where: { id: { in: profs } } });
  await db.contrato.deleteMany({ where: { nome: { endsWith: sufixo } } });
  await db.usuario.deleteMany({ where: { usuario: { endsWith: sufixo } } });
});

const salvar = (profissionalId: string, data: string, saida2 = "17:00") =>
  ts.salvarDia({ profissionalId, ciclo: CICLO, dia: { data, entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2 }, ator: medicao, hoje: HOJE, cicloAtivo: CICLO });

async function rejeita(promessa: Promise<unknown>, status: number, mensagem?: RegExp) {
  await assert.rejects(promessa, (e: unknown) => {
    assert.ok(e instanceof ts.TimesheetError, String(e));
    assert.equal(e.status, status);
    if (mensagem) assert.match(e.message, mensagem);
    return true;
  });
}

const dia = async (profissionalId: string, data: string) => (await ts.carregarFolha(profissionalId, CICLO, HOJE, { paraMedicao: true })).dias.find((d) => d.data === data)!;

test("escopo: o fiscal vê só os fornecedores dos contratos dele; o resto é 404", async () => {
  await salvar(ids.p1, "2039-06-22");
  await salvar(ids.p2, "2039-06-22");
  const lista = await fis.listarFolhasDoFiscal(ids.f1, CICLO);
  const meus = lista.folhas.map((f) => f.profissionalId).filter((id) => [ids.p1, ids.p2, ids.semContrato].includes(id));
  assert.deepEqual(meus, [ids.p1]);
  await rejeita(fis.folhaDoFiscal(ids.f1, ids.p2, CICLO), 404);
  await rejeita(fis.folhaDoFiscal(ids.f1, ids.semContrato, CICLO), 404);
  await rejeita(fis.decidirDias({ fiscal: f1, profissionalId: ids.p2, ciclo: CICLO, datas: ["2039-06-22"], decisao: "APROVADO" }), 404);
  assert.equal((await fis.folhaDoFiscal(ids.f1, ids.p1, CICLO)).dias.length, 30);
});

test("decisão em lote: valida entrada, só dias lançados, motivo na reprovação, auditoria", async () => {
  await salvar(ids.p1, "2039-06-23", "19:00");
  await salvar(ids.p1, "2039-06-24");
  const decidir = (datas: unknown, decisao: unknown, motivo?: unknown) => fis.decidirDias({ fiscal: f1, profissionalId: ids.p1, ciclo: CICLO, datas, decisao, motivo });

  await rejeita(decidir(["2039-06-22"], "TALVEZ"), 400, /Decisão/);
  await rejeita(decidir(["2039-06-22"], "REPROVADO"), 400, /motivo/);
  await rejeita(decidir([], "APROVADO"), 400);
  await rejeita(decidir(["2039-08-01"], "APROVADO"), 400, /dias do ciclo/);
  await rejeita(decidir(["2039-06-22", "2039-06-25"], "APROVADO"), 409, /lançadas/);

  assert.deepEqual(await decidir(["2039-06-22", "2039-06-23"], "APROVADO"), { decididos: 2 });
  await decidir(["2039-06-24"], "REPROVADO", "  Horário divergente do registro da portaria ");
  const [d22, d24] = [await dia(ids.p1, "2039-06-22"), await dia(ids.p1, "2039-06-24")];
  assert.deepEqual([d22.aprovacao, d22.aprovacaoPor], ["APROVADO", f1.nome]);
  assert.deepEqual([d24.aprovacao, d24.aprovacaoMotivo], ["REPROVADO", "Horário divergente do registro da portaria"]);

  const logs = await db.adminAuditLog.findMany({ where: { adminUsuario: f1.usuario }, orderBy: { createdAt: "asc" }, select: { action: true, metadata: true } });
  assert.deepEqual(logs.map((l) => l.action), ["TIMESHEET_DIAS_APROVADOS", "TIMESHEET_DIAS_REPROVADOS"]);
  assert.deepEqual((logs[0].metadata as { datas: string[] }).datas, ["2039-06-22", "2039-06-23"]);

  const item = (await med.listarFolhasDoCiclo(CICLO)).folhas.find((f) => f.profissionalId === ids.p1);
  assert.deepEqual(item?.aprovacoes, { aprovados: 2, reprovados: 1, pendentes: 0 });
});

test("dia alterado pelo fornecedor volta a pendente; regravar igual mantém a decisão", async () => {
  await salvar(ids.p1, "2039-06-22"); // mesmos valores
  assert.equal((await dia(ids.p1, "2039-06-22")).aprovacao, "APROVADO");
  await salvar(ids.p1, "2039-06-24", "18:00"); // corrigiu o reprovado
  const d24 = await dia(ids.p1, "2039-06-24");
  assert.deepEqual([d24.aprovacao, d24.aprovacaoMotivo, d24.aprovacaoPor], [null, null, null]);
  assert.equal((await dia(ids.p1, "2039-06-23")).aprovacao, "APROVADO", "os outros dias mantêm a decisão");
});

test("cadastro: fiscal exige e-mail; contrato só aceita fiscal FISCAL ativo e mostra o nome dele", async () => {
  const { criarFiscal } = await import("../lib/fiscais");
  const { atualizarContrato, ContratoError } = await import("../lib/contratos-cadastro");
  const r = await criarFiscal({ body: { nome: `Fiscal sem e-mail ${sufixo}`, email: "" }, ator: medicao });
  assert.equal(r.ok, false);

  await assert.rejects(atualizarContrato({ id: ids.c1, body: { fiscalId: ids.naoFiscal }, ator: medicao }), (e: unknown) => e instanceof ContratoError && e.status === 400);
  const c = await atualizarContrato({ id: ids.c1, body: { fiscalId: ids.f1 }, ator: medicao });
  assert.equal(c.fiscal, `F1 ${sufixo}`);
  assert.equal((await ts.carregarFolha(ids.p1, CICLO, HOJE, { paraMedicao: true })).cabecalho.fiscal, `F1 ${sufixo}`);
});

// docs/brain/specs/fiscal-cadastro-acesso.md
test("cadastro: campos opcionais, edição validada e auditoria sem dados pessoais", async () => {
  const { criarFiscal, atualizarFiscal, listarFiscais } = await import("../lib/fiscais");
  const ruim = await criarFiscal({ body: { nome: `Fiscal ${sufixo}`, email: "f@example.com", telefone: "123" }, ator: medicao });
  assert.deepEqual([ruim.ok, ruim.status], [false, 400]);

  const r = await criarFiscal({ body: { nome: `Fiscal ${sufixo}`, email: "f@example.com", telefone: "(31) 99876-5432", empresa: "VALE", cargo: " ", matricula: "M123" }, ator: medicao });
  assert.ok(r.ok);
  const id = r.fiscal.id;
  try {
    const bruto = await db.usuario.findUniqueOrThrow({ where: { id }, select: { telefone: true, cargo: true } });
    assert.notEqual(bruto.telefone, "31998765432", "telefone cifrado no banco");
    assert.equal(bruto.cargo, null, "campo em branco vira null");
    const listado = (await listarFiscais()).find((f) => f.id === id);
    assert.deepEqual([listado?.telefone, listado?.empresa, listado?.matricula], ["31998765432", "VALE", "M123"]);

    const base = { nome: `Fiscal ${sufixo}`, email: "f@example.com", telefone: "31998765432", empresa: "VALE", matricula: "M123" };
    assert.deepEqual(await atualizarFiscal({ id, body: { ...base, email: "x" }, ator: medicao }), { ok: false, status: 400, error: "Informe um e-mail válido: o acesso do fiscal é enviado por e-mail." });
    assert.deepEqual(await atualizarFiscal({ id: ids.naoFiscal, body: base, ator: medicao }), { ok: false, status: 404, error: "Fiscal não encontrado." }, "só edita perfil FISCAL");
    const e = await atualizarFiscal({ id, body: { ...base, email: "novo@example.com", cargo: "Gerente" }, ator: medicao });
    assert.deepEqual(e, { ok: true, campos: ["email", "cargo"] });
    const log = await db.adminAuditLog.findFirstOrThrow({ where: { action: "FISCAL_ATUALIZADO", targetId: id }, select: { metadata: true } });
    assert.deepEqual(log.metadata, { campos: ["email", "cargo"] });
    assert.deepEqual(await atualizarFiscal({ id, body: { ...base, email: "novo@example.com", cargo: "Gerente" }, ator: medicao }), { ok: true, campos: [] });
    assert.equal(await db.adminAuditLog.count({ where: { action: "FISCAL_ATUALIZADO", targetId: id } }), 1, "sem mudança não audita");
  } finally {
    await db.adminAuditLog.deleteMany({ where: { targetId: id } });
    await db.usuario.delete({ where: { id } });
  }
});

test("permissões: só o FISCAL decide; o FISCAL não é equipe interna (NF, comprovante, chat, nome)", async () => {
  const ler = (rota: string) => fs.readFileSync(path.join(process.cwd(), rota), "utf8");
  for (const rota of ["app/api/fiscal/timesheet/route.ts", "app/api/fiscal/timesheet/[profissionalId]/route.ts", "app/api/fiscal/timesheet/[profissionalId]/decisao/route.ts"]) {
    const fonte = ler(rota);
    const handlers = fonte.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
    const guardas = fonte.match(/const auth = await requireFiscal\(\);\s*if \(auth\.response\) return auth\.response;/g) ?? [];
    assert.ok(handlers.length > 0 && guardas.length === handlers.length, rota);
  }
  const andar = (dir: string): string[] => fs.readdirSync(dir).flatMap((n) => {
    const c = path.join(dir, n);
    return fs.statSync(c).isDirectory() ? andar(c) : [c];
  });
  for (const rota of andar(path.join(process.cwd(), "app/api/admin"))) assert.doesNotMatch(fs.readFileSync(rota, "utf8"), /decidirDias/, `${rota}: medição não decide`);
  assert.match(ler("lib/admin.ts"), /export async function requireFiscal\(\)[\s\S]*?user\.perfil !== "FISCAL"/);

  const { isPerfilInterno } = await import("../lib/perfis");
  const { podeAlterarProprioNome } = await import("../lib/usuario-nome");
  const { canUseChatPerfil } = await import("../app/api/chat/_helpers");
  assert.deepEqual([isPerfilInterno("FISCAL"), isPerfilInterno("COLABORADOR"), isPerfilInterno("MEDICAO")], [false, false, true]);
  assert.equal(podeAlterarProprioNome("FISCAL"), false);
  assert.equal(canUseChatPerfil("FISCAL"), false);
  for (const rota of ["app/api/colaborador/nf/[id]/route.ts", "app/api/colaborador/comprovante/[id]/route.ts"]) {
    assert.match(ler(rota), /else if \(!isPerfilInterno\(user\.perfil\)\)/, rota);
  }
  assert.match(ler("app/page.tsx"), /perfil === "FISCAL"/);
});
