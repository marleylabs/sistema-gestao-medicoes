import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Evidências — divergências na MESMA apresentação documental de Fornecedores → Editar pagamento,
 * em modo SOMENTE LEITURA. Fixture isolada (ciclo próprio, fornecedor dedicado), com as
 * divergências gravadas como o upload grava (snapshots + flags) e uma resolução real de cada tipo:
 *  - NR-TESTE  pendente — só A1eq/HH diverge (equipe 2 × fornecedor 1);
 *  - NR-002    pendente — Formato, A1eq/HH, % Emissão e Tipo divergem (UM cartão);
 *  - NR-NOVO   pendente — documento esperado pelo fornecedor não localizado;
 *  - NR-ACEITO resolvida — Aceitar dados do fornecedor (A1eq/HH 2 → 1);
 *  - NR-MANTIDO resolvida — Manter dados da equipe (motivo);
 *  - NR-NAOINC resolvida — Não incluir documento (motivo);
 *  - NR-EQUIPE-EXTRA existe só na medição da equipe → NÃO é divergência (regra unilateral).
 */

const S = randomUUID().slice(0, 5).toUpperCase();
const C = "2509";
const NOME = `EVID DIV ${S}`;
const resolvidoEm = new Date("2026-09-20T15:30:00Z");

async function abrirEvidencia(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
  // O formulário de login redireciona sozinho para "/": esperar essa navegação terminar evita que
  // ela aborte o goto seguinte (net::ERR_ABORTED).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto(`/?section=evidencias&ciclo=${C}`);
  await expect(page.getByRole("combobox", { name: "Ciclo", exact: true }).locator(`option[value="${C}"]`)).toHaveCount(1);
  await page.getByRole("textbox", { name: "Buscar evidências" }).fill(NOME);
  await page.getByRole("row", { name: `Abrir evidência de ${NOME} no ciclo ${C}` }).click();
  const drawer = page.getByTestId("evidencia-detalhe");
  await expect(drawer.getByTestId("divergencias-leitura")).toBeVisible();
  return drawer;
}

const cartao = (drawer: ReturnType<Page["getByTestId"]>, nrVale: string) => drawer.locator(`[data-testid="divergencia-documento"][data-nr-vale="${nrVale}"]`);

async function abrirCartao(drawer: ReturnType<Page["getByTestId"]>, nrVale: string) {
  const c = cartao(drawer, nrVale);
  const alternar = c.locator("button[aria-expanded]").first();
  if ((await alternar.getAttribute("aria-expanded")) !== "true") await alternar.click();
  await expect(alternar).toHaveAttribute("aria-expanded", "true");
  return c;
}

