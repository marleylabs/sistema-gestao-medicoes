import { expect, type Page } from "@playwright/test";

/** Área "Evidências" (components/evidencias/evidencias-workspace.tsx). */
export class EvidenciasPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/?section=evidencias");
    await expect(this.page.getByRole("heading", { name: "Evidências", exact: true, level: 1 }).last()).toBeVisible();
  }

  /** O filtro Fornecedor fica no popover "Filtros" (o Ciclo está sempre visível na toolbar). */
  private async abrirFiltros() {
    const fornecedor = this.page.getByPlaceholder("Todos os fornecedores / buscar…");
    if (!(await fornecedor.isVisible())) await this.page.getByRole("button", { name: /^Filtros/ }).click();
  }

  async selectCiclo(ciclo: string) {
    await this.page.getByRole("combobox", { name: "Ciclo", exact: true }).selectOption(ciclo);
  }

  async selectFornecedor(nome: string) {
    await this.abrirFiltros();
    await this.page.getByPlaceholder("Todos os fornecedores / buscar…").fill(nome);
    await this.page.getByRole("button", { name: new RegExp(nome, "i") }).click();
  }

  /** Linha → painel de detalhe → "Ver BM" (BoletimMedicao completo, com a impressão de sempre). */
  async verBoletim(fornecedorNome: string) {
    await this.aguardarLista();
    await this.page.getByRole("row", { name: new RegExp(`Abrir evidência de ${fornecedorNome}`, "i") }).first().click();
    await this.page.getByTestId("evidencia-detalhe").getByRole("button", { name: "Ver BM" }).click();
  }

  /** Fecha o popover de filtros e espera a lista terminar de recarregar (botão Atualizar habilitado). */
  private async aguardarLista() {
    const concluido = this.page.getByRole("button", { name: "Concluído" });
    if (await concluido.isVisible()) await concluido.click();
    await expect(this.page.getByRole("button", { name: "Atualizar" })).toBeEnabled();
  }

  async expectFornecedorDisponivel(nome: string) {
    await this.abrirFiltros();
    await this.page.getByPlaceholder("Todos os fornecedores / buscar…").fill(nome);
    await expect(this.page.getByRole("button", { name: new RegExp(nome, "i") })).toHaveCount(1);
  }
}
