import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { APIRequestContext, Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { e2eUsers } from "./fixtures";
import { LoginPage } from "./pages/login-page";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Timesheet ATO pelo painel da medição (T10 do plano docs/brain/specs/timesheet-ato-plano.md).
 * Fornecedor ATO DEDICADO (prefixo "E2E Timesheet", também limpo pelo seed) preenche dois dias e
 * envia pela API; a medição acompanha, cadastra um feriado (o dia vira HE 100%), reabre e exporta.
 */

const ATO = { usuario: "P0909973", nome: "E2E Timesheet Medicao ATO" };
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;
const FERIADO_NOME = "E2E Timesheet Feriado";

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let profissionalId = "";
let dias: string[] = [];
let liberacaoAnterior: string | null = null;
let fornecedor: APIRequestContext;

async function limpar() {
  const p = await prisma.profissional.findUnique({ where: { codigo: ATO.usuario }, select: { id: true } });
  await prisma.feriado.deleteMany({ where: { nome: FERIADO_NOME } });
  await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminUsuario: ATO.usuario }, { targetCodigo: ATO.usuario }] } });
  if (p) {
    await prisma.timesheetFolha.deleteMany({ where: { profissionalId: p.id } });
    await prisma.timesheetConfig.deleteMany({ where: { profissionalId: p.id } });
  }
  await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: ATO.usuario } });
  await prisma.profissional.deleteMany({ where: { codigo: ATO.usuario } });
  await prisma.usuario.deleteMany({ where: { usuario: ATO.usuario } });
}

