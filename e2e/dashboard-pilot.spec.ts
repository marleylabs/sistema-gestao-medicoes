import { expect, test, type Page } from "@playwright/test";
import { e2eUsers } from "./fixtures";
import { LoginPage } from "./pages/login-page";

async function loginAdmin(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
  await expect(page.getByRole("main").getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}

test.describe("Dashboard piloto — Wealth + En Passant", () => {
  test("desktop: composição analítica usa dados reais e preserva a operação existente", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    for (const label of ["Valor medido", "Aguardando fornecedor", "Divergências", "Aguardando pagamento"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Evolução das medições", { exact: true })).toBeVisible();
    await expect(page.getByText("Distribuição por contrato", { exact: true })).toBeVisible();
    await expect(page.getByText("Status dos BMs", { exact: true })).toBeVisible();
    await expect(page.getByText("BMs e fornecedores recentes", { exact: true })).toBeVisible();
    // A operação completa saiu do Dashboard (agora em /fornecedores); fica só o resumo com "Ver todos".
    await expect(page.getByText("Operação por fornecedor", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("fornecedores-tabela")).toHaveCount(0);

    // Evolução: eixo em mês/ano (nunca o YYMM cru), valor visível no ponto e valor exato no tooltip.
    const evolucao = page.locator(".recharts-wrapper").first();
    await expect(evolucao.locator(".recharts-cartesian-axis-tick-value", { hasText: "Dez/2026" })).toBeVisible();
    await expect(evolucao.locator(".recharts-cartesian-axis-tick-value", { hasText: /^2612$/ })).toHaveCount(0);
    await expect(evolucao.getByTestId("evolution-data-label").first()).toHaveText(/^R\$\s?[\d.,]+(\s(mil|mi))?$/);
    await evolucao.locator(".recharts-area-dot").first().hover();
    await expect(evolucao.locator(".recharts-tooltip-wrapper")).toContainText("Dezembro de 2026");
    await expect(evolucao.locator(".recharts-tooltip-wrapper")).toContainText(/R\$\s?[\d.]+,\d{2}/);

    const hasGlobalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasGlobalOverflow).toBe(false);

    await page.screenshot({ path: testInfo.outputPath("dashboard-pilot-desktop.png"), fullPage: true });
  });

  test("mobile: KPIs empilham, menu continua acessível e não há overflow global", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAdmin(page);

    await expect(page.getByText("Evolução das medições", { exact: true })).toBeVisible();
    const hasGlobalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasGlobalOverflow).toBe(false);

    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Administrativo" })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("dashboard-pilot-mobile.png"), fullPage: true });
  });
});
