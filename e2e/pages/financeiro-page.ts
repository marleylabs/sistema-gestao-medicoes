import { expect, type Page } from "@playwright/test";
import path from "node:path";

/** Painel Financeiro (components/financeiro-panel.tsx). */
export class FinanceiroPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/?section=financeiro");
  }

  private rowFor(fornecedorNome: string) {
    // Depois de "Marcar pago", uma segunda <tr> ("Confirmar pagamento — ...") também contém o
    // nome do fornecedor — a linha de dados real é sempre a primeira no DOM.
    return this.page.locator("tr", { hasText: fornecedorNome }).first();
  }

  async verBm(fornecedorNome: string) {
    await this.rowFor(fornecedorNome).getByRole("button", { name: "Ver BM" }).click();
  }

  async marcarPago(fornecedorNome: string, comprovanteFixture?: string) {
    const row = this.rowFor(fornecedorNome);
    await row.getByRole("button", { name: "Marcar pago" }).click();
    if (comprovanteFixture) {
      const filePath = path.join(process.cwd(), comprovanteFixture);
      await this.page.locator('input[type="file"][accept=".pdf,.jpg,.jpeg,.png"]').setInputFiles(filePath);
    }
    await this.page.getByRole("button", { name: "Confirmar pagamento" }).click();
  }

  async expectStatusBadge(fornecedorNome: string, label: string) {
    await expect(this.rowFor(fornecedorNome)).toContainText(label);
  }

  async expectNoMarcarPagoButton(fornecedorNome: string) {
    await expect(this.rowFor(fornecedorNome).getByRole("button", { name: "Marcar pago" })).toHaveCount(0);
  }
}
