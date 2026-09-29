import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/test-with-error-guard";
import type { Page } from "@playwright/test";
import { LoginPage } from "./pages/login-page";
import { e2eUsers, e2eCiclo } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * "Editar pagamento" como painel lateral largo integrado ao detalhe do fornecedor (/fornecedores).
 * Fornecedor próprio deste spec (criado e removido aqui) — o salvar nunca altera dados de outras suítes.
 */
const SUFIXO = randomUUID().slice(0, 6).toUpperCase();
const CODIGO = `E2E-EDITOR-${SUFIXO}`;
const NOME = `E2E Editor Pagamento ${SUFIXO}`;
let profissionalId = "";
let itemId = "";

test.beforeAll(async () => {
  await assertConnectedToE2eDatabase();
  const profissional = await prisma.profissional.create({ data: { nome: CODIGO, codigo: CODIGO, nomeCompleto: NOME } });
  profissionalId = profissional.id;
  const item = await prisma.mapaPagamentoItem.create({
    data: { ciclo: e2eCiclo(), ordem: 9900, projetistaCodigo: CODIGO, responsavel: NOME, valor: 100, sourceRowHash: `e2e-editor-${SUFIXO}` },
  });
  itemId = item.id;
});

test.afterAll(async () => {
  await prisma.medicao.deleteMany({ where: { idProfissional: profissionalId } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { id: itemId } });
  await prisma.profissional.deleteMany({ where: { id: profissionalId } });
});

async function abrirDetalhe(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
  await page.goto(`/fornecedores?ciclo=${e2eCiclo()}`);
  const linha = page.getByTestId("fornecedores-tabela").locator("tr", { hasText: NOME });
  if (width >= 768) {
    await linha.locator("td").first().click();
  } else {
    await page.getByTestId("fornecedores-lista-mobile").getByRole("button", { name: new RegExp(NOME) }).click();
  }
  const detalhe = page.getByRole("dialog", { name: `Detalhe de ${NOME}` });
  await expect(detalhe).toBeVisible();
  return detalhe;
}

function editor(page: Page) {
  return page.getByRole("dialog", { name: "Editar pagamento" });
}

