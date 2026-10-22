import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// Fase C do Timesheet ATO (docs/brain/specs/timesheet-ato-plano.md, T5–T7): lado da medição.
// Ciclo 3906 (21/05/2039 a 20/06/2039), separado do 3905 de tests/timesheet.test.ts.
const CICLO = "3906";
const HOJE = "2039-06-20";
const sufixo = `TSM${Date.now()}`;
const ator = { id: "00000000-0000-4000-8000-0000000000b2", usuario: `TESTE-${sufixo}`, nome: "Medição de teste" };
const FERIADO = "2039-06-08"; // quarta
const FERIADO2 = "2039-06-09";

type Lib = typeof import("../lib/timesheet");
type Med = typeof import("../lib/timesheet-medicao");
let ts: Lib;
let med: Med;
const ids = { ato: "", preenchendo: "", manual: "", semStatus: "", desabComFolha: "", desabSemFolha: "" };
let contratoId = "";

async function criarProfissional(nome: string, statusColaborador: string | null) {
  return (await db.profissional.create({ data: { nome: `${nome} ${sufixo}`, codigo: `${nome}-${sufixo}`, statusColaborador }, select: { id: true } })).id;
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
  med = await import("../lib/timesheet-medicao");
  ids.ato = await criarProfissional("ATO", "ATO");
  ids.preenchendo = await criarProfissional("PREENCHE", "ATO");
  ids.manual = await criarProfissional("MANUAL", null);
  ids.semStatus = await criarProfissional("SEMSTATUS", null);
  ids.desabComFolha = await criarProfissional("DESABFOLHA", "ATO");
  ids.desabSemFolha = await criarProfissional("DESAB", "ATO");
  contratoId = (await db.contrato.create({ data: { nome: `Contrato ${sufixo}`, codigo: "5900128908", fiscal: "Fiscal Teste" }, select: { id: true } })).id;
});

after(async () => {
  const todos = Object.values(ids).filter(Boolean);
  await db.adminAuditLog.deleteMany({ where: { adminUsuario: ator.usuario } });
  await db.timesheetFolha.deleteMany({ where: { profissionalId: { in: todos } } });
  await db.timesheetConfig.deleteMany({ where: { profissionalId: { in: todos } } });
  await db.timesheetCiclo.deleteMany({ where: { ciclo: CICLO } });
  await db.feriado.deleteMany({ where: { data: { in: [FERIADO, FERIADO2].map((d) => new Date(`${d}T00:00:00Z`)) } } });
  await db.profissional.deleteMany({ where: { id: { in: todos } } });
  await db.contrato.deleteMany({ where: { nome: { endsWith: sufixo } } });
});

const dia = (data: string, saida2 = "17:00") => ({ data, entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2 });
const salvar = (profissionalId: string, data: string, saida2?: string) => ts.salvarDia({ profissionalId, ciclo: CICLO, dia: dia(data, saida2), ator, hoje: HOJE, cicloAtivo: CICLO });

async function rejeita(promessa: Promise<unknown>, status: number, mensagem?: RegExp) {
  await assert.rejects(promessa, (e: unknown) => {
    assert.ok(e instanceof ts.TimesheetError, String(e));
    assert.equal(e.status, status);
    if (mensagem) assert.match(e.message, mensagem);
    return true;
  });
}

const minhas = async () => {
  const lista = await med.listarFolhasDoCiclo(CICLO);
  return new Map(lista.folhas.filter((f) => Object.values(ids).includes(f.profissionalId)).map((f) => [f.profissionalId, f]));
};

test("lista do ciclo: habilitados, status, último preenchimento e totais", async () => {
  await db.timesheetConfig.create({ data: { profissionalId: ids.manual, habilitado: true } });
  await db.timesheetConfig.create({ data: { profissionalId: ids.desabSemFolha, habilitado: false } });
  await salvar(ids.preenchendo, "2039-05-23", "20:00"); // segunda
  await salvar(ids.preenchendo, "2039-05-28"); // sábado
  await salvar(ids.desabComFolha, "2039-05-24");
  await db.timesheetConfig.create({ data: { profissionalId: ids.desabComFolha, habilitado: false } });

  const m = await minhas();
  assert.equal(m.get(ids.ato)?.status, "NAO_INICIADA");
  assert.equal(m.get(ids.manual)?.habilitado, true);
  assert.equal(m.has(ids.semStatus), false);
  assert.equal(m.has(ids.desabSemFolha), false);
  assert.deepEqual([m.get(ids.desabComFolha)?.habilitado, m.get(ids.desabComFolha)?.status], [false, "EM_PREENCHIMENTO"]);

  const p = m.get(ids.preenchendo);
  assert.equal(p?.status, "EM_PREENCHIMENTO");
  assert.equal(p?.diasPreenchidos, 2);
  assert.ok(p?.ultimoPreenchimento);
  assert.deepEqual(p?.totais, { hn: 480, he50: 180 + 480, he100: 0, total: 1140 });
});

