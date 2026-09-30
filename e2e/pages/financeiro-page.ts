import { expect, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Painel Financeiro (components/financeiro-panel.tsx). A linha da tabela mostra o status; Ver BM,
 * NF, comprovante e "Marcar pago" ficam no detalhe lateral aberto pela linha.
 */
export class FinanceiroPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/?section=financeiro");
  }

  private rowFor(fornecedorNome: string) {
    return this.page.getByTestId("financeiro-tabela").locator("tbody tr", { hasText: fornecedorNome }).first();
  }

  private detalhe() {
    return this.page.getByTestId("financeiro-detalhe");
  }

  async abrirDetalhe(fornecedorNome: string) {
    const aberto = this.detalhe().getByRole("heading", { name: fornecedorNome, level: 2 });
    if (await aberto.isVisible().catch(() => false)) return;
    await this.rowFor(fornecedorNome).click();
    await expect(aberto).toBeVisible();
  }

  async verBm(fornecedorNome: string) {
    await this.abrirDetalhe(fornecedorNome);
    await this.detalhe().getByRole("button", { name: "Ver BM" }).click();
  }

  async marcarPago(fornecedorNome: string, comprovanteFixture?: string) {
    await this.abrirDetalhe(fornecedorNome);
    await this.detalhe().getByRole("button", { name: "Marcar pago" }).click();
    if (comprovanteFixture) {
      const filePath = path.join(process.cwd(), comprovanteFixture);
      await this.detalhe().locator('input[type="file"][accept=".pdf,.jpg,.jpeg,.png"]').setInputFiles(filePath);
    }
    await this.detalhe().getByRole("button", { name: "Confirmar pagamento" }).click();
  }

  async expectStatusBadge(fornecedorNome: string, label: string) {
    await expect(this.rowFor(fornecedorNome)).toContainText(label);
  }

  async expectNoMarcarPagoButton(fornecedorNome: string) {
    await this.abrirDetalhe(fornecedorNome);
    await expect(this.detalhe().getByRole("button", { name: "Marcar pago" })).toHaveCount(0);
  }
}
