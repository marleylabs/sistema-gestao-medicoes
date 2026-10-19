import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";

/**
 * Bug: no celular e no tablet o menu da conta fica na gaveta lateral, e o modal "Configurações"
 * nascia preso a ela (288 px), cortado. O modal precisa ocupar a viewport em qualquer largura.
 */

async function abrirConta(page: Page, largura: number) {
  await page.setViewportSize({ width: largura, height: 700 });
  await page.goto("/");
  if (largura < 1024) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.locator('button[title="Conta"]:visible').first().click();
  await page.getByRole("button", { name: /Configurações/ }).click();
  return page.getByRole("dialog", { name: "Configurações da conta" });
}

for (const [perfil, usuario] of [["interno", e2eUsers.admin], ["fornecedor", e2eUsers.fornecedorA]] as const) {
  test(`modal da conta (${perfil}) ocupa a viewport, sem corte, do celular ao desktop`, async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(usuario.usuario, usuario.senha);
    for (const largura of [375, 768, 1280]) {
      const modal = await abrirConta(page, largura);
      await expect(modal).toBeVisible();
      const box = (await modal.boundingBox())!;
      expect(box.x, `${largura}: borda esquerda`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${largura}: borda direita`).toBeLessThanOrEqual(largura);
      expect(box.width, `${largura}: largura`).toBeGreaterThanOrEqual(Math.min(largura - 32, 600));
      // O fim do conteúdo é alcançável (rola dentro do modal) e não fica escondido.
      const acesso = modal.getByRole("heading", { name: "Acesso", exact: true });
      await acesso.scrollIntoViewIfNeeded();
      const a = (await acesso.boundingBox())!;
      expect(await modal.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), { x: a.x + 4, y: a.y + a.height / 2 }), `${largura}: "Acesso" visível`).toBe(true);
      await expect(modal).toContainText(usuario.usuario);
      await modal.getByRole("button", { name: "Fechar" }).click();
      await expect(modal).toHaveCount(0);
    }
  });
}
