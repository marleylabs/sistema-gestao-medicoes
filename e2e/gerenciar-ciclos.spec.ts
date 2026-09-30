import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Gerenciar ciclos em /fornecedores (antes no Histórico). Só a interface mudou: Novo ciclo = mesmo
 * POST /api/ciclos, Excluir = mesmo DELETE (somente ADMIN), Selecionar = troca o ciclo de trabalho
 * sem nenhuma escrita (nunca publica no portal). Ciclos isolados abaixo do ciclo do seed; os flags
 * originais de ativoMedicao são restaurados no fim.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const A = "2601";
const B = "2602";
const NOVO = "2509";
let flagsOriginais: { ciclo: string; ativoMedicao: boolean }[] = [];

async function login(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  // Espera o redirecionamento pós-login terminar — um page.goto() durante essa navegação é abortado.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function escritasEmCiclos(page: Page) {
  const escritas: { method: string; body: unknown }[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/ciclos" && r.method() !== "GET") escritas.push({ method: r.method(), body: r.postDataJSON() });
  });
  return escritas;
}

const publicados = async () =>
  (await prisma.mapaPagamentoContexto.findMany({ where: { ativoMedicao: true }, select: { ciclo: true } })).map((c) => c.ciclo);

test.describe.serial("Gerenciar ciclos — em /fornecedores", () => {
  test.beforeAll(async () => {
    flagsOriginais = await prisma.mapaPagamentoContexto.findMany({ select: { ciclo: true, ativoMedicao: true } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [A, B, NOVO] } } });
    for (const ciclo of [A, B]) await prisma.mapaPagamentoContexto.create({ data: { ciclo, mesReferencia: `E2E Gestão ${ciclo}`, atoCiclo: ciclo } });
  });

  test.afterAll(async () => {
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [A, B, NOVO] } } });
    for (const f of flagsOriginais) {
      await prisma.mapaPagamentoContexto.updateMany({ where: { ciclo: f.ciclo }, data: { ativoMedicao: f.ativoMedicao } });
    }
  });

  test("SELECIONAR: painel lista os ciclos; selecionar troca o ciclo de trabalho, fecha o painel e não publica", async ({ page }) => {
    const escritas = escritasEmCiclos(page);
    const antes = await publicados();
    await login(page, e2eUsers.admin);
    await page.goto(`/fornecedores?ciclo=${B}`);
    const publicadoAntes = await page.getByTestId("ciclo-publicado").innerText();

    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");
    await expect(painel.getByRole("heading", { name: "Gerenciar ciclos" })).toBeVisible();
    const lista = painel.getByTestId("gerenciar-ciclos-lista");
    await expect(lista.locator(`[data-ciclo="${A}"]`)).toBeVisible();
    await expect(lista.locator(`[data-ciclo="${B}"]`)).toContainText("Selecionado");

    await painel.getByRole("button", { name: `Selecionar ciclo ${A}` }).click();
    await expect(painel).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/fornecedores\\?ciclo=${A}$`));
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(A);

    expect(escritas, "selecionar ciclo nunca escreve").toEqual([]);
    expect(await publicados()).toEqual(antes);
    await expect(page.getByTestId("ciclo-publicado")).toContainText(publicadoAntes.split("\n").find((l) => l.startsWith("Ciclo publicado")) ?? "Ciclo publicado");

    // Fechar sem escolher preserva o contexto.
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("gerenciar-ciclos")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(A);
    expect(escritas).toEqual([]);
    await page.request.post("/api/auth/logout");
  });

  test("NOVO CICLO: mesmo POST /api/ciclos; o ciclo criado passa a ser o de trabalho e NÃO é publicado", async ({ page }) => {
    const escritas = escritasEmCiclos(page);
    const antes = await publicados();
    await login(page, e2eUsers.admin);
    await page.goto(`/fornecedores?ciclo=${B}`);
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");
    const input = painel.getByRole("textbox", { name: "Novo ciclo (YYMM)" });
    await input.fill("25");
    await expect(painel.getByRole("button", { name: "Novo ciclo" })).toBeDisabled();
    await input.fill(NOVO);
    await painel.getByRole("button", { name: "Novo ciclo" }).click();
    await expect(painel.getByTestId("gerenciar-ciclos-lista").locator(`[data-ciclo="${NOVO}"]`)).toContainText("Selecionado");
    expect(escritas).toEqual([{ method: "POST", body: { ciclo: NOVO } }]);
    const criado = await prisma.mapaPagamentoContexto.findUniqueOrThrow({ where: { ciclo: NOVO } });
    expect(criado.ativoMedicao).toBe(false);
    expect(await publicados()).toEqual(antes);
    await page.request.post("/api/auth/logout");
  });

  test("EXCLUIR (ADMIN): confirmação do design system; Cancelar não exclui; confirmar envia o mesmo DELETE", async ({ page }) => {
    const escritas = escritasEmCiclos(page);
    let dialogoNativo = false;
    page.on("dialog", async (d) => { dialogoNativo = true; await d.dismiss(); });
    await login(page, e2eUsers.admin);
    await page.goto(`/fornecedores?ciclo=${B}`);
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");

    await painel.getByRole("button", { name: `Excluir ciclo ${NOVO}` }).click();
    const dialogo = page.getByRole("alertdialog", { name: "Excluir ciclo" });
    await expect(dialogo.getByRole("heading", { name: `Excluir o ciclo ${NOVO}?` })).toBeVisible();
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(painel).toBeVisible();
    expect(escritas).toEqual([]);
    expect(await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo: NOVO } })).not.toBeNull();

    // O DELETE real (backend inalterado) também remove Profissionais/Projetos órfãos do banco inteiro —
    // no banco E2E compartilhado isso apagaria fixtures do seed usadas por outros specs. Por isso aqui a
    // requisição é interceptada: verifica-se o payload exato e remove-se só o contexto do ciclo de teste.
    await page.route("**/api/ciclos", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: NOVO } });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ removed: { ciclos: 1 } }) });
    });
    await painel.getByRole("button", { name: `Excluir ciclo ${NOVO}` }).click();
    await dialogo.getByRole("button", { name: "Excluir ciclo" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(painel.getByTestId("gerenciar-ciclos-lista").locator(`[data-ciclo="${NOVO}"]`)).toHaveCount(0);
    expect(escritas).toEqual([{ method: "DELETE", body: { confirmacao: "RESETAR_CICLOS", ciclo: NOVO } }]);
    expect(await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo: NOVO } })).toBeNull();
    expect(dialogoNativo, "sem window.confirm/alert").toBe(false);
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(B);
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÕES: MEDICAO gerencia mas não exclui (botão ausente, DELETE 403); FINANCEIRO não tem controles de ciclo", async ({ page }) => {
    await login(page, e2eUsers.medicao);
    await page.goto(`/fornecedores?ciclo=${B}`);
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");
    await expect(painel.getByRole("button", { name: "Novo ciclo" })).toBeVisible();
    await expect(painel.getByRole("button", { name: `Selecionar ciclo ${A}` })).toBeVisible();
    await expect(painel.getByRole("button", { name: /Excluir ciclo/ })).toHaveCount(0);
    expect((await page.request.delete("/api/ciclos", { data: { confirmacao: "RESETAR_CICLOS", ciclo: A } })).status()).toBe(403);
    await page.request.post("/api/auth/logout");

    await login(page, e2eUsers.financeiro);
    await page.goto("/fornecedores");
    await expect(page.getByRole("button", { name: "Gerenciar ciclos" })).toHaveCount(0);
    await expect(page.getByTestId("ciclo-publicado")).toHaveCount(0);
    expect((await page.request.post("/api/ciclos", { data: { ciclo: NOVO } })).status()).toBe(403);
    await page.request.post("/api/auth/logout");
  });
});
