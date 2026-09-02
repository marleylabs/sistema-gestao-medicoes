import { expect, type Page } from "@playwright/test";

/** Página "Visão Geral" (MEDICAO/ADMIN) — onde vive a tabela "Pagamentos por fornecedor" com o botão Enviar BM. */
export class PagamentosPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/?section=visao");
  }

  async selectCiclo(ciclo: string) {
    const select = this.page.locator(`select:has(option[value="${ciclo}"])`).first();
    await select.selectOption(ciclo);
  }

  private table() {
    // "Tipos e Preços por fornecedor" também lista o nome do fornecedor numa tabela diferente —
    // escopa pela tabela "Pagamentos por fornecedor", identificável pela coluna "AÇÕES", única a ela.
    return this.page.locator("table").filter({ has: this.page.getByText("Ações", { exact: true }) });
  }

  private rowFor(fornecedorNome: string) {
    return this.table().locator("tr", { hasText: fornecedorNome });
  }

  async enviarBm(fornecedorNome: string) {
    const row = this.rowFor(fornecedorNome);
    await expect(row).toBeVisible();
    const responsePromise = this.page.waitForResponse((r) => r.url().includes("/api/sgc/enviar") && r.request().method() === "POST");
    await row.getByRole("button", { name: /Enviar BM/i }).click();
    await responsePromise;
  }

  async retornarBm(fornecedorNome: string) {
    const row = this.rowFor(fornecedorNome);
    await expect(row).toBeVisible();
    const responsePromise = this.page.waitForResponse((r) => r.url().includes("/api/admin/financeiro") && r.request().method() === "POST");
    // retornarBm() usa window.confirm() — mesmo cuidado de salvarEEnviarBm().
    this.page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: /Retornar BM/i }).click();
    await responsePromise;
  }

  async expectStatusBadge(fornecedorNome: string, label: string) {
    await expect(this.rowFor(fornecedorNome)).toContainText(label);
  }

  async abrirEditarPagamento(fornecedorNome: string) {
    await this.rowFor(fornecedorNome).getByRole("button", { name: "Editar pagamento" }).click();
    // O heading do modal está sempre presente; a seção "Divergências da Medição" só aparece
    // quando há divergências pendentes — não pode ser a condição de "modal aberto".
    await expect(this.page.getByRole("heading", { name: "Editar pagamento" })).toBeVisible();
  }

  private divergenciaCard(nrVale: string) {
    // Sobe até o primeiro <div> ancestral do NR VALE que contenha o botão "Incluir" (estado
    // PENDENTE) OU o texto "Resolvido por" (estado INCLUIDA/DESCARTADA) — uma dessas duas
    // condições é sempre verdadeira para o card da divergência, em qualquer estado, sem
    // depender de classes/markup.
    return this.page
      .getByText(nrVale, { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Incluir"] or contains(., "Resolvido por")][1]');
  }

  async incluirDivergencia(nrVale: string) {
    const responsePromise = this.page.waitForResponse((r) => /\/api\/admin\/conferencia\/.+\/incluir$/.test(r.url()) && r.request().method() === "POST");
    await this.divergenciaCard(nrVale).getByRole("button", { name: "Incluir" }).click();
    await responsePromise;
  }

  async expectDescartarDesabilitado(nrVale: string) {
    await expect(this.divergenciaCard(nrVale).getByRole("button", { name: "Descartar" })).toBeDisabled();
  }

  async descartarDivergencia(nrVale: string, observacao: string) {
    const card = this.divergenciaCard(nrVale);
    await card.getByPlaceholder("Informe uma observação sobre esta divergência...").fill(observacao);
    // Sem esperar a resposta real, um segundo Incluir/Descartar em sequência (loop sobre várias
    // divergências pendentes) corre na frente do primeiro POST ainda em voo — mesma classe de race
    // condition já corrigida em enviarBm/uploadMascara nesta sessão.
    const responsePromise = this.page.waitForResponse((r) => /\/api\/admin\/conferencia\/.+\/descartar$/.test(r.url()) && r.request().method() === "POST");
    await card.getByRole("button", { name: "Descartar" }).click();
    await responsePromise;
  }

  async fecharModalPagamento() {
    await this.page.getByRole("button", { name: "Cancelar" }).click();
  }
}
