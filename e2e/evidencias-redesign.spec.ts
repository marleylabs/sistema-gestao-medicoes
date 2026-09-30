import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Evidências (redesign) — conferência documental do BM, somente leitura.
 * Fixtures num ciclo isolado abaixo do seed:
 *  - F1: BM PENDENTE com conferência em DIVERGENCIA (1 divergência pendente), mapa R$ 1.500,
 *    1 documento DG (R$ 500) + 1 desconto (R$ 100);
 *  - F2: BM APROVADO (aprovado pelo fornecedor), mapa R$ 800;
 *  - F3: BM AGUARDANDO_ENVIO — nunca é evidência (não aparece).
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 5).toUpperCase();
const C = "2510";
const F1 = `EVID F1 ${S}`;
const F2 = `EVID F2 ${S}`;
const F3 = `EVID F3 ${S}`;
const DOC = `EVID-DOC-${S}`;
const VALE = `VALE-${S}`;
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

async function abrir(page: Page, usuario: { usuario: string; senha: string }) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario.usuario, usuario.senha);
  await page.goto(`/?section=evidencias&ciclo=${C}`);
  await expect(page.getByRole("heading", { name: "Evidências", exact: true, level: 1 }).last()).toBeVisible();
  // Espera a lista de ciclos carregar (a inicialização do ciclo de trabalho acontece uma única vez nesse momento).
  await expect(page.getByRole("combobox", { name: "Ciclo", exact: true }).locator(`option[value="${C}"]`)).toHaveCount(1);
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

const linhas = (page: Page) => page.getByTestId("evidencias-lista").locator("tbody tr");

