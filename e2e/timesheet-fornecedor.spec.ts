import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Timesheet ATO no portal (T4 do plano docs/brain/specs/timesheet-ato-plano.md). Fornecedores
 * DEDICADOS (prefixo "E2E Timesheet", também limpo pelo seed): um ATO, que preenche e envia, e um
 * sem status ATO, que não vê a aba nem lê a folha pela API.
 */

const ATO = { usuario: "P0909971", nome: "E2E Timesheet Fornecedor ATO" };
const SEM_ATO = { usuario: "P0909972", nome: "E2E Timesheet Fornecedor Sem ATO" };
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let liberacaoAnterior: string | null = null;

async function limpar() {
  const ids = (await prisma.profissional.findMany({ where: { codigo: { in: [ATO.usuario, SEM_ATO.usuario] } }, select: { id: true } })).map((p) => p.id);
  await prisma.adminAuditLog.deleteMany({ where: { adminUsuario: { in: [ATO.usuario, SEM_ATO.usuario] } } });
  await prisma.timesheetFolha.deleteMany({ where: { profissionalId: { in: ids } } });
  await prisma.timesheetConfig.deleteMany({ where: { profissionalId: { in: ids } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [ATO.usuario, SEM_ATO.usuario] } } });
  await prisma.profissional.deleteMany({ where: { id: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { usuario: { in: [ATO.usuario, SEM_ATO.usuario] } } });
}

async function criarFornecedor(f: typeof ATO, statusColaborador: string | null) {
  await prisma.usuario.create({ data: { usuario: f.usuario, nome: f.nome, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });
  await prisma.profissional.create({ data: { nome: f.usuario, codigo: f.usuario, nomeCompleto: f.nome, statusColaborador } });
  await prisma.cadastroFornecedor.create({
    data: { colaboradorCodigo: f.usuario, responsavel: f.nome, razaoSocial: `${f.nome} LTDA`, cnpjNormalizado: "11222333000181" },
  });
}

async function entrar(page: Page, usuario: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario, SENHA);
  await page.goto("/");
  await expect(page.getByTestId("portal-bm-resumo").or(page.getByText("Aguardando o envio do BM"))).toBeVisible();
}

async function definirLiberacao(liberacao: "DIA_A_DIA" | "CICLO") {
  await prisma.timesheetCiclo.upsert({ where: { ciclo }, create: { ciclo, liberacao }, update: { liberacao } });
}

test.beforeAll(async ({ browser }) => {
  await assertConnectedToE2eDatabase();
  await limpar();
  await criarFornecedor(ATO, "ATO");
  await criarFornecedor(SEM_ATO, null);

  const page = await browser.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(ATO.usuario, SENHA);
  ciclo = (await (await page.request.get("/api/colaborador/me")).json()).cicloAtivo;
  await page.request.post("/api/auth/logout");
  await page.close();
  liberacaoAnterior = (await prisma.timesheetCiclo.findUnique({ where: { ciclo } }))?.liberacao ?? null;
});

test.afterAll(async () => {
  await limpar();
  if (liberacaoAnterior) await definirLiberacao(liberacaoAnterior as "DIA_A_DIA" | "CICLO");
  else await prisma.timesheetCiclo.deleteMany({ where: { ciclo } });
});

