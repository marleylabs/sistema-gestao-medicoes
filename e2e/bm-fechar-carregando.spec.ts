import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";

/**
 * Fechar o visualizador do BM enquanto ele carrega: a resposta que chega depois não pode reabri-lo.
 * O bug: o painel fazia `setBm(dados)` ao fim do fetch mesmo com o visualizador já fechado.
 * Histórico, Evidências e Financeiro usam o mesmo `useVisualizadorBm` (guarda em tests/tema-tokens.test.ts);
 * aqui o Histórico, que tem medições no seed.
 */

async function entrar(page: Page, secao: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
  await page.goto(secao);
}

/** Abre o BM com a resposta de /api/admin/bm segura, fecha, libera a resposta e confere que nada reabre. */
async function fecharAntesDaResposta(page: Page, abrirPainel: () => Promise<void>) {
  let liberar = () => {};
  const segurada = new Promise<void>((ok) => { liberar = ok; });
  await page.route("**/api/admin/bm?**", async (rota) => { await segurada; await rota.continue(); });

  await abrirPainel();
  await page.getByRole("button", { name: "Ver BM" }).click();
  const visualizador = page.getByRole("dialog", { name: "Boletim de Medição" });
  await expect(visualizador).toBeVisible();
  await page.getByRole("button", { name: "Fechar boletim" }).click();
  await expect(visualizador).toHaveCount(0);

  const resposta = page.waitForResponse((r) => r.url().includes("/api/admin/bm?"));
  liberar();
  await resposta;
  await page.waitForTimeout(500);
  await expect(visualizador).toHaveCount(0);
  await page.unroute("**/api/admin/bm?**");
  await page.request.post("/api/auth/logout");
}

test("Histórico: fechar o BM durante o carregamento não reabre", async ({ page }) => {
  await entrar(page, "/?section=historico");
  await fecharAntesDaResposta(page, () => page.getByTestId("historico-medicoes").locator("tbody tr").first().click());
});
