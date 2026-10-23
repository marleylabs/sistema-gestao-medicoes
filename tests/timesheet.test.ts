import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { assinaturaDeTeste } from "./support/assinatura-png";

// T3 do Timesheet ATO (docs/brain/specs/timesheet-ato-plano.md): folha no banco de teste.
// Ciclo 3905 (21/04/2039 a 20/05/2039) para não colidir com dados de outros testes; tem 21/04 e 01/05.
const CICLO = "3905";
const HOJE = "2039-05-01";
const sufixo = `TS${Date.now()}`;
const ator = { id: "00000000-0000-4000-8000-0000000000a1", usuario: `TESTE-${sufixo}`, nome: "Fornecedor de teste" };
const FERIADO_MANUAL = "2039-05-13";

type Lib = typeof import("../lib/timesheet");
type Ass = typeof import("../lib/timesheet-assinatura");
let ass: Ass;
let ts: Lib;
const ids: Record<"ato" | "outroAto" | "semStatus" | "habilitadoManual" | "desabilitado" | "excluido", string> = {
  ato: "", outroAto: "", semStatus: "", habilitadoManual: "", desabilitado: "", excluido: "",
};

async function criarProfissional(nome: string, statusColaborador: string | null, extra: { deletedAt?: Date } = {}) {
  const p = await db.profissional.create({ data: { nome: `${nome} ${sufixo}`, codigo: `${nome}-${sufixo}`, statusColaborador, ...extra }, select: { id: true } });
  return p.id;
}

before(async () => {
  await assertConnectedToE2eDatabase();
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  ts = await import("../lib/timesheet");
  ass = await import("../lib/timesheet-assinatura");
  ids.ato = await criarProfissional("ATO", "ATO");
  ids.outroAto = await criarProfissional("OUTRO", "ATO");
  ids.semStatus = await criarProfissional("SEMSTATUS", null);
  ids.habilitadoManual = await criarProfissional("MANUAL", "PRODUÇÃO");
  ids.desabilitado = await criarProfissional("DESAB", "ATO");
  ids.excluido = await criarProfissional("EXCL", "ATO", { deletedAt: new Date() });
  await db.timesheetConfig.create({ data: { profissionalId: ids.habilitadoManual, habilitado: true } });
  await db.timesheetConfig.create({ data: { profissionalId: ids.desabilitado, habilitado: false } });
});

after(async () => {
  const todos = Object.values(ids).filter(Boolean);
  await db.adminAuditLog.deleteMany({ where: { adminUsuario: ator.usuario } });
  await db.timesheetFolha.deleteMany({ where: { profissionalId: { in: todos } } });
  await db.timesheetConfig.deleteMany({ where: { profissionalId: { in: todos } } });
  await db.timesheetCiclo.deleteMany({ where: { ciclo: CICLO } });
  await db.feriado.deleteMany({ where: { data: new Date(`${FERIADO_MANUAL}T00:00:00Z`) } });
  await db.profissional.deleteMany({ where: { id: { in: todos } } });
});

const dia = (data: string, extra: Record<string, unknown> = {}) => ({ data, entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2: "17:00", ...extra });
const salvar = (profissionalId: string, d: ReturnType<typeof dia>, hoje = HOJE) => ts.salvarDia({ profissionalId, ciclo: CICLO, dia: d, ator, hoje, cicloAtivo: CICLO });

async function rejeita(promessa: Promise<unknown>, status: number, mensagem?: RegExp) {
  await assert.rejects(promessa, (e: unknown) => {
    assert.ok(e instanceof ts.TimesheetError, String(e));
    assert.equal(e.status, status);
    if (mensagem) assert.match(e.message, mensagem);
    return true;
  });
}

test("hoje em Brasília: 23:30 de Brasília ainda é o mesmo dia (UTC já virou)", () => {
  assert.equal(ts.hojeSaoPaulo(new Date("2026-06-11T02:30:00Z")), "2026-06-10");
});

test("parseHora aceita HH:MM e vazio, recusa o resto", () => {
  assert.equal(ts.parseHora("08:30"), 510);
  assert.equal(ts.parseHora(""), null);
  assert.equal(ts.parseHora(null), null);
  for (const ruim of ["8:30", "24:00", "12:60", 510, "abc"]) assert.throws(() => ts.parseHora(ruim), ts.TimesheetError);
});

test("habilitação: status ATO por padrão, sobrescrita da medição vale, excluído nunca", async () => {
  assert.ok(await ts.getProfissionalHabilitado(ids.ato));
  assert.equal(await ts.getProfissionalHabilitado(ids.semStatus), null);
  assert.ok(await ts.getProfissionalHabilitado(ids.habilitadoManual));
  assert.equal(await ts.getProfissionalHabilitado(ids.desabilitado), null);
  assert.equal(await ts.getProfissionalHabilitado(ids.excluido), null);
  assert.equal(await ts.getProfissionalHabilitado(null), null);
});