test.describe.serial("Evidências — redesign (conferência do BM)", () => {
  test.beforeAll(async () => {
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: C } });
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: C, mesReferencia: `E2E Evidências ${C}`, atoCiclo: C } });
    const projeto = await prisma.projeto.create({ data: { codigoProjeto: `PRJ-EV-${S}`, contrato: `CTR EV ${S}` } });
    const agora = new Date();
    for (const [nome, valor, status, conferencia] of [
      [F1, 1500, "PENDENTE", "DIVERGENCIA"],
      [F2, 800, "APROVADO", "CONCLUIDA"],
      [F3, 300, "AGUARDANDO_ENVIO", null],
    ] as const) {
      const prof = await prisma.profissional.create({ data: { nome, codigo: nome, nomeCompleto: nome, razaoSocial: `${nome} LTDA` } });
      await prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: prof.id, ciclo: C, numeroDocumento: nome === F1 ? DOC : `${DOC}-${nome.slice(-8)}`, tipo2: "DG", condicao: "100", equivalenteA1Horas: 5, percentualEmissao: 1, sourceRowHash: `e2e-evid-${S}-${nome}-dg` } });
      await prisma.mapaPagamentoItem.create({ data: { ciclo: C, ordem: 1, projetistaCodigo: nome, responsavel: nome, razaoSocial: `${nome} LTDA`, valor, sourceRowHash: `e2e-evid-${S}-${nome}` } });
      await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: nome, colaboradorNome: nome, ciclo: C, status, ...(conferencia ? { statusConferencia: conferencia } : {}), aprovadoAt: status === "APROVADO" ? agora : null } });
    }
    const f1 = await prisma.profissional.findFirstOrThrow({ where: { codigo: F1 } });
    await prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: f1.id, ciclo: C, numeroDocumento: `${DOC}-DESC`, tipo2: "DESCONTO", condicao: "100", equivalenteA1Horas: 1, percentualEmissao: -1, sourceRowHash: `e2e-evid-${S}-${F1}-desc` } });
    const sgc1 = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: F1, ciclo: C } });
    await prisma.divergenciaMedicao.create({ data: { sgcId: sgc1.id, colaboradorCodigo: F1, ciclo: C, nrVale: VALE, formatoDivergente: true, equipeFormato: "A1", fornecedorFormato: "A0", fornecedorA1eqHh: 5, fornecedorPercentualEmissao: 1, fornecedorTipo: "DG" } });
  });

  test.afterAll(async () => {
    await prisma.divergenciaMedicao.deleteMany({ where: { colaboradorCodigo: { in: [F1, F2, F3] } } });
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { in: [F1, F2, F3] } } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { sourceRowHash: { startsWith: `e2e-evid-${S}` } } });
    await prisma.medicao.deleteMany({ where: { sourceRowHash: { startsWith: `e2e-evid-${S}` } } });
    await prisma.profissional.deleteMany({ where: { codigo: { in: [F1, F2, F3] } } });
    await prisma.projeto.deleteMany({ where: { codigoProjeto: `PRJ-EV-${S}` } });
    await prisma.contrato.deleteMany({ where: { nome: `CTR EV ${S}` } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: C } });
  });

  test("LISTA: ciclo de trabalho, BMs visíveis (sem AGUARDANDO_ENVIO), status do mapper central, busca e filtro de status", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(C);
    await expect(page.getByTestId("evidencias-kpis")).toContainText("BMs disponíveis");
    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(S);
    await expect(linhas(page)).toHaveCount(2);
    const l1 = page.getByRole("row", { name: `Abrir evidência de ${F1} no ciclo ${C}` });
    const l2 = page.getByRole("row", { name: `Abrir evidência de ${F2} no ciclo ${C}` });
    await expect(l1).toContainText(brl(1500));
    await expect(l1).toContainText("Divergência");
    await expect(l2).toContainText(brl(800));
    await expect(l2).toContainText("Aguardando pagamento");
    await expect(page.getByRole("row", { name: new RegExp(F3) })).toHaveCount(0);
    await expect(page.getByTestId("evidencias-total")).toHaveText(brl(2300));

    await page.getByRole("button", { name: /^Filtros/ }).click();
    await page.getByRole("combobox", { name: "Status" }).selectOption("Divergência");
    await page.getByRole("button", { name: "Concluído" }).click();
    await expect(linhas(page)).toHaveCount(1);
    await expect(linhas(page).first()).toContainText(F1);

    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(`nada-${S}`);
    await expect(page.getByTestId("evidencias-vazio")).toHaveText("Nenhuma evidência encontrada para este ciclo e filtro.");
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("DETALHE: valor e composição do BM (resumoBoletim), documentos, divergência pendente; nenhuma ação de workflow nem escrita", async ({ page }) => {
    const escritas: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET" && !r.url().includes("/api/auth/") && !r.url().includes("/api/usuario/presenca")) escritas.push(`${r.method()} ${r.url()}`); });
    await abrir(page, e2eUsers.admin);
    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(F1);
    await page.getByRole("row", { name: `Abrir evidência de ${F1} no ciclo ${C}` }).click();
    const d = page.getByTestId("evidencia-detalhe");
    await expect(d.getByRole("heading", { name: F1, level: 2 })).toBeVisible();
    await expect(d.getByTestId("evidencia-resumo")).toContainText(brl(1500));
    const comp = d.getByTestId("evidencia-composicao");
    await expect(comp).toContainText("Documentos medidos");
    await expect(comp).toContainText(brl(500));
    await expect(comp).toContainText(`- ${brl(100)}`);
    const docs = d.getByTestId("evidencia-documentos");
    await expect(docs).toContainText(DOC);
    await expect(docs).toContainText("Desconto");
    const div = d.getByTestId("evidencia-divergencias");
    await expect(div).toContainText(VALE);
    await expect(div).toContainText("Pendente");
    await expect(d.getByRole("heading", { name: /Divergências · 1 pendente/ })).toBeVisible();
    await expect(div.getByRole("link", { name: new RegExp(`Abrir Fornecedores no ciclo ${C}`) })).toHaveAttribute("href", `/fornecedores?ciclo=${C}`);
    await expect(d.getByRole("button", { name: /Aprovar|Enviar|Retornar|Incluir|Descartar|Solicitar revisão/ })).toHaveCount(0);

    await d.getByRole("button", { name: "Ver BM" }).click();
    await expect(page.getByRole("button", { name: "Gerar PDF / Imprimir" })).toBeVisible();
    await page.getByRole("button", { name: "Fechar boletim" }).click();
    await expect(d).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(F2);
    await page.getByRole("row", { name: `Abrir evidência de ${F2} no ciclo ${C}` }).click();
    await expect(page.getByTestId("evidencia-detalhe").getByTestId("evidencia-divergencias")).toContainText("Nenhuma divergência registrada");
    await expect(page.getByTestId("evidencia-resumo")).not.toContainText("Aprovado pelo fornecedor em–");
    expect(escritas, "Evidências nunca escreve").toEqual([]);
    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR: filtro pela identidade canônica (colaboradorCodigo) em todos os ciclos", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("combobox", { name: "Ciclo", exact: true }).selectOption("");
    await expect(page.getByText("Selecione um ciclo ou um fornecedor para visualizar as evidências.")).toBeVisible();
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await page.getByPlaceholder("Todos os fornecedores / buscar…").fill(F2);
    await page.getByRole("button", { name: new RegExp(F2) }).click();
    await expect(linhas(page)).toHaveCount(1);
    await expect(linhas(page).first()).toContainText(F2);
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÕES: MEDICAO vê a área; FINANCEIRO não vê Evidências nem as divergências (403)", async ({ page }) => {
    await abrir(page, e2eUsers.medicao);
    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(S);
    await expect(linhas(page)).toHaveCount(2);
    await page.request.post("/api/auth/logout");

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.financeiro.usuario, e2eUsers.financeiro.senha);
    await page.goto(`/?section=evidencias&ciclo=${C}`);
    await expect(page.getByRole("heading", { name: "Evidências", exact: true, level: 1 })).toHaveCount(0);
    expect((await page.request.get(`/api/admin/conferencia?codigo=${encodeURIComponent(F1)}&ciclo=${C}`)).status()).toBe(403);
    expect((await page.request.get(`/api/sgc/status?ciclo=${C}`)).status()).toBe(403);
    await page.request.post("/api/auth/logout");
  });

  test("MOBILE 375: lista compacta; toque abre detalhe em tela cheia; sem overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrir(page, e2eUsers.admin);
    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(F1);
    const item = page.getByTestId("evidencias-lista-mobile").getByRole("button", { name: new RegExp(F1) });
    await expect(item).toContainText(brl(1500));
    await semOverflow(page);
    await item.click();
    const d = page.getByTestId("evidencia-detalhe");
    await expect(d.getByRole("heading", { name: F1, level: 2 })).toBeVisible();
    expect((await d.locator("aside").boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(370);
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });
});
