import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";

/**
 * Saída animada de modais e painéis (M3 do layout). Enquanto o elemento some, ele precisa ficar inerte:
 * `pointer-events-none` bloqueava só o mouse, e um Enter no botão ainda focado repetia a ação
 * (ex.: um segundo POST de exclusão). Aqui o motion fica ligado, ao contrário do resto da suíte.
 */
test.use({ contextOptions: { reducedMotion: "no-preference" } });

/** Clica em fechar e acompanha a saída quadro a quadro: o alvo ainda existe, fica inerte e o foco sai dele. */
async function fecharEMedir(page: Page, botaoFechar: string, alvo: string) {
  return page.evaluate(async ([botao, seletor]) => {
    document.querySelector<HTMLElement>(botao)!.click();
    const quadro = () => new Promise((ok) => requestAnimationFrame(() => ok(null)));
    let medida = { saindo: false, inerte: false, focoDentro: true };
    for (let i = 0; i < 20 && !medida.inerte; i++) {
      await quadro();
      const el = document.querySelector(seletor);
      if (!el) break;
      medida = { saindo: true, inerte: !!el.closest("[inert]"), focoDentro: true };
    }
    // O navegador tira o foco de um elemento inerte na etapa de renderização seguinte.
    await quadro();
    const el = document.querySelector(seletor);
    return { ...medida, focoDentro: !!el && el.contains(document.activeElement) };
  }, [botaoFechar, alvo] as const);
}

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
