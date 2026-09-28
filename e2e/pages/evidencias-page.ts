import { expect, type Page } from "@playwright/test";

/** Aba "Evidências" (components/medicoes-app.tsx, EvidenciasSection). */
export class EvidenciasPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/?section=evidencias");
  }

  private async abrirFiltros() {
    const ciclo = this.page.getByRole("combobox", { name: "Ciclo", exact: true });
    if (!(await ciclo.isVisible())) await this.page.getByRole("button", { name: /^Filtros/ }).click();
  }

  async selectCiclo(ciclo: string) {
    await this.abrirFiltros();
    await this.page.getByRole("combobox", { name: "Ciclo", exact: true }).selectOption(ciclo);
  }

  async selectFornecedor(nome: string) {
    await this.abrirFiltros();
    await this.page.getByPlaceholder("Todos os fornecedores / buscar…").fill(nome);
    await this.page.getByRole("button", { name: new RegExp(nome, "i") }).click();
  }

  async verBoletim(fornecedorNome: string) {
    const card = this.page
      .getByText(fornecedorNome, { exact: true })
      .locator("xpath=ancestor::*[contains(@class, 'justify-between')][1]");
    await card.getByRole("button", { name: "Ver boletim" }).click();
  }

  async expectFornecedorDisponivel(nome: string) {
    await this.abrirFiltros();
    await this.page.getByPlaceholder("Todos os fornecedores / buscar…").fill(nome);
    await expect(this.page.getByRole("button", { name: new RegExp(nome, "i") })).toHaveCount(1);
  }
}
