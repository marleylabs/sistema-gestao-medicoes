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
    const resposta = await loginResponse;
    // Sucesso sem troca de senha: o formulário ainda faz window.location.assign("/") depois do POST. Sem
    // esperar essa navegação, o page.goto seguinte do teste corre contra ela e é abortado (net::ERR_ABORTED).
    const corpo: unknown = resposta.ok() ? await resposta.json().catch(() => null) : null;
    const trocaSenha = typeof corpo === "object" && corpo !== null && "requirePasswordChange" in corpo && Boolean(corpo.requirePasswordChange);
    if (resposta.ok() && !trocaSenha) await this.page.waitForURL((url) => url.pathname !== "/login");
  }

  async expectErrorMessage(pattern: RegExp) {
    await expect(this.page.getByText(pattern)).toBeVisible();
  }
}