test.describe.serial("Timesheet ATO no portal do fornecedor", () => {
  test("fornecedor sem status ATO não vê a aba e a API não entrega folha", async ({ page }) => {
    await entrar(page, SEM_ATO.usuario);
    await expect(page.getByRole("button", { name: "Timesheet", exact: true })).toHaveCount(0);
    const res = await page.request.get("/api/colaborador/timesheet");
    expect(res.status()).toBe(404);
    const put = await page.request.put("/api/colaborador/timesheet/dia", { data: { ciclo, data: "2026-01-01", entrada1: "08:00", saida1: "12:00" } });
    expect(put.status()).toBe(404);
  });

  test("DIA_A_DIA: dias depois de hoje ficam bloqueados (servidor e tela)", async ({ page }) => {
    await definirLiberacao("DIA_A_DIA");
    await entrar(page, ATO.usuario);
    await page.getByRole("button", { name: "Timesheet", exact: true }).first().click();
    const folha = page.getByTestId("timesheet-fornecedor");
    await expect(folha).toBeVisible();

    const dados = await (await page.request.get("/api/colaborador/timesheet")).json() as { dias: Array<{ data: string; editavel: boolean }> };
    const futuro = dados.dias.find((d) => !d.editavel);
    test.skip(!futuro, "o ciclo ativo já terminou: não há dia futuro para bloquear");
    await expect(page.getByTestId(`timesheet-dia-${futuro!.data}`).getByLabel("Dia ainda não liberado")).toBeVisible();
    const put = await page.request.put("/api/colaborador/timesheet/dia", { data: { ciclo, data: futuro!.data, entrada1: "08:00", saida1: "12:00" } });
    expect(put.status()).toBe(403);
  });

  test("preenche dois dias, vê os totais, envia e a folha fica só leitura", async ({ page }) => {
    await definirLiberacao("CICLO");
    await entrar(page, ATO.usuario);
    await page.getByRole("button", { name: "Timesheet", exact: true }).first().click();
    const dados = await (await page.request.get("/api/colaborador/timesheet")).json() as { dias: Array<{ data: string; tipo: string }> };
    const [util1, util2] = dados.dias.filter((d) => d.tipo === "UTIL");

    async function preencher(data: string, saidaFinal: string) {
      const [ano, mes, dia] = data.split("-");
      await page.getByRole("button", { name: `Preencher ${dia}/${mes}/${ano}` }).click();
      const dialogo = page.getByRole("dialog", { name: `Horários de ${dia}/${mes}/${ano}` });
      await dialogo.getByLabel("Entrada", { exact: true }).fill("08:00");
      await dialogo.getByLabel("Saída para o almoço").fill("12:00");
      await dialogo.getByLabel("Volta do almoço").fill("13:00");
      await dialogo.getByLabel("Saída final").fill(saidaFinal);
      await dialogo.getByLabel("Projeto/PEP").fill("PEP-E2E");
      await dialogo.getByRole("button", { name: "Salvar dia" }).click();
      await expect(dialogo).toBeHidden();
    }
    await preencher(util1.data, "17:00");
    await preencher(util2.data, "20:00");

    await expect(page.getByTestId("timesheet-total-hn")).toHaveText("16:00");
    await expect(page.getByTestId("timesheet-total-he50")).toHaveText("3:00");
    await expect(page.getByTestId("timesheet-total-total")).toHaveText("19:00");

    // Ordem inválida: erro dentro do diálogo, nada gravado.
    const [ano, mes, dia] = dados.dias.filter((d) => d.tipo === "UTIL")[2].data.split("-");
    await page.getByRole("button", { name: `Preencher ${dia}/${mes}/${ano}` }).click();
    const dialogo = page.getByRole("dialog", { name: `Horários de ${dia}/${mes}/${ano}` });
    await dialogo.getByLabel("Entrada", { exact: true }).fill("12:00");
    await dialogo.getByLabel("Saída para o almoço").fill("08:00");
    await dialogo.getByRole("button", { name: "Salvar dia" }).click();
    await expect(dialogo.getByRole("alert")).toContainText("A saída da manhã deve ser depois da entrada.");
    await dialogo.getByRole("button", { name: "Cancelar" }).click();

    // Revisão (spec timesheet-assinatura, regra 7): lista os dias úteis vazios e só continua depois da confirmação.
    await page.getByRole("button", { name: "Enviar folha" }).click();
    const revisar = page.getByRole("alertdialog", { name: "Revisar a folha antes de enviar" });
    await expect(revisar).toContainText("2 de");
    const uteisVazios = dados.dias.filter((d) => d.tipo === "UTIL").length - 2;
    await expect(revisar.getByTestId("timesheet-uteis-vazios")).toContainText(`${uteisVazios} dias úteis estão sem lançamento`);
    const continuar = revisar.getByRole("button", { name: "Continuar para a assinatura" });
    await expect(continuar).toBeDisabled();
    await revisar.getByRole("checkbox", { name: /Revisei a folha/ }).check();
    await continuar.click();

    // Assinatura desenhada com o mouse + senha; envio e assinatura são um só ato.
    const assinar = page.getByRole("dialog", { name: "Assinar e enviar a folha" });
    await expect(assinar).toContainText("entre em contato com a equipe de medição");
    const confirmar = assinar.getByRole("button", { name: "Assinar e enviar" });
    await expect(confirmar).toBeDisabled();
    const quadro = await assinar.getByTestId("assinatura-quadro").boundingBox();
    await page.mouse.move(quadro!.x + 40, quadro!.y + quadro!.height / 2);
    await page.mouse.down();
    await page.mouse.move(quadro!.x + 120, quadro!.y + 30, { steps: 5 });
    await page.mouse.move(quadro!.x + 220, quadro!.y + quadro!.height - 30, { steps: 5 });
    await page.mouse.up();
    await assinar.getByLabel("Sua senha").fill("senha-errada");
    await confirmar.click();
    await expect(assinar.getByRole("alert")).toContainText("Senha incorreta.");
    await assinar.getByLabel("Sua senha").fill(SENHA);
    await confirmar.click();
    await expect(assinar).toBeHidden();
    await expect(page.getByTestId("timesheet-assinatura-colaborador")).toContainText(ATO.nome);
    await expect(page.getByTestId("timesheet-assinatura-colaborador")).toContainText(/código TS-[A-Z2-9]{4}-[A-Z2-9]{4}/);

    const folha = page.getByTestId("timesheet-fornecedor");
    await expect(folha.getByText("Enviada", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Preencher|Editar) / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enviar folha" })).toHaveCount(0);
    const put = await page.request.put("/api/colaborador/timesheet/dia", { data: { ciclo, data: util1.data, entrada1: "09:00", saida1: "12:00" } });
    expect(put.status()).toBe(409);

    const auditoria = await prisma.adminAuditLog.count({ where: { adminUsuario: ATO.usuario, targetType: "TIMESHEET_FOLHA" } });
    expect(auditoria).toBe(3); // 2 dias + envio
  });
});
