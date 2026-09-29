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
    await expect(page.getByText("Operação por fornecedor", { exact: true })).toBeVisible();

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
