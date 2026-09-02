import { expect, type Page } from "@playwright/test";

/** Page Object mínimo do login — só o que os specs realmente precisam, sem abstração excessiva. */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/login");
  }

  async login(usuario: string, senha: string) {
    await this.page.getByLabel("ID de acesso").fill(usuario);
    await this.page.getByLabel("Senha").fill(senha);
    // Espera o POST de fato terminar (sucesso ou falha) antes de devolver o controle — sem isso,
    // um `page.goto()` logo em seguida pode disparar antes da sessão existir (race condition real
    // encontrada nesta suíte: login parecia "não funcionar" porque a navegação seguinte corria na
    // frente do POST /api/auth/login ainda em voo).
    const loginResponse = this.page.waitForResponse((res) => res.url().endsWith("/api/auth/login") && res.request().method() === "POST");
    await this.page.getByRole("button", { name: /Entrar/i }).click();
    await loginResponse;
  }

  async expectErrorMessage(pattern: RegExp) {
    await expect(this.page.getByText(pattern)).toBeVisible();
  }
}
