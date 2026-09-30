import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Ciclo publicado no portal (antes "Ativar medição" no Histórico) agora em /fornecedores.
 * CICLO SELECIONADO (consulta interna) ≠ CICLO PUBLICADO (o que o fornecedor vê). Trocar o seletor
 * nunca escreve; só "Publicar ciclo", após confirmação, chama o mesmo PATCH /api/ciclos.
 * Ciclos isolados abaixo do ciclo do seed (não mudam o fallback "mais recente" de outros testes);
 * os flags originais de ativoMedicao são restaurados no fim.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const X = "2603";
const Y = "2604";
let flagsOriginais: { ciclo: string; ativoMedicao: boolean }[] = [];
let codigoFornecedor = "";

async function login(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
}

async function publicarDireto(ciclo: string) {
  await prisma.$transaction([
    prisma.mapaPagamentoContexto.updateMany({ data: { ativoMedicao: false } }),
    prisma.mapaPagamentoContexto.update({ where: { ciclo }, data: { ativoMedicao: true } }),
  ]);
}

async function cicloDoPortal(page: Page) {
  const res = await page.request.get("/api/colaborador/me");
  expect(res.status()).toBe(200);
  return (await res.json()) as { cicloAtivo: string; pagamento: { valor: number } | null };
}

test.describe.serial("Ciclo publicado no portal — controle em /fornecedores", () => {
  test.beforeAll(async ({ browser }) => {
    flagsOriginais = await prisma.mapaPagamentoContexto.findMany({ select: { ciclo: true, ativoMedicao: true } });
    const page = await browser.newPage();
    await login(page, e2eUsers.fornecedorA);
    codigoFornecedor = (await (await page.request.get("/api/colaborador/me")).json()).usuario.codigo;
    await page.request.post("/api/auth/logout");
    await page.close();
    expect(codigoFornecedor).toBeTruthy();
    await prisma.mapaPagamentoItem.deleteMany({ where: { ciclo: { in: [X, Y] } } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [X, Y] } } });
    for (const [ciclo, valor] of [[X, 111], [Y, 222]] as const) {
      await prisma.mapaPagamentoContexto.create({ data: { ciclo, mesReferencia: `E2E ${ciclo}`, atoCiclo: ciclo } });
      await prisma.mapaPagamentoItem.create({ data: { ciclo, ordem: 1, projetistaCodigo: codigoFornecedor, responsavel: codigoFornecedor, valor, sourceRowHash: `e2e-ciclo-publicado-${ciclo}` } });
    }
    await publicarDireto(X);
  });

  test.afterAll(async () => {
    await prisma.mapaPagamentoItem.deleteMany({ where: { ciclo: { in: [X, Y] }, sourceRowHash: { startsWith: "e2e-ciclo-publicado-" } } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [X, Y] } } });
    await prisma.mapaPagamentoContexto.updateMany({ data: { ativoMedicao: false } });
    const ativo = flagsOriginais.find((f) => f.ativoMedicao && f.ciclo !== X && f.ciclo !== Y);
    if (ativo) await prisma.mapaPagamentoContexto.update({ where: { ciclo: ativo.ciclo }, data: { ativoMedicao: true } });
  });

  test("PORTAL: com o ciclo X publicado, o fornecedor vê o BM/pagamento do ciclo X", async ({ page }) => {
    await login(page, e2eUsers.fornecedorA);
    const portal = await cicloDoPortal(page);
    expect(portal.cicloAtivo).toBe(X);
    expect(portal.pagamento?.valor).toBe(111);
    await page.request.post("/api/auth/logout");
  });

  test("SELECIONAR ≠ PUBLICAR: trocar o ciclo em /fornecedores não escreve; Alterar abre confirmação; Cancelar não muda", async ({ page }) => {
    const patches: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/ciclos") && r.method() !== "GET") patches.push(`${r.method()} ${r.url()}`); });
    await login(page, e2eUsers.medicao);
    await page.goto(`/fornecedores?ciclo=${Y}`);
    const controle = page.getByTestId("ciclo-publicado");
    await expect(controle).toContainText(`Ciclo publicado: ${X}`);
    await expect(page.getByTestId("ciclo-publicado-aviso")).toHaveText(`Você está consultando o ciclo ${Y}; o portal continua no ciclo ${X}.`);
    await page.getByRole("combobox", { name: "Ciclo", exact: true }).selectOption(X);
    await page.getByRole("combobox", { name: "Ciclo", exact: true }).selectOption(Y);
    await expect(controle).toContainText(`Ciclo publicado: ${X}`);
    expect(patches, "trocar o ciclo selecionado nunca publica").toEqual([]);

    await controle.getByRole("button", { name: "Alterar" }).click();
    const dialogo = page.getByRole("alertdialog", { name: "Publicar ciclo no portal" });
    await expect(dialogo.getByRole("heading", { name: `Publicar ciclo ${Y}?` })).toBeVisible();
    await expect(dialogo).toContainText(X);
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    expect(patches).toEqual([]);
    expect((await prisma.mapaPagamentoContexto.findUniqueOrThrow({ where: { ciclo: X } })).ativoMedicao).toBe(true);
    await page.request.post("/api/auth/logout");
  });

  test("PUBLICAR: confirmação usa o mesmo PATCH set_ativo_medicao; controle e portal passam para Y", async ({ page }) => {
    await login(page, e2eUsers.medicao);
    await page.goto(`/fornecedores?ciclo=${Y}`);
    const controle = page.getByTestId("ciclo-publicado");
    await controle.getByRole("button", { name: "Alterar" }).click();
    const dialogo = page.getByRole("alertdialog", { name: "Publicar ciclo no portal" });
    const patch = page.waitForRequest((r) => r.url().endsWith("/api/ciclos") && r.method() === "PATCH");
    await dialogo.getByRole("button", { name: "Publicar ciclo" }).click();
    const req = await patch;
    expect(req.postDataJSON()).toEqual({ action: "set_ativo_medicao", ciclo: Y });
    await expect(dialogo).toHaveCount(0);
    await expect(controle).toContainText(`Ciclo publicado: ${Y}`);
    await expect(page.getByTestId("ciclo-publicado-aviso")).toHaveCount(0);
    const ativos = await prisma.mapaPagamentoContexto.findMany({ where: { ativoMedicao: true }, select: { ciclo: true } });
    expect(ativos.map((a) => a.ciclo)).toEqual([Y]);
    await page.request.post("/api/auth/logout");

    await login(page, e2eUsers.fornecedorA);
    const portal = await cicloDoPortal(page);
    expect(portal.cicloAtivo).toBe(Y);
    expect(portal.pagamento?.valor).toBe(222);
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÃO preservada: FINANCEIRO não publica (403, mesma guarda requireAdmin); Histórico não tem mais a ação", async ({ page }) => {
    await login(page, e2eUsers.financeiro);
    const negado = await page.request.patch("/api/ciclos", { data: { action: "set_ativo_medicao", ciclo: X } });
    expect(negado.status()).toBe(403);
    await page.request.post("/api/auth/logout");

    await login(page, e2eUsers.admin);
    await page.goto("/?section=historico");
    await expect(page.getByRole("button", { name: /Ativar medição|Publicar ciclo/ })).toHaveCount(0);
    await page.request.post("/api/auth/logout");
  });
});
