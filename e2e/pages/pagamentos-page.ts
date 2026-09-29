import { expect, type Page } from "@playwright/test";

/**
 * Tela "Fornecedores" (MEDICAO/ADMIN). A tabela é só leitura; as ações (Enviar/Reenviar/Retornar BM,
 * chat, Editar/Excluir pagamento) ficam no detalhe (drawer) aberto ao clicar na linha.
 */
export class PagamentosPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/fornecedores");
  }

  async selectCiclo(ciclo: string) {
    const select = this.page.locator(`select:has(option[value="${ciclo}"])`).first();
    await select.selectOption(ciclo);
  }

  private table() {
    return this.page.getByTestId("fornecedores-tabela");
  }

  private rowFor(fornecedorNome: string) {
    return this.table().locator("tr", { hasText: fornecedorNome });
  }

  /** Abre (ou reaproveita) o detalhe do fornecedor; fecha antes o de outro fornecedor, se houver. */
  async abrirDetalhe(fornecedorNome: string) {
    const detalhe = this.page.getByRole("dialog", { name: `Detalhe de ${fornecedorNome}` });
    if (await detalhe.isVisible()) return detalhe;
    const outroDetalhe = this.page.getByRole("dialog", { name: /^Detalhe de / });
    if (await outroDetalhe.isVisible()) {
      await this.page.keyboard.press("Escape");
      await expect(outroDetalhe).toHaveCount(0);
    }
    const row = this.rowFor(fornecedorNome);
    await expect(row).toBeVisible();
    await row.locator("td").first().click();
    await expect(detalhe).toBeVisible();
    return detalhe;
  }

  async enviarBm(fornecedorNome: string) {
    const detalhe = await this.abrirDetalhe(fornecedorNome);
    const responsePromise = this.page.waitForResponse((r) => r.url().includes("/api/sgc/enviar") && r.request().method() === "POST");
    await detalhe.getByRole("button", { name: /Enviar BM/i }).click();
    await responsePromise;
  }

  async retornarBm(fornecedorNome: string) {
    const detalhe = await this.abrirDetalhe(fornecedorNome);
    const responsePromise = this.page.waitForResponse((r) => r.url().includes("/api/admin/financeiro") && r.request().method() === "POST");
    // retornarBm() usa window.confirm() — mesmo cuidado de salvarEEnviarBm().
    this.page.once("dialog", (dialog) => dialog.accept());
    await detalhe.getByRole("button", { name: /Retornar BM/i }).click();
    await responsePromise;
  }

  async expectStatusBadge(fornecedorNome: string, label: string) {
    await expect(this.rowFor(fornecedorNome)).toContainText(label);
  }

  async expectNoEnviarBm(fornecedorNome: string) {
    const detalhe = await this.abrirDetalhe(fornecedorNome);
    await expect(detalhe.getByRole("button", { name: /Enviar BM/i })).toHaveCount(0);
  }

  async abrirEditarPagamento(fornecedorNome: string) {
    const detalhe = await this.abrirDetalhe(fornecedorNome);
    await detalhe.getByRole("button", { name: "Editar pagamento" }).click();
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