test("folha vazia: 30 dias 21→20, feriados nacionais marcados, só até hoje editável em DIA_A_DIA", async () => {
  const folha = await ts.carregarFolha(ids.ato, CICLO, HOJE);
  assert.equal(folha.dias.length, 30);
  assert.equal(folha.dias[0].data, "2039-04-21");
  assert.equal(folha.dias.at(-1)?.data, "2039-05-20");
  assert.equal(folha.status, "ABERTA");
  assert.equal(folha.liberacao, "DIA_A_DIA");
  const porData = new Map(folha.dias.map((d) => [d.data, d]));
  assert.equal(porData.get("2039-04-21")?.feriado, "Tiradentes");
  assert.equal(porData.get("2039-05-01")?.tipo, "DOMINGO_FERIADO");
  assert.equal(porData.get(HOJE)?.editavel, true);
  assert.equal(porData.get("2039-05-02")?.editavel, false);
  assert.deepEqual(folha.totais, { hn: 0, he50: 0, he100: 0, total: 0 });
});

test("não habilitado: leitura e gravação respondem 404", async () => {
  await rejeita(ts.carregarFolha(ids.semStatus, CICLO, HOJE), 404);
  await rejeita(salvar(ids.semStatus, dia("2039-04-22")), 404);
  await rejeita(ts.carregarFolha(null, CICLO, HOJE), 404);
});

test("salvar e ler: horários, textos, horas e auditoria na mesma transação", async () => {
  await salvar(ids.ato, dia("2039-04-25", { saida2: "20:00", projetoPep: " PEP-1 ", descricao: "Desenho", solicitante: "Fulano" })); // segunda
  await salvar(ids.ato, dia("2039-04-30", { entrada2: null, saida2: null })); // sábado
  const folha = await ts.carregarFolha(ids.ato, CICLO, HOJE);
  const segunda = folha.dias.find((d) => d.data === "2039-04-25");
  assert.deepEqual(
    { e1: segunda?.entrada1, s2: segunda?.saida2, pep: segunda?.projetoPep, horas: segunda?.horas, por: segunda?.atualizadoPor },
    { e1: "08:00", s2: "20:00", pep: "PEP-1", horas: { hn: 480, he50: 180, he100: 0, total: 660 }, por: ator.nome },
  );
  assert.deepEqual(folha.totais, { hn: 480, he50: 180 + 240, he100: 0, total: 900 });

  const logs = await db.adminAuditLog.findMany({ where: { adminUsuario: ator.usuario, action: "TIMESHEET_DIA_SALVO" }, select: { targetType: true, metadata: true } });
  assert.equal(logs.length, 2);
  assert.equal(logs[0].targetType, "TIMESHEET_FOLHA");
});

test("regravar o dia substitui os valores e a auditoria guarda o antes", async () => {
  await salvar(ids.ato, dia("2039-04-25", { saida2: "17:00" }));
  const log = await db.adminAuditLog.findFirst({ where: { adminUsuario: ator.usuario }, orderBy: { createdAt: "desc" }, select: { metadata: true } });
  const meta = log?.metadata as { antes: { saida2: number }; depois: { saida2: number } };
  assert.deepEqual([meta.antes.saida2, meta.depois.saida2], [1200, 1020]);
});

test("se a auditoria falha, o dia não é gravado", async () => {
  await assert.rejects(ts.salvarDia({ profissionalId: ids.ato, ciclo: CICLO, dia: dia("2039-04-26"), ator: { ...ator, id: "nao-e-uuid" }, hoje: HOJE, cicloAtivo: CICLO }));
  const folha = await ts.carregarFolha(ids.ato, CICLO, HOJE);
  assert.equal(folha.dias.find((d) => d.data === "2039-04-26")?.entrada1, null);
});

test("isolamento: a folha de um fornecedor não aparece na de outro", async () => {
  const outra = await ts.carregarFolha(ids.outroAto, CICLO, HOJE);
  assert.ok(outra.dias.every((d) => d.entrada1 === null));
  assert.deepEqual(outra.totais, { hn: 0, he50: 0, he100: 0, total: 0 });
});

test("validação na borda: data fora do ciclo, horário e texto inválidos", async () => {
  await rejeita(salvar(ids.ato, dia("2039-05-21")), 400, /fora do ciclo/);
  await rejeita(salvar(ids.ato, dia("2039-04-22", { saida1: "07:00" })), 400, /saída da manhã/);
  await rejeita(salvar(ids.ato, dia("2039-04-22", { entrada1: "8h" })), 400, /HH:MM/);
  await rejeita(salvar(ids.ato, dia("2039-04-22", { descricao: "x".repeat(201) })), 400, /200/);
  await rejeita(ts.salvarDia({ profissionalId: ids.ato, ciclo: "GERAL", dia: dia("2039-04-22"), ator, hoje: HOJE }), 400, /Ciclo/);
});

