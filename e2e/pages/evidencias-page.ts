import { expect, type Page } from "@playwright/test";

/** Aba "Evidências" (components/medicoes-app.tsx, EvidenciasSection). */
export class EvidenciasPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/?section=evidencias");
  }

  // getByLabel("Ciclo")/("Fornecedor") por texto colide entre os dois <select> nesta tela (o nome
  // acessível de um <label> implícito inclui o texto da <option> selecionada, então "Fornecedor"
  // com a opção "Nenhum Boletim..." pode ser encontrado por buscas parciais inesperadas) — escopa
  // por conteúdo real de <option> em vez disso, mais robusto.
  private cicloSelect() {
    return this.page.locator("select").filter({ has: this.page.locator('option[value="__todos__"]') });
  }
  private fornecedorSelect() {
    return this.page.locator("select").filter({ has: this.page.locator("option", { hasText: /Selecione…|Nenhum Boletim/ }) });
  }

  async selectCiclo(ciclo: string) {
    await this.cicloSelect().selectOption(ciclo);
  }

  async selectFornecedor(nome: string) {
    await this.fornecedorSelect().selectOption({ label: nome });
  }

  async verBoletim() {
    await this.page.getByRole("button", { name: "Ver Boletim" }).click();
  }

  async expectFornecedorDisponivel(nome: string) {
    await expect(this.fornecedorSelect().locator("option", { hasText: nome })).toHaveCount(1);
  }
}