async function entrarComoMedicao(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
  await page.goto("/?section=timesheet");
  await expect(page.getByTestId("timesheet-workspace")).toBeVisible();
  await expect(page.getByTestId(`timesheet-linha-${ATO.usuario}`)).toBeVisible();
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

test.beforeAll(async ({ baseURL }) => {
  await assertConnectedToE2eDatabase();
  await limpar();
  await prisma.usuario.create({ data: { usuario: ATO.usuario, nome: ATO.nome, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });
  profissionalId = (await prisma.profissional.create({ data: { nome: ATO.usuario, codigo: ATO.usuario, nomeCompleto: ATO.nome, statusColaborador: "ATO" }, select: { id: true } })).id;
  await prisma.cadastroFornecedor.create({ data: { colaboradorCodigo: ATO.usuario, responsavel: ATO.nome, razaoSocial: `${ATO.nome} LTDA`, cnpjNormalizado: "11222333000181" } });

  fornecedor = await playwrightRequest.newContext({ baseURL });
  const login = await fornecedor.post("/api/auth/login", { data: { usuario: ATO.usuario, senha: SENHA } });
  expect(login.ok()).toBeTruthy();
  const folha = await (await fornecedor.get("/api/colaborador/timesheet")).json() as { ciclo: string; dias: Array<{ data: string; tipo: string }> };
  ciclo = folha.ciclo;
  dias = folha.dias.filter((d) => d.tipo === "UTIL").slice(0, 2).map((d) => d.data);

  liberacaoAnterior = (await prisma.timesheetCiclo.findUnique({ where: { ciclo } }))?.liberacao ?? null;
  await prisma.timesheetCiclo.upsert({ where: { ciclo }, create: { ciclo, liberacao: "CICLO" }, update: { liberacao: "CICLO" } });
  for (const data of dias) {
    const r = await fornecedor.put("/api/colaborador/timesheet/dia", { data: { ciclo, data, entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2: "17:00", projetoPep: "PEP-E2E" } });
    expect(r.status()).toBe(200);
  }
  expect((await fornecedor.post("/api/colaborador/timesheet/enviar", { data: { ciclo } })).status()).toBe(200);
});

test.afterAll(async () => {
  await fornecedor?.dispose();
  await limpar();
  if (liberacaoAnterior) await prisma.timesheetCiclo.update({ where: { ciclo }, data: { liberacao: liberacaoAnterior } });
  else await prisma.timesheetCiclo.deleteMany({ where: { ciclo } });
});

test.describe.serial("Timesheet ATO no painel da medição", () => {
  test("acompanhamento mostra a folha enviada com último preenchimento, totais e histórico", async ({ page }) => {
    await entrarComoMedicao(page);
    const linha = page.getByTestId(`timesheet-linha-${ATO.usuario}`);
    await expect(linha).toContainText("Enviada");
    await expect(linha).toContainText("16:00");
    await expect(linha).not.toContainText("—"); // último preenchimento com data e hora

    await linha.click();
    const gaveta = page.getByTestId("timesheet-drawer");
    await expect(gaveta.getByTestId("timesheet-total-hn")).toHaveText("16:00");
    await gaveta.getByRole("tab", { name: "Histórico" }).click();
    const historico = gaveta.getByTestId("timesheet-historico");
    await expect(historico.getByText("Folha enviada")).toBeVisible();
    await expect(historico.getByText(`Dia salvo · ${dataBr(dias[0])}`)).toBeVisible();
  });

  test("feriado cadastrado no calendário vira HE 100% e avisa que foi depois do envio", async ({ page }) => {
    await entrarComoMedicao(page);
    await page.getByRole("tab", { name: "Feriados" }).click();
    await page.getByRole("button", { name: `Cadastrar feriado em ${dataBr(dias[0])}` }).click();
    const dialogo = page.getByRole("dialog", { name: `Feriado em ${dataBr(dias[0])}` });
    await dialogo.getByLabel("Nome").fill(FERIADO_NOME);
    await dialogo.getByRole("button", { name: "Cadastrar feriado" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByTestId("timesheet-feriados-lista")).toContainText(FERIADO_NOME);

    await page.getByRole("tab", { name: "Acompanhamento" }).click();
    const linha = page.getByTestId(`timesheet-linha-${ATO.usuario}`);
    await expect(linha.getByLabel("Feriado cadastrado depois do envio")).toBeVisible();
    await linha.click();
    const gaveta = page.getByTestId("timesheet-drawer");
    await expect(gaveta.getByText("Um feriado foi cadastrado depois do envio.", { exact: false })).toBeVisible();
    await expect(gaveta.getByTestId("timesheet-total-hn")).toHaveText("8:00");
    await expect(gaveta.getByTestId("timesheet-total-he100")).toHaveText("8:00");
  });

  test("exporta XLSX e abre a folha para impressão; fornecedor não acessa a impressão", async ({ page }) => {
    await entrarComoMedicao(page);
    await page.getByTestId(`timesheet-linha-${ATO.usuario}`).click();
    const gaveta = page.getByTestId("timesheet-drawer");
    const [download] = await Promise.all([page.waitForEvent("download"), gaveta.getByRole("link", { name: "Baixar XLSX" }).click()]);
    expect(download.suggestedFilename()).toBe(`timesheet_${ciclo}_${ATO.usuario}.xlsx`);

    await page.goto(`/timesheet/imprimir/${profissionalId}?ciclo=${ciclo}`);
    await expect(page.getByTestId("timesheet-impressao")).toContainText(ATO.nome);
    await expect(page.getByTestId("timesheet-impressao-total")).toContainText("16:00");

    const exportacoes = await prisma.adminAuditLog.count({ where: { targetCodigo: ATO.usuario, action: "TIMESHEET_EXPORTADA" } });
    expect(exportacoes).toBeGreaterThanOrEqual(2); // XLSX + PDF

    const impressao = await fornecedor.get(`/timesheet/imprimir/${profissionalId}?ciclo=${ciclo}`);
    expect(impressao.status()).toBe(404);
    expect((await fornecedor.get(`/api/admin/timesheet?ciclo=${ciclo}`)).status()).toBe(403);
  });

  test("reabrir devolve a folha ao fornecedor, que volta a gravar", async ({ page }) => {
    await entrarComoMedicao(page);
    await page.getByTestId(`timesheet-linha-${ATO.usuario}`).click();
    const gaveta = page.getByTestId("timesheet-drawer");
    await gaveta.getByRole("button", { name: "Reabrir folha" }).click();
    const confirmar = page.getByRole("alertdialog", { name: "Reabrir folha" });
    await confirmar.getByRole("button", { name: "Reabrir folha" }).click();
    await expect(confirmar).toBeHidden();
    await expect(gaveta.getByText("Aberta", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`timesheet-linha-${ATO.usuario}`)).toContainText("Em preenchimento");

    const r = await fornecedor.put("/api/colaborador/timesheet/dia", { data: { ciclo, data: dias[1], entrada1: "08:00", saida1: "12:00" } });
    expect(r.status()).toBe(200);
  });
});