test("liberação: dia futuro bloqueado em DIA_A_DIA e liberado em CICLO", async () => {
  await rejeita(salvar(ids.ato, dia("2039-05-10")), 403);
  await db.timesheetCiclo.create({ data: { ciclo: CICLO, liberacao: "CICLO" } });
  await salvar(ids.ato, dia("2039-05-10"));
  assert.equal((await ts.carregarFolha(ids.ato, CICLO, HOJE)).dias.every((d) => d.editavel), true);
  await db.timesheetCiclo.deleteMany({ where: { ciclo: CICLO } });
});

test("feriado cadastrado pela medição vira HE 100% no cálculo", async () => {
  await salvar(ids.ato, dia(FERIADO_MANUAL), "2039-05-20"); // sexta
  await db.feriado.create({ data: { data: new Date(`${FERIADO_MANUAL}T00:00:00Z`), nome: "Feriado municipal", abrangencia: "MUNICIPAL" } });
  const d = (await ts.carregarFolha(ids.ato, CICLO, HOJE)).dias.find((x) => x.data === FERIADO_MANUAL);
  assert.deepEqual([d?.feriado, d?.horas.he100, d?.horas.hn], ["Feriado municipal", 480, 0]);
});

test("ciclo fora do andamento: o fornecedor não lança nem envia num ciclo passado", async () => {
  await rejeita(ts.salvarDia({ profissionalId: ids.ato, ciclo: CICLO, dia: dia("2039-04-22"), ator, hoje: HOJE, cicloAtivo: "3906" }), 403, /ciclo em andamento/);
  await rejeita(ass.enviarFolha({ profissionalId: ids.ato, ciclo: CICLO, ator, cicloAtivo: "3906", assinatura: assinaturaDeTeste() }), 403, /ciclo em andamento/);
  // Sem injeção, vale o ciclo ativo real do banco, que nunca é 3905.
  await rejeita(ts.salvarDia({ profissionalId: ids.ato, ciclo: CICLO, dia: dia("2039-04-22"), ator, hoje: HOJE }), 403);
});

test("envio: dia salvo em branco não conta como preenchido", async () => {
  await ts.salvarDia({ profissionalId: ids.outroAto, ciclo: CICLO, dia: { data: "2039-04-22" }, ator, hoje: HOJE, cicloAtivo: CICLO });
  await rejeita(ass.enviarFolha({ profissionalId: ids.outroAto, ciclo: CICLO, ator, cicloAtivo: CICLO, assinatura: assinaturaDeTeste() }), 400, /ao menos um dia/);
});

test("envio: folha vazia não envia; enviada trava a gravação e não reenvia", async () => {
  await rejeita(ass.enviarFolha({ profissionalId: ids.outroAto, ciclo: CICLO, ator, cicloAtivo: CICLO, assinatura: assinaturaDeTeste() }), 400, /ao menos um dia/);
  await ass.enviarFolha({ profissionalId: ids.ato, ciclo: CICLO, ator, cicloAtivo: CICLO, assinatura: assinaturaDeTeste() });
  const folha = await ts.carregarFolha(ids.ato, CICLO, HOJE);
  assert.equal(folha.status, "ENVIADA");
  assert.ok(folha.enviadaEm);
  assert.ok(folha.dias.every((d) => !d.editavel));
  await rejeita(salvar(ids.ato, dia("2039-04-22")), 409);
  await rejeita(ass.enviarFolha({ profissionalId: ids.ato, ciclo: CICLO, ator, cicloAtivo: CICLO, assinatura: assinaturaDeTeste() }), 409);
  assert.equal(await db.adminAuditLog.count({ where: { adminUsuario: ator.usuario, action: "TIMESHEET_ENVIADA" } }), 1);
});

test("rotas do fornecedor: sessão COLABORADOR e fornecedor só pela sessão", async () => {
  const fs = await import("node:fs");
  for (const arquivo of ["app/api/colaborador/timesheet/route.ts", "app/api/colaborador/timesheet/dia/route.ts", "app/api/colaborador/timesheet/enviar/route.ts"]) {
    const fonte = fs.readFileSync(arquivo, "utf8");
    assert.match(fonte, /await getCurrentUser\(\)/, arquivo);
    assert.match(fonte, /user\.perfil !== "COLABORADOR"/, arquivo);
    assert.match(fonte, /getColaboradorEscopo\(user\.usuario\)/, arquivo);
    assert.doesNotMatch(fonte, /profissionalId\s*[:=]\s*(body|params|searchParams|request)/, arquivo);
  }
});
