import { expect, type Page } from "@playwright/test";
import path from "node:path";

/** Portal do Fornecedor (perfil COLABORADOR) — components/colaborador-app.tsx. */
export class PortalPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  async downloadMascara() {
    const downloadPromise = this.page.waitForEvent("download");
    await this.page.getByRole("link", { name: "Baixar máscara" }).click();
    return downloadPromise;
  }

  async uploadMascara(fixtureRelativePath: string) {
    const filePath = path.join(process.cwd(), fixtureRelativePath);
    // O input real é oculto (clicado via dropzone) — setInputFiles funciona diretamente nele,
    // sem precisar simular o clique/drag visual (mesma abordagem recomendada pelo Playwright).
    await this.page.locator('input[type="file"][accept=".xlsx,.xlsm"]').setInputFiles(filePath);
    const responsePromise = this.page.waitForResponse((r) => r.url().includes("/api/colaborador/conferencia/upload"));
    await this.page.getByRole("button", { name: "Enviar", exact: true }).click();
    await responsePromise;
  }

  async expectEmAnalise() {
    await expect(this.page.getByText("Análise em andamento")).toBeVisible();
    await expect(this.page.getByText("EM ANÁLISE")).toBeVisible();
    await expect(this.page.getByText(/DIVERGÊNCIA/)).toHaveCount(0);
    await expect(this.page.getByText(/foram encontradas divergências/i)).toHaveCount(0);
  }

  async salvarEEnviarBm() {
    await this.page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(this.page.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
    // handleEnviar() usa window.confirm() — o Playwright descarta diálogos nativos por padrão,
    // então sem isso o clique parece "não fazer nada" (o BM nunca avança de PENDENTE).
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.page.getByRole("button", { name: "Enviar", exact: true }).click();
  }

  async solicitarRevisao(motivo: string) {
    await this.page.getByRole("button", { name: "Solicitar revisão" }).click();
    await this.page.getByRole("textbox").last().fill(motivo);
    await this.page.getByRole("button", { name: "Enviar revisão" }).click();
  }

  async uploadNf(fixtureRelativePath: string) {
    const filePath = path.join(process.cwd(), fixtureRelativePath);
    await this.page.locator('input[type="file"][accept=".pdf"]').first().setInputFiles(filePath);
    await this.page.getByRole("button", { name: /Enviar NF/i }).click();
  }

  async expectStatusBadge(label: string) {
    await expect(this.page.getByText(label, { exact: true }).first()).toBeVisible();
  }
}