test.describe.serial("Evidências — divergências por documento (somente leitura)", () => {
  test.beforeAll(async () => {
    await assertConnectedToE2eDatabase();
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: C } });
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: C, mesReferencia: `E2E Evidências divergências ${C}`, atoCiclo: C } });
    const projeto = await prisma.projeto.create({ data: { codigoProjeto: `PRJ-EVD-${S}`, contrato: `CTR EVD ${S}` } });
    const prof = await prisma.profissional.create({ data: { nome: NOME, codigo: NOME, nomeCompleto: NOME, razaoSocial: `${NOME} LTDA` } });
    const med = (numeroDocumento: string, formato: string, a1: number, pct: number, tipo2: string) =>
      prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: prof.id, ciclo: C, numeroDocumento, formato, equivalenteA1Horas: a1, percentualEmissao: pct, tipo2, condicao: "100", sourceRowHash: `e2e-evd-${S}-${numeroDocumento}` } });
    const mTeste = await med("NR-TESTE", "A1", 2, 1, "DOC");
    const m002 = await med("NR-002", "A3", 2, 1, "DG");
    const mAceito = await med("NR-ACEITO", "A1", 1, 1, "DOC"); // já atualizado para o valor do fornecedor (Incluir)
    const mMantido = await med("NR-MANTIDO", "A2", 4, 1, "DOC");
    await med("NR-EQUIPE-EXTRA", "A1", 2, 1, "DOC");
    await prisma.mapaPagamentoItem.create({ data: { ciclo: C, ordem: 1, projetistaCodigo: NOME, responsavel: NOME, razaoSocial: `${NOME} LTDA`, valor: 900, sourceRowHash: `e2e-evd-${S}` } });
    const sgc = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: NOME, colaboradorNome: NOME, ciclo: C, status: "PENDENTE", statusConferencia: "DIVERGENCIA", conferenciaArquivoNome: "Mascara_Conferencia_Medicao.xlsx", conferenciaCarregadoAt: new Date() } });
    const base = { sgcId: sgc.id, colaboradorCodigo: NOME, ciclo: C };
    await prisma.divergenciaMedicao.createMany({ data: [
      { ...base, nrVale: "NR-TESTE", idMedicaoExistente: mTeste.id, a1eqDivergente: true, equipeFormato: "A1", equipeA1eqHh: 2, equipePercentualEmissao: 1, equipeTipo: "DOC", fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC" },
      { ...base, nrVale: "NR-002", idMedicaoExistente: m002.id, formatoDivergente: true, a1eqDivergente: true, emissaoDivergente: true, tipoDivergente: true, equipeFormato: "A3", equipeA1eqHh: 2, equipePercentualEmissao: 1, equipeTipo: "DG", fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 0.5, fornecedorTipo: "DOC" },
      { ...base, nrVale: "NR-NOVO", documentoNaoMapeado: true, fornecedorFormato: "A1", fornecedorA1eqHh: 3, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC" },
      { ...base, nrVale: "NR-ACEITO", idMedicaoExistente: mAceito.id, a1eqDivergente: true, equipeFormato: "A1", equipeA1eqHh: 2, equipePercentualEmissao: 1, equipeTipo: "DOC", fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC", status: "INCLUIDA", observacao: "Conferido com o fornecedor.", resolvidoPorNome: "E2E Medição", resolvidoEm },
      { ...base, nrVale: "NR-MANTIDO", idMedicaoExistente: mMantido.id, formatoDivergente: true, equipeFormato: "A2", equipeA1eqHh: 4, equipePercentualEmissao: 1, equipeTipo: "DOC", fornecedorFormato: "A1", fornecedorA1eqHh: 4, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC", status: "DESCARTADA", observacao: "Formato correto é A2 (folha revisada).", resolvidoPorNome: "E2E Medição", resolvidoEm },
      { ...base, nrVale: "NR-NAOINC", documentoNaoMapeado: true, fornecedorFormato: "A4", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC", status: "DESCARTADA", observacao: "Documento não pertence ao ciclo.", resolvidoPorNome: "E2E Medição", resolvidoEm },
    ] });
  });

  test.afterAll(async () => {
    const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: NOME }, select: { id: true } });
    await prisma.divergenciaMedicao.deleteMany({ where: { sgcId: { in: sgcs.map((s) => s.id) } } });
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: NOME } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: NOME } });
    await prisma.medicao.deleteMany({ where: { sourceRowHash: { startsWith: `e2e-evd-${S}-` } } });
    await prisma.projeto.deleteMany({ where: { codigoProjeto: `PRJ-EVD-${S}` } });
    await prisma.profissional.deleteMany({ where: { codigo: NOME } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: C } });
  });

  test("um cartão por documento, mesma comparação de Fornecedores, nenhum controle de decisão e nenhuma escrita", async ({ page }) => {
    const escritas: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET" && !r.url().includes("/api/auth/") && !r.url().includes("/api/usuario/presenca")) escritas.push(`${r.method()} ${r.url()}`); });
    const drawer = await abrirEvidencia(page);
    await expect(drawer.getByRole("heading", { name: /Divergências · 3 pendente/ })).toBeVisible();
    await expect(drawer.getByTestId("divergencia-documento")).toHaveCount(6);

    // NR-TESTE (pendente, já aberto): 5 campos, só A1eq/HH divergente.
    const teste = await abrirCartao(drawer, "NR-TESTE");
    await expect(teste.getByTestId("divergencia-comparacao").locator("tbody tr")).toHaveCount(5);
    for (const [campo, status] of [["nrVale", "IGUAL"], ["formato", "IGUAL"], ["a1eqHh", "DIVERGENTE"], ["percentualEmissao", "IGUAL"], ["tipo", "IGUAL"]] as const) {
      await expect(teste.locator(`tr[data-campo="${campo}"]`)).toHaveAttribute("data-status-campo", status);
    }
    await expect(teste.locator('tr[data-campo="a1eqHh"] td').nth(0)).toHaveText("2");
    await expect(teste.locator('tr[data-campo="a1eqHh"] td').nth(1)).toHaveText("1");
    await expect(teste.getByTestId("divergencia-resumo")).toHaveText("A1eq/HH diverge: a equipe possui 2 e o fornecedor informou 1.");
    await expect(teste.getByTestId("divergencia-pendente-leitura")).toHaveText("Esta divergência ainda precisa ser analisada pela equipe de Medição.");

    // Multicampo: UM cartão com 4 campos divergentes.
    const n002 = await abrirCartao(drawer, "NR-002");
    await expect(n002.locator('tr[data-status-campo="DIVERGENTE"]')).toHaveCount(4);

    // Documento esperado não localizado: registro completo do fornecedor.
    const novo = await abrirCartao(drawer, "NR-NOVO");
    await expect(novo.getByTestId("divergencia-resumo")).toHaveText("Documento esperado pelo fornecedor não localizado na medição.");
    await expect(novo.getByTestId("divergencia-comparacao")).toContainText("Não existe na medição da equipe");

    // Somente leitura: nenhum campo, botão de decisão ou confirmação.
    const lista = drawer.getByTestId("divergencias-leitura");
    await expect(lista.locator("textarea")).toHaveCount(0);
    await expect(lista.locator("button[data-acao]")).toHaveCount(0);
    await expect(lista.getByText("Observação da análise")).toHaveCount(0);
    await expect(lista.getByRole("button", { name: /Manter dados da equipe|Aceitar dados do fornecedor|Incluir documento|Não incluir documento|Não considerar|Encerrar/ })).toHaveCount(0);
    await expect(drawer.getByRole("link", { name: new RegExp(`Abrir Fornecedores no ciclo ${C}`) })).toHaveAttribute("href", `/fornecedores?ciclo=${C}`);

    // Regra unilateral: o documento só da equipe não aparece como divergência.
    await expect(cartao(drawer, "NR-EQUIPE-EXTRA")).toHaveCount(0);
    expect(escritas, "Evidências não faz nenhuma chamada de escrita").toEqual([]);
  });

  test("resolvidos continuam visíveis com decisão, consequência, observação, responsável e data", async ({ page }) => {
    const drawer = await abrirEvidencia(page);
    const aceito = await abrirCartao(drawer, "NR-ACEITO");
    await expect(aceito.getByTestId("divergencia-decisao")).toContainText("Aceitar dados do fornecedor");
    await expect(aceito.getByTestId("divergencia-alteracao")).toHaveText("A1eq/HH: 2 → 1");
    await expect(aceito.getByTestId("divergencia-decisao")).toContainText("Conferido com o fornecedor.");
    await expect(aceito.getByTestId("divergencia-decisao")).toContainText("Resolvido por E2E Medição em");
    await expect(aceito.getByTestId("divergencia-comparacao").locator("tbody tr")).toHaveCount(5); // comparação original preservada

    const mantido = await abrirCartao(drawer, "NR-MANTIDO");
    await expect(mantido.getByTestId("divergencia-decisao")).toContainText("Manter dados da equipe");
    await expect(mantido.getByTestId("divergencia-decisao")).toContainText("Formato correto é A2 (folha revisada).");
    await expect(mantido.getByTestId("divergencia-alteracao")).toHaveCount(0);

    const naoInc = await abrirCartao(drawer, "NR-NAOINC");
    await expect(naoInc.getByTestId("divergencia-decisao")).toContainText("Não incluir documento");
    await expect(naoInc.getByTestId("divergencia-decisao")).toContainText("Documento não pertence ao ciclo.");
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: sem rolagem horizontal; blocos no celular`, async ({ page }) => {
      const drawer = await abrirEvidencia(page);
      await page.setViewportSize({ width: largura, height: 900 });
      const teste = await abrirCartao(drawer, "NR-TESTE");
      if (largura < 768) {
        await expect(teste.getByTestId("divergencia-comparacao-mobile")).toBeVisible();
        await expect(teste.getByTestId("divergencia-comparacao")).toBeHidden();
      } else {
        await expect(teste.getByTestId("divergencia-comparacao")).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "sem rolagem horizontal").toBe(true);
      const caixa = await teste.boundingBox();
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(largura + 1);
    });
  }
});
