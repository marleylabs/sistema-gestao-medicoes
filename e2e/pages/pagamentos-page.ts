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
    // Salvar/Cancelar no editor de pagamento volta ao detalhe — espera o editor sair antes de decidir.
    await expect(this.page.getByRole("dialog", { name: /^(Editar|Novo) pagamento$/ })).toHaveCount(0);
    const detalhe = this.page.getByRole("dialog", { name: `Detalhe de ${fornecedorNome}` });
    if (await detalhe.isVisible()) return detalhe;
    const outroDetalhe = this.page.getByRole("dialog", { name: /^Detalhe de / });
    if (await outroDetalhe.isVisible()) {
      await this.page.keyboard.press("Escape");
      await expect(outroDetalhe).toHaveCount(0);
    }
    const row = this.rowFor(fornecedorNome);
    await expect(row).toBeVisible();
    await row.locator("td:not(:has(input[type=checkbox]))").first().click();
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

  /** Documento na análise de divergências (components/divergencias/divergencias-medicao.tsx). */
  divergenciaCard(nrVale: string) {
    return this.page.locator(`[data-testid="divergencia-documento"][data-nr-vale="${nrVale}"]`);
  }

  /** Abre (expande) o documento, se estiver recolhido. */
  async abrirDivergencia(nrVale: string) {
    const card = this.divergenciaCard(nrVale);
    const alternar = card.locator("button[aria-expanded]").first();
    // O componente abre sozinho o primeiro pendente logo após o primeiro render (efeito): ler
    // "false" e clicar pode cruzar com essa abertura e fechá-lo. Repete até ficar aberto.
    await expect(async () => {
      if ((await alternar.getAttribute("aria-expanded")) !== "true") await alternar.click();
      await expect(alternar).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    return card;
  }

  /** Decisão do lado indicado (incluir = rota /incluir, descartar = rota /descartar), confirmada no diálogo. */
  private async decidir(nrVale: string, acao: "incluir" | "descartar", observacao?: string) {
    const card = await this.abrirDivergencia(nrVale);
    if (observacao !== undefined) await card.getByLabel("Observação da análise").fill(observacao);
    const botao = card.locator(`button[data-acao="${acao}"]`);
    const label = (await botao.innerText()).trim();
    await botao.click();
    const dialogo = this.page.getByRole("alertdialog", { name: label });
    const rota = new RegExp(`/api/admin/conferencia/.+/${acao}$`);
    const responsePromise = this.page.waitForResponse((r) => rota.test(r.url()) && r.request().method() === "POST");
    await dialogo.getByRole("button", { name: label }).click();
    await responsePromise;
    await expect(dialogo).toHaveCount(0);
  }

  async incluirDivergencia(nrVale: string, observacao?: string) {
    await this.decidir(nrVale, "incluir", observacao);
  }

  async expectDescartarDesabilitado(nrVale: string) {
    const card = await this.abrirDivergencia(nrVale);
    await expect(card.locator('button[data-acao="descartar"]')).toBeDisabled();
  }

  async descartarDivergencia(nrVale: string, observacao: string) {
    await this.decidir(nrVale, "descartar", observacao);
  }

  async fecharModalPagamento() {
    await this.page.getByRole("button", { name: "Cancelar" }).click();
  }
}