test("a medição lê a folha de quem foi desabilitado depois de preencher; o fornecedor não", async () => {
  const folha = await ts.carregarFolha(ids.desabComFolha, CICLO, HOJE, { paraMedicao: true });
  assert.equal(folha.dias.find((d) => d.data === "2039-05-24")?.entrada1, "08:00");
  await rejeita(ts.carregarFolha(ids.desabComFolha, CICLO, HOJE), 404);
});

test("reabrir: só folha enviada; depois o fornecedor volta a gravar e reenviar", async () => {
  await rejeita(med.reabrirFolha({ profissionalId: ids.preenchendo, ciclo: CICLO, ator }), 409);
  await rejeita(med.reabrirFolha({ profissionalId: ids.ato, ciclo: CICLO, ator }), 404);
  await ts.enviarFolha({ profissionalId: ids.preenchendo, ciclo: CICLO, ator, cicloAtivo: CICLO });
  assert.equal((await minhas()).get(ids.preenchendo)?.status, "ENVIADA");
  await med.reabrirFolha({ profissionalId: ids.preenchendo, ciclo: CICLO, ator });
  await salvar(ids.preenchendo, "2039-05-25");
  await ts.enviarFolha({ profissionalId: ids.preenchendo, ciclo: CICLO, ator, cicloAtivo: CICLO });
  const historico = await med.historicoDaFolha(ids.preenchendo, CICLO);
  assert.deepEqual(historico.slice(0, 4).map((h) => h.acao), ["TIMESHEET_ENVIADA", "TIMESHEET_DIA_SALVO", "TIMESHEET_REABERTA", "TIMESHEET_ENVIADA"]);
  assert.equal(historico[1].data, "2039-05-25");
});

test("liberação do ciclo: valida o valor e grava auditoria", async () => {
  await rejeita(med.definirLiberacao({ ciclo: CICLO, liberacao: "TUDO", ator }), 400);
  await med.definirLiberacao({ ciclo: CICLO, liberacao: "CICLO", ator });
  assert.equal(await ts.getLiberacao(CICLO), "CICLO");
  await med.definirLiberacao({ ciclo: CICLO, liberacao: "DIA_A_DIA", ator });
  assert.equal(await ts.getLiberacao(CICLO), "DIA_A_DIA");
  assert.equal(await db.adminAuditLog.count({ where: { adminUsuario: ator.usuario, action: "TIMESHEET_LIBERACAO" } }), 2);
});

test("feriados: cria, recusa duplicado, nacional e entrada inválida; avisa folha enviada; exclui", async () => {
  await rejeita(med.criarFeriado({ data: "2039-02-30", nome: "X", abrangencia: "MUNICIPAL", ator }), 400, /Data/);
  await rejeita(med.criarFeriado({ data: FERIADO, nome: "", abrangencia: "MUNICIPAL", ator }), 400, /nome/);
  await rejeita(med.criarFeriado({ data: FERIADO, nome: "X", abrangencia: "NACIONAL", ator }), 400, /Abrangência/);
  await rejeita(med.criarFeriado({ data: "2039-04-21", nome: "Tiradentes de novo", abrangencia: "ESTADUAL", ator }), 409, /nacional/);

  const { id } = await med.criarFeriado({ data: FERIADO, nome: "Aniversário da cidade", abrangencia: "MUNICIPAL", ator });
  await rejeita(med.criarFeriado({ data: FERIADO, nome: "Outro", abrangencia: "ESTADUAL", ator }), 409, /Já existe/);
  const lista = await med.listarFolhasDoCiclo(CICLO);
  assert.ok(lista.feriados.some((f) => f.data === FERIADO && f.origem === "MUNICIPAL" && f.id === id));
  assert.equal(lista.folhas.find((f) => f.profissionalId === ids.preenchendo)?.feriadoAposEnvio, true);

  await med.excluirFeriado({ id, ator });
  await rejeita(med.excluirFeriado({ id, ator }), 404);
  await rejeita(med.excluirFeriado({ id: "nao-e-uuid", ator }), 400);
  assert.equal(await db.adminAuditLog.count({ where: { adminUsuario: ator.usuario, targetType: "FERIADO" } }), 2);
});

