import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { fecharEMedir } from "./fixtures/saida-animada";

/**
 * Saída animada de modais e painéis (M3 do layout). Enquanto o elemento some, ele precisa ficar inerte:
 * `pointer-events-none` bloqueava só o mouse, e um Enter no botão ainda focado repetia a ação
 * (ex.: um segundo POST de exclusão). Aqui o motion fica ligado, ao contrário do resto da suíte.
 */
test.use({ contextOptions: { reducedMotion: "no-preference" } });

test("durante a saída, o modal e o painel lateral ficam inertes (sem teclado nem leitor de tela)", async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
  await page.goto("/?section=historico");
  await page.getByTestId("historico-medicoes").locator("tbody tr").first().click();
  const painel = page.getByTestId("historico-detalhe-medicao");
  await expect(painel).toBeVisible();

  await painel.getByRole("button", { name: "Ver BM" }).click();
  await expect(page.getByRole("dialog", { name: "Boletim de Medição" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar boletim" }).focus();
  expect(await fecharEMedir(page, '[title="Fechar boletim"]', '[aria-label="Boletim de Medição"]')).toEqual({ saindo: true, inerte: true, focoDentro: false });
  await expect(page.locator('[aria-label="Boletim de Medição"]')).toHaveCount(0);

  await painel.getByRole("button", { name: "Fechar" }).focus();
  expect(await fecharEMedir(page, '[data-testid="historico-detalhe-medicao"] [title="Fechar"]', '[data-testid="historico-detalhe-medicao"]')).toEqual({ saindo: true, inerte: true, focoDentro: false });
  await expect(painel).toHaveCount(0);
  await page.request.post("/api/auth/logout");
});
