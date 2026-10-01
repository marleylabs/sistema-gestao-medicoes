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

  /** Aprovação = SALVAR (validação) → ENVIAR (confirmado no diálogo "Aprovar boletim"), mesma regra do servidor. */
  async salvarEEnviarBm() {
    await this.page.getByRole("button", { name: "Salvar validação", exact: true }).click();
    await expect(this.page.getByRole("button", { name: "Aprovar boletim", exact: true })).toBeEnabled();
    await this.page.getByRole("button", { name: "Aprovar boletim", exact: true }).click();
    const dialogo = this.page.getByRole("alertdialog", { name: "Aprovar boletim" });
    await dialogo.getByRole("button", { name: "Aprovar boletim" }).click();
    await expect(dialogo).toHaveCount(0);
  }

  async solicitarRevisao(motivo: string) {
    await this.page.getByRole("button", { name: "Solicitar revisão" }).click();
    const dialogo = this.page.getByRole("dialog", { name: "Solicitar revisão" });
    await dialogo.getByLabel("Pontos de discordância").fill(motivo);
    await dialogo.getByRole("button", { name: "Solicitar revisão" }).click();
  }

  async uploadNf(fixtureRelativePath: string) {
    const filePath = path.join(process.cwd(), fixtureRelativePath);
    await this.page.locator('input[type="file"][accept=".pdf"]').first().setInputFiles(filePath);
    await this.page.getByRole("button", { name: /Enviar NF/i }).click();
  }

  /** Badge de status do boletim — rótulo do fornecedor (lib/portal-fornecedor.ts), nunca o enum técnico. */
  async expectStatusBadge(label: string) {
    await expect(this.page.getByTestId("portal-status")).toHaveText(label);
  }
}
