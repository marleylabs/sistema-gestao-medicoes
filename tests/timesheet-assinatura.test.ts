import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import fs from "node:fs";
import { promisify } from "node:util";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { assinaturaDeTeste, dataUrlDeTeste } from "./support/assinatura-png";

// Assinatura eletrônica da folha (docs/brain/specs/timesheet-assinatura.md).
// Ciclo 3908 (21/07/2039 a 20/08/2039), separado dos ciclos dos outros testes de timesheet.
const CICLO = "3908";
const HOJE = "2039-08-20";
const SENHA = `Ts-${randomBytes(6).toString("hex")}`;
const sufixo = `TSA${Date.now()}`;

type Lib = typeof import("../lib/timesheet");
type Ass = typeof import("../lib/timesheet-assinatura");
type Fis = typeof import("../lib/timesheet-fiscal");
type Med = typeof import("../lib/timesheet-medicao");
let ts: Lib;
let ass: Ass;
let fis: Fis;
let med: Med;
let fiscal = { id: "", usuario: "", nome: "" };
let outroFiscal = { id: "", usuario: "", nome: "" };
let colaborador = { id: "", usuario: "", nome: "" };
const ids = { p1: "", p2: "" };

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
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
  fis = await import("../lib/timesheet-fiscal");
  med = await import("../lib/timesheet-medicao");
  const senhaHash = await hashPassword(SENHA);
  const usuario = (nome: string, perfil: string) =>
    db.usuario.create({ data: { usuario: `${nome}-${sufixo}`, nome: `${nome} ${sufixo}`, perfil, senhaHash }, select: { id: true, usuario: true, nome: true } });
  fiscal = await usuario("FIS", "FISCAL");
  outroFiscal = await usuario("FIS2", "FISCAL");
  colaborador = await usuario("COL", "COLABORADOR");
  const contrato = await db.contrato.create({ data: { nome: `CA ${sufixo}`, fiscalId: fiscal.id }, select: { id: true } });
  const contrato2 = await db.contrato.create({ data: { nome: `CB ${sufixo}`, fiscalId: outroFiscal.id }, select: { id: true } });
  const prof = async (nome: string, contratoId: string) => {
    const p = await db.profissional.create({ data: { nome: `${nome} ${sufixo}`, codigo: `${nome}-${sufixo}`, statusColaborador: "ATO" }, select: { id: true } });
    await db.timesheetConfig.create({ data: { profissionalId: p.id, contratoId } });
    return p.id;
  };
  ids.p1 = await prof("PA", contrato.id);
  ids.p2 = await prof("PB", contrato2.id);
});

after(async () => {
  const profs = [ids.p1, ids.p2].filter(Boolean);
  await db.adminAuditLog.deleteMany({ where: { OR: [{ adminUsuario: { endsWith: sufixo } }, { targetCodigo: { endsWith: sufixo } }] } });
  await db.timesheetFolha.deleteMany({ where: { profissionalId: { in: profs } } });
  await db.timesheetConfig.deleteMany({ where: { profissionalId: { in: profs } } });
  await db.profissional.deleteMany({ where: { id: { in: profs } } });
  await db.contrato.deleteMany({ where: { nome: { endsWith: sufixo } } });
  await db.usuario.deleteMany({ where: { usuario: { endsWith: sufixo } } });
});

async function rejeita(promessa: Promise<unknown>, status: number, mensagem?: RegExp) {
  await assert.rejects(promessa, (e: unknown) => {
    assert.ok(e instanceof ts.TimesheetError, String(e));
    assert.equal(e.status, status);
    if (mensagem) assert.match(e.message, mensagem);
    return true;
  });
}

const salvar = (profissionalId: string, data: string, saida2 = "17:00") =>
  ts.salvarDia({ profissionalId, ciclo: CICLO, dia: { data, entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2 }, ator: colaborador, hoje: HOJE, cicloAtivo: CICLO });
const folha = (profissionalId = ids.p1) => ts.carregarFolha(profissionalId, CICLO, HOJE, { paraMedicao: true });
const enviar = (profissionalId = ids.p1) => ass.enviarFolha({ profissionalId, ciclo: CICLO, ator: colaborador, assinatura: assinaturaDeTeste(), ip: "10.0.0.7", cicloAtivo: CICLO });
const assinarFiscal = (quem = fiscal, profissionalId = ids.p1) =>
  fis.assinarComoFiscal({ fiscal: quem, profissionalId, ciclo: CICLO, assinatura: { ...assinaturaDeTeste(), metodo: "DIGITADO" }, ip: "10.0.0.9" });