test("configuração: sobrescrita da habilitação, cabeçalho com contrato e validação", async () => {
  await med.salvarConfig({ profissionalId: ids.ato, valores: { habilitado: false }, ator });
  assert.equal(await ts.getProfissionalHabilitado(ids.ato), null);
  await med.salvarConfig({
    profissionalId: ids.ato,
    valores: { habilitado: null, contratoId, funcao: " Projetista Master ", itemPq: "150", local: "Parauapebas/PA", area: "MINA DO SALOBO", numeroSe: "", docNumero: null },
    ator,
  });
  assert.ok(await ts.getProfissionalHabilitado(ids.ato), "null volta a seguir o status ATO");
  const cfg = await med.getConfig(ids.ato);
  assert.deepEqual([cfg.habilitado, cfg.habilitadoEfetivo, cfg.funcao, cfg.numeroSe], [null, true, "Projetista Master", null]);
  const folha = await ts.carregarFolha(ids.ato, CICLO, HOJE);
  assert.deepEqual([folha.cabecalho.contratoNumero, folha.cabecalho.fiscal, folha.cabecalho.itemPq], ["5900128908", "Fiscal Teste", "150"]);

  await rejeita(med.salvarConfig({ profissionalId: ids.ato, valores: { habilitado: "sim" }, ator }), 400);
  await rejeita(med.salvarConfig({ profissionalId: ids.ato, valores: { habilitado: null, contratoId: "00000000-0000-4000-8000-000000000999" }, ator }), 400, /Contrato/);
  await rejeita(med.salvarConfig({ profissionalId: "x", valores: { habilitado: null }, ator }), 400);
  assert.equal(await db.adminAuditLog.count({ where: { adminUsuario: ator.usuario, action: "TIMESHEET_CONFIG" } }), 2);
});