test.describe.serial("Editar pagamento — painel lateral contextual", () => {
  test("detalhe → Editar abre o painel lateral largo (não modal central) com fornecedor, status, ciclo e seções", async ({ page }) => {
    const detalhe = await abrirDetalhe(page);
    await detalhe.getByRole("button", { name: "Editar pagamento" }).click();

    const painel = editor(page);
    await expect(painel).toBeVisible();
    await expect(detalhe).toHaveCount(0); // o drawer mudou de modo, não empilhou
    const caixa = await painel.locator("aside").boundingBox();
    const vw = page.viewportSize()!.width;
    expect(Math.round(caixa!.x + caixa!.width)).toBe(vw); // ancorado à direita (lateral), nunca centralizado
    expect(caixa!.width).toBeGreaterThanOrEqual(820);
    expect(caixa!.width).toBeLessThanOrEqual(960);

    await expect(painel.getByRole("heading", { name: "Editar pagamento" })).toBeVisible();
    await expect(painel.getByText(NOME, { exact: true }).first()).toBeVisible();
    await expect(painel.getByText("Aguardando envio", { exact: true })).toBeVisible();
    await expect(painel.getByText(e2eCiclo(), { exact: true })).toBeVisible();
    await expect(painel.getByRole("button", { name: "Voltar ao fornecedor" })).toBeVisible();

    for (const label of ["Pagamento atual", "Condição fixa", "Documentos medidos", "Descontos", "Total medido líquido"]) {
      await expect(painel.getByLabel("Resumo do pagamento").getByText(label, { exact: true })).toBeVisible();
    }
    await expect(painel.getByLabel("Resumo do pagamento")).toContainText("R$ 100,00");
    for (const secao of ["Identificação", "Participação por contrato", "Condição fixa", "Descontos", "Documentos medidos"]) {
      await expect(painel.getByRole("heading", { name: secao, exact: true })).toBeVisible();
    }
    await expect(painel.getByRole("textbox", { name: "Nome", exact: true })).toHaveValue(CODIGO);

    // Adicionar desconto cria a linha (descartada ao voltar — nada é salvo).
    await painel.getByRole("button", { name: "Adicionar desconto" }).click();
    await expect(painel.getByLabel("Valor do desconto")).toBeVisible();

    // Botão flutuante "Conversas" fica atrás do painel.
    const conversas = page.getByRole("button", { name: /Conversas/i }).first();
    if (await conversas.count()) {
      const b = await conversas.boundingBox();
      if (b) {
        const noTopo = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[role='dialog']"), [b.x + b.width / 2, b.y + b.height / 2]);
        expect(noTopo).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // Voltar retorna ao detalhe do MESMO fornecedor, sem salvar.
    await painel.getByRole("button", { name: "Voltar ao fornecedor" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: `Detalhe de ${NOME}` })).toBeVisible();
    expect(await prisma.medicao.count({ where: { idProfissional: profissionalId } })).toBe(0);
  });

  test("Cancelar e Esc voltam ao detalhe sem salvar; X fecha tudo", async ({ page }) => {
    const detalhe = await abrirDetalhe(page);
    await detalhe.getByRole("button", { name: "Editar pagamento" }).click();
    await editor(page).getByLabel("Valor fixo mensal/contratual").fill("R$ 999,00");
    await editor(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: `Detalhe de ${NOME}` })).toBeVisible();
    expect(Number((await prisma.mapaPagamentoItem.findUniqueOrThrow({ where: { id: itemId } })).valor)).toBe(100);

    await page.getByRole("dialog", { name: `Detalhe de ${NOME}` }).getByRole("button", { name: "Editar pagamento" }).click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: `Detalhe de ${NOME}` })).toBeVisible();

    await page.getByRole("dialog", { name: `Detalhe de ${NOME}` }).getByRole("button", { name: "Editar pagamento" }).click();
    await editor(page).getByRole("button", { name: "Fechar" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /^Detalhe de / })).toHaveCount(0);
  });

  test("Salvar alterações persiste, volta ao detalhe atualizado e reflete na tabela sem F5", async ({ page }) => {
    const detalhe = await abrirDetalhe(page);
    await detalhe.getByRole("button", { name: "Editar pagamento" }).click();
    const campo = editor(page).getByLabel("Valor fixo mensal/contratual");
    await campo.fill("700");
    await campo.blur();
    await expect(editor(page).getByLabel("Resumo do pagamento")).toContainText("R$ 700,00");
    const salvar = page.waitForResponse((r) => r.url().includes(`/api/mapa-pagamento/${itemId}`) && r.request().method() === "PATCH");
    await editor(page).getByRole("button", { name: "Salvar alterações" }).click();
    expect((await salvar).ok()).toBe(true);

    await expect(editor(page)).toHaveCount(0);
    const detalheAtualizado = page.getByRole("dialog", { name: `Detalhe de ${NOME}` });
    await expect(detalheAtualizado).toBeVisible();
    await expect(detalheAtualizado).toContainText("R$ 700,00");
    await expect(page.getByTestId("fornecedores-tabela").locator("tr", { hasText: NOME })).toContainText("R$ 700,00");
    expect(Number((await prisma.mapaPagamentoItem.findUniqueOrThrow({ where: { id: itemId } })).valor)).toBe(700);
  });

  test("mobile: editor ocupa a largura toda, sem overflow, com Cancelar/Salvar acessíveis", async ({ page }) => {
    const detalhe = await abrirDetalhe(page, 390, 844);
    await detalhe.getByRole("button", { name: "Editar pagamento" }).click();
    const caixa = await editor(page).locator("aside").boundingBox();
    expect(Math.round(caixa!.width)).toBe(390);
    await expect(editor(page).getByRole("button", { name: "Salvar alterações" })).toBeInViewport();
    await expect(editor(page).getByRole("button", { name: "Cancelar", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