test("imagem: só PNG em data URL, até 100 KB e dentro dos limites de tamanho", () => {
  assert.ok(ass.validarImagemAssinatura(dataUrlDeTeste()).length > 0);
  const recusa = (valor: unknown, mensagem: RegExp) => assert.throws(() => ass.validarImagemAssinatura(valor), (e: unknown) => e instanceof ts.TimesheetError && e.status === 400 && mensagem.test(e.message));
  recusa(undefined, /Desenhe ou digite/);
  recusa(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`, /Desenhe ou digite/);
  recusa(`data:image/png;base64,${Buffer.from("não é png").toString("base64")}`, /inválida/);
  recusa(`data:image/png;base64,${"A".repeat(200_000)}`, /100 KB/);
  recusa(dataUrlDeTeste(50, 60), /tamanho inválido/);
  recusa(dataUrlDeTeste(200, 2000), /tamanho inválido/);
});

test("senha: confere a do usuário da sessão; modo inválido e senha errada recusam", async () => {
  const ok = await ass.validarAssinatura({ imagem: dataUrlDeTeste(), metodo: "DESENHO", senha: SENHA }, colaborador.id);
  assert.equal(ok.metodo, "DESENHO");
  await rejeita(ass.validarAssinatura({ imagem: dataUrlDeTeste(), metodo: "OUTRO", senha: SENHA }, colaborador.id), 400, /Modo/);
  await rejeita(ass.validarAssinatura({ imagem: dataUrlDeTeste(), metodo: "DESENHO", senha: "errada" }, colaborador.id), 400, /Senha incorreta/);
  await rejeita(ass.validarAssinatura({ imagem: dataUrlDeTeste(), metodo: "DESENHO" }, colaborador.id), 400, /senha/);
});

test("colaborador: envio grava a assinatura na mesma transação; a folha mostra sem o IP", async () => {
  await salvar(ids.p1, "2039-07-21");
  await salvar(ids.p1, "2039-07-22");
  const { codigo } = await enviar();
  assert.match(codigo, /^TS-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const f = await folha();
  assert.equal(f.status, "ENVIADA");
  assert.deepEqual([f.assinaturas.colaborador?.codigo, f.assinaturas.colaborador?.nome, f.assinaturas.colaborador?.alterada], [codigo, colaborador.nome, false]);
  assert.match(f.assinaturas.colaborador?.imagem ?? "", /^data:image\/png;base64,/);
  assert.ok(!("ip" in (f.assinaturas.colaborador ?? {})), "o IP não sai na folha");
  const gravada = await db.timesheetAssinatura.findUniqueOrThrow({ where: { codigo }, select: { ip: true, resumo: true, papel: true } });
  assert.deepEqual([gravada.ip, gravada.papel, (gravada.resumo as { diasLancados: number }).diasLancados], ["10.0.0.7", "COLABORADOR", 2]);
  const log = await db.adminAuditLog.findFirstOrThrow({ where: { adminUsuario: colaborador.usuario, action: "TIMESHEET_ENVIADA" }, select: { metadata: true } });
  assert.equal((log.metadata as { assinatura: { codigo: string } }).assinatura.codigo, codigo);
});

test("fiscal: assina a qualquer momento; uma ativa por vez; outro contrato é 404", async () => {
  const { codigo } = await assinarFiscal();
  await rejeita(assinarFiscal(), 409, /Revogue/);
  await rejeita(assinarFiscal(outroFiscal), 404);
  await rejeita(fis.assinarComoFiscal({ fiscal, profissionalId: ids.p2, ciclo: CICLO, assinatura: assinaturaDeTeste(), ip: null }), 404);
  const f = await folha();
  assert.deepEqual([f.assinaturas.fiscal?.codigo, f.assinaturas.fiscal?.metodo, f.assinaturas.fiscal?.alterada], [codigo, "DIGITADO", false]);
  assert.equal(await db.adminAuditLog.count({ where: { adminUsuario: fiscal.usuario, action: "TIMESHEET_ASSINADA" } }), 1);
});

test("reabertura encerra a do colaborador e mantém a do fiscal; a correção marca a do fiscal como alterada", async () => {
  await med.reabrirFolha({ profissionalId: ids.p1, ciclo: CICLO, ator: { id: "00000000-0000-4000-8000-0000000000e5", usuario: `MED-${sufixo}`, nome: "Medição" } });
  let f = await folha();
  assert.equal(f.assinaturas.colaborador, null);
  assert.ok(f.assinaturas.fiscal);
  const encerrada = await db.timesheetAssinatura.findFirstOrThrow({ where: { papel: "COLABORADOR", folha: { profissionalId: ids.p1 } }, select: { encerramento: true } });
  assert.equal(encerrada.encerramento, "REABERTURA");

  await salvar(ids.p1, "2039-07-22", "18:00");
  f = await folha();
  assert.equal(f.assinaturas.fiscal?.alterada, true, "a folha mudou depois da assinatura do fiscal");
  const { codigo } = await enviar();
  assert.equal((await folha()).assinaturas.colaborador?.codigo, codigo, "o reenvio pede e grava uma assinatura nova");
});

test("revogar: só quem assinou; depois assina de novo; a revogada fica no histórico", async () => {
  await rejeita(fis.revogarAssinaturaFiscal({ fiscal: outroFiscal, profissionalId: ids.p1, ciclo: CICLO }), 404);
  await db.contrato.updateMany({ where: { nome: `CA ${sufixo}` }, data: { fiscalId: outroFiscal.id } });
  await rejeita(fis.revogarAssinaturaFiscal({ fiscal: outroFiscal, profissionalId: ids.p1, ciclo: CICLO }), 403, /Só quem assinou/);
  await db.contrato.updateMany({ where: { nome: `CA ${sufixo}` }, data: { fiscalId: fiscal.id } });

  await fis.revogarAssinaturaFiscal({ fiscal, profissionalId: ids.p1, ciclo: CICLO });
  assert.equal((await folha()).assinaturas.fiscal, null);
  await rejeita(fis.revogarAssinaturaFiscal({ fiscal, profissionalId: ids.p1, ciclo: CICLO }), 404);
  const { codigo } = await assinarFiscal();
  const f = await folha();
  assert.deepEqual([f.assinaturas.fiscal?.codigo, f.assinaturas.fiscal?.alterada], [codigo, false]);
  const fiscais = await db.timesheetAssinatura.findMany({ where: { papel: "FISCAL", folha: { profissionalId: ids.p1 } }, select: { encerramento: true } });
  assert.deepEqual(fiscais.map((a) => a.encerramento).sort(), ["REVOGADA", null].sort());
});

test("verificação: medição vê tudo com IP; fiscal só o escopo dele e sem IP; formato inválido recusa", async () => {
  const codigo = (await folha()).assinaturas.fiscal!.codigo;
  const interna = await ass.verificarAssinatura(codigo.toLowerCase());
  assert.deepEqual([interna.ativa, interna.papel, interna.ip, interna.ciclo, interna.alterada], [true, "FISCAL", "10.0.0.9", CICLO, false]);
  const doFiscal = await fis.verificarAssinaturaDoFiscal(fiscal.id, codigo);
  assert.ok(!("ip" in doFiscal) && !("profissionalId" in doFiscal));
  await rejeita(fis.verificarAssinaturaDoFiscal(outroFiscal.id, codigo), 404);
  await rejeita(ass.verificarAssinatura("ABC"), 400, /formato/);
  await rejeita(ass.verificarAssinatura("TS-ZZZZ-ZZZZ"), 404);
  const revogada = await db.timesheetAssinatura.findFirstOrThrow({ where: { encerramento: "REVOGADA", folha: { profissionalId: ids.p1 } }, select: { codigo: true } });
  assert.equal((await ass.verificarAssinatura(revogada.codigo)).ativa, false);
});

test("XLSX: nome de quem assinou, hora e código nas células de assinatura; sem assinatura, o texto de antes", async () => {
  const { planilhaTimesheet } = await import("../lib/timesheet-export");
  const { readXlsx } = await import("./support/xlsx-reader");
  const f = await folha();
  const celulas = readXlsx(planilhaTimesheet(f, HOJE)).sheets[0].cells;
  assert.match(celulas.get("B46") ?? "", new RegExp(`${colaborador.nome} · assinado eletronicamente às \\d{2}:\\d{2} · código ${f.assinaturas.colaborador!.codigo}`));
  assert.match(celulas.get("K46") ?? "", new RegExp(`Visto fiscalização da VALE:  ${fiscal.nome} · assinado eletronicamente .* · código ${f.assinaturas.fiscal!.codigo}`));
  const semAssinatura = readXlsx(planilhaTimesheet({ ...f, assinaturas: { fiscal: null, colaborador: null } }, HOJE)).sheets[0].cells;
  assert.equal(semAssinatura.get("B46"), f.fornecedor.nome);
});

test("rotas: sessão e perfil antes de qualquer trabalho; o fornecedor vem da sessão; a senha é a do usuário logado", () => {
  const ler = (arquivo: string) => fs.readFileSync(arquivo, "utf8");
  const enviar = ler("app/api/colaborador/timesheet/enviar/route.ts");
  assert.match(enviar, /user\.perfil !== "COLABORADOR"/);
  assert.match(enviar, /validarAssinatura\(dados\.assinatura, user\.id\)/);
  // Habilitação (404) antes da senha, como nas outras rotas do fornecedor; no fiscal, o escopo antes da senha.
  assert.ok(enviar.indexOf("exigirEnvioPermitido(profissionalId") < enviar.indexOf("validarAssinatura("), "habilitação antes da senha");
  const assinaturaFiscal = ler("app/api/fiscal/timesheet/[profissionalId]/assinatura/route.ts");
  assert.ok(assinaturaFiscal.indexOf("exigirNoEscopo(auth.user.id") < assinaturaFiscal.indexOf("validarAssinatura("), "escopo antes da senha");
  assert.match(enviar, /getColaboradorEscopo\(user\.usuario\)/);
  for (const arquivo of ["app/api/fiscal/timesheet/[profissionalId]/assinatura/route.ts", "app/api/fiscal/timesheet/verificar-assinatura/route.ts"]) {
    const fonte = ler(arquivo);
    assert.match(fonte, /const auth = await requireFiscal\(\);\s+if \(auth\.response\) return auth\.response;/, arquivo);
  }
  assert.match(ler("app/api/fiscal/timesheet/[profissionalId]/assinatura/route.ts"), /validarAssinatura\(dados\.assinatura, auth\.user\.id\)/);
  assert.match(ler("app/api/admin/timesheet/verificar-assinatura/route.ts"), /const auth = await requireAdmin\(\);\s+if \(auth\.response\) return auth\.response;/);
});