test("exportação XLSX: cabeçalho, dias, total e assinatura; registra na auditoria", async () => {
  const { planilhaTimesheet, nomeArquivoTimesheet } = await import("../lib/timesheet-export");
  const { parseSimpleXlsx } = await import("../lib/xlsx");
  await med.salvarConfig({ profissionalId: ids.preenchendo, valores: { habilitado: null, contratoId, funcao: "Engenheiro Sênior", itemPq: "100" }, ator });
  const folha = await ts.carregarFolha(ids.preenchendo, CICLO, HOJE, { paraMedicao: true });
  const linhas = parseSimpleXlsx(planilhaTimesheet(folha)).timesheet;
  const texto = (l: unknown[]) => l.map((c) => String(c ?? ""));
  const achar = (rotulo: string) => linhas.find((l) => l[0] === rotulo);

  assert.equal(linhas[0][0], "Folha de Apropriação de Horas");
  assert.deepEqual(texto(achar("Contrato N.º")!).slice(0, 2), ["Contrato N.º", "5900128908"]);
  assert.deepEqual(texto(achar("Função")!).slice(0, 2), ["Função", "Engenheiro Sênior"]);
  assert.deepEqual(texto(achar("Período")!).slice(0, 2), ["Período", "21/05/2039 a 20/06/2039"]);
  const cabecalhoDias = linhas.findIndex((l) => l[0] === "DIA-MÊS");
  assert.equal(linhas.findIndex((l) => l[0] === "TOTAL") - cabecalhoDias - 1, folha.dias.length, "uma linha por dia (31 em 21/05–20/06)");
  const segunda = linhas[cabecalhoDias + 3]; // 23/05/2039
  assert.deepEqual(texto(segunda).slice(1, 9), ["08:00", "12:00", "13:00", "20:00", "8:00", "3:00", "0:00", "11:00"]);
  const total = achar("TOTAL")!;
  assert.deepEqual(texto(total).slice(5, 9), [folha.totais.hn, folha.totais.he50, folha.totais.he100, folha.totais.total].map((m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`));
  assert.ok(linhas.some((l) => String(l[9] ?? "") === "Visto fiscalização da VALE: Fiscal Teste"));
  assert.match(nomeArquivoTimesheet(folha), /^timesheet_3906_PREENCHE-TSM\d+\.xlsx$/);

  await med.registrarExportacao({ profissionalId: ids.preenchendo, ciclo: CICLO, formato: "XLSX", ator });
  assert.equal((await med.historicoDaFolha(ids.preenchendo, CICLO))[0].acao, "TIMESHEET_EXPORTADA");
});

test("rotas da medição: todas exigem requireAdmin antes de qualquer trabalho", () => {
  const raiz = path.join(process.cwd(), "app/api/admin/timesheet");
  const rotas: string[] = [];
  const andar = (dir: string) => {
    for (const nome of fs.readdirSync(dir)) {
      const caminho = path.join(dir, nome);
      if (fs.statSync(caminho).isDirectory()) andar(caminho);
      else if (nome === "route.ts") rotas.push(caminho);
    }
  };
  andar(raiz);
  assert.ok(rotas.length >= 5, `rotas encontradas: ${rotas.length}`);
  for (const rota of rotas) {
    const fonte = fs.readFileSync(rota, "utf8");
    const handlers = fonte.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
    const guardas = fonte.match(/const auth = await requireAdmin\(\);\s*if \(auth\.response\) return auth\.response;/g) ?? [];
    assert.ok(handlers.length > 0 && guardas.length === handlers.length, rota);
  }
});

test("feriado por contrato: vale só para o contrato da configuração; conflitos na mesma data; some com o contrato", async () => {
  // Estado dos testes anteriores: ato e preenchendo estão no `contratoId`; manual, sem contrato.
  const contrato2 = (await db.contrato.create({ data: { nome: `Contrato 2 ${sufixo}` }, select: { id: true } })).id;
  await db.timesheetConfig.update({ where: { profissionalId: ids.manual }, data: { contratoId: contrato2 } });
  const feriadoNaFolha = async (profissionalId: string, data = FERIADO) =>
    (await ts.carregarFolha(profissionalId, CICLO, HOJE, { paraMedicao: true })).dias.find((d) => d.data === data)?.feriado ?? null;

  await med.criarFeriado({ data: FERIADO, nome: "Feriado C1", abrangencia: "MUNICIPAL", contratoId, ator });
  await rejeita(med.criarFeriado({ data: FERIADO, nome: "De novo", abrangencia: "MUNICIPAL", contratoId, ator }), 409, /Feriado C1, contrato/);
  await rejeita(med.criarFeriado({ data: FERIADO, nome: "Geral", abrangencia: "ESTADUAL", ator }), 409, /Feriado C1, contrato/);
  await med.criarFeriado({ data: FERIADO, nome: "Feriado C2", abrangencia: "ESTADUAL", contratoId: contrato2, ator });

  assert.equal(await feriadoNaFolha(ids.ato), "Feriado C1");
  assert.equal(await feriadoNaFolha(ids.manual), "Feriado C2");
  await db.timesheetConfig.update({ where: { profissionalId: ids.manual }, data: { contratoId: null } });
  assert.equal(await feriadoNaFolha(ids.manual), null, "sem contrato recebe só os gerais");

  await med.criarFeriado({ data: FERIADO2, nome: "Geral C", abrangencia: "ESTADUAL", contratoId: "", ator });
  await rejeita(med.criarFeriado({ data: FERIADO2, nome: "Do contrato", abrangencia: "MUNICIPAL", contratoId, ator }), 409, /todos os contratos/);
  assert.deepEqual([await feriadoNaFolha(ids.manual, FERIADO2), await feriadoNaFolha(ids.ato, FERIADO2)], ["Geral C", "Geral C"]);

  const lista = await med.listarFolhasDoCiclo(CICLO);
  assert.deepEqual(
    lista.feriados.filter((f) => f.id).map((f) => [f.nome, f.contratoNome]).sort(),
    [["Feriado C1", `Contrato ${sufixo}`], ["Feriado C2", `Contrato 2 ${sufixo}`], ["Geral C", null]],
  );
  await rejeita(med.criarFeriado({ data: "2039-06-10", nome: "X", abrangencia: "MUNICIPAL", contratoId: "x", ator }), 400, /Contrato/);
  await rejeita(med.criarFeriado({ data: "2039-06-10", nome: "X", abrangencia: "MUNICIPAL", contratoId: "00000000-0000-4000-8000-000000000999", ator }), 400, /Contrato/);

  await db.contrato.delete({ where: { id: contrato2 } });
  assert.equal(await db.feriado.count({ where: { nome: "Feriado C2" } }), 0, "excluir o contrato exclui os feriados dele");
});
