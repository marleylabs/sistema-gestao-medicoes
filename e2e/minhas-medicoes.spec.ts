import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * "Minhas Medições" (Portal do Fornecedor) — acompanhamento, não workflow (aprovação/NF/revisão já
 * cobertos nos specs do Portal). Fornecedor dedicado com dois BMs aprovados em ciclos diferentes:
 *  - ciclo publicado: Aguardando envio da NF, total da medição R$ 1.500,00, sem REV;
 *  - ciclo 2510:      Medição concluída, condição fixa R$ 1.500,00 + REV R$ 250,00 → a pagar R$ 1.750,00.
 * Criado e removido aqui (o seed também limpa o prefixo).
 */

const NOME = "E2E Minhas Medicoes Fornecedor";
const USUARIO = "P0909964";
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;
const S = randomBytes(3).toString("hex").toUpperCase();
const CICLO_ANTIGO = "2510";
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";

async function limpar() {
  const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: USUARIO }, select: { id: true } });
  await prisma.sgcLog.deleteMany({ where: { sgcId: { in: sgcs.map((s) => s.id) } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: USUARIO } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: USUARIO } });
  await prisma.usuario.deleteMany({ where: { usuario: USUARIO, nome: NOME } });
}

async function abrirMinhasMedicoes(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(USUARIO, SENHA);
  await page.goto("/");
  await expect(page.getByTestId("portal-bm-resumo").or(page.getByText("Aguardando o envio do BM"))).toBeVisible();
  // No celular/tablet a navegação fica no menu lateral recolhido ("Abrir menu").
  const menu = page.getByRole("button", { name: "Abrir menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Minhas Medições" }).first().click();
}

test.beforeAll(async ({ browser }) => {
  await assertConnectedToE2eDatabase();
  const existente = await prisma.usuario.findUnique({ where: { usuario: USUARIO } });
  if (existente && existente.nome !== NOME) throw new Error(`${USUARIO} já pertence a outro usuário E2E — escolha outro código.`);
  await limpar();
  await prisma.usuario.create({ data: { usuario: USUARIO, nome: NOME, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });
  const page = await browser.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(USUARIO, SENHA);
  ciclo = (await (await page.request.get("/api/colaborador/me")).json()).cicloAtivo;
  await page.request.post("/api/auth/logout");
  await page.close();
});

test.afterAll(async () => {
  await limpar();
});

test.describe.serial("Minhas Medições — acompanhamento do fornecedor", () => {
  test("sem medições aprovadas: estado vazio (sem loading infinito)", async ({ page }) => {
    await abrirMinhasMedicoes(page);
    await expect(page.getByTestId("minhas-medicoes-vazio")).toContainText("Você ainda não possui medições disponíveis.");
  });

  test("lista: ordem do backend, status amigável, total a pagar; detalhe com valores, andamento real e BM", async ({ page }) => {
    const agora = Date.now();
    await prisma.mapaPagamentoItem.createMany({ data: [
      { ciclo, ordem: 9964, projetistaCodigo: USUARIO, responsavel: NOME, valor: 1500, rev: 0, sourceRowHash: `e2e-mm-${S}-a` },
      { ciclo: CICLO_ANTIGO, ordem: 9964, projetistaCodigo: USUARIO, responsavel: NOME, valor: 1500, rev: 250, sourceRowHash: `e2e-mm-${S}-b`, rawPayload: { condicoesFixas: { valorFixo: "1500", tipoContratacao: "FIXO (PJ)", adicionaisFixos: null, observacoesContrato: null } } },
    ] });
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: USUARIO, colaboradorNome: NOME, ciclo, status: "AGUARDANDO_NF", statusConferencia: "CONCLUIDA", aprovadoAt: new Date(agora - 86_400_000) } });
    await prisma.sgcAprovacaoMedicao.create({ data: {
      colaboradorCodigo: USUARIO, colaboradorNome: NOME, ciclo: CICLO_ANTIGO, status: "PAGO", statusConferencia: "CONCLUIDA",
      aprovadoAt: new Date(agora - 40 * 86_400_000), nfArquivoNome: "nf-2510.pdf", nfCarregadoAt: new Date(agora - 39 * 86_400_000),
      comprovanteArquivoNome: "comprovante-2510.pdf", comprovanteCarregadoAt: new Date(agora - 30 * 86_400_000),
    } });

    await abrirMinhasMedicoes(page);
    const linhas = page.getByTestId("minhas-medicoes-tabela").locator("tbody tr");
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0)).toHaveAttribute("data-ciclo", ciclo); // aprovação mais recente primeiro
    await expect(linhas.nth(1)).toHaveAttribute("data-ciclo", CICLO_ANTIGO);
    await expect(linhas.nth(0)).toContainText("Aguardando envio da NF");
    await expect(linhas.nth(1)).toContainText("Medição concluída");
    await expect(linhas.nth(1)).toContainText(brl(1750));
    await expect(page.getByText("AGUARDANDO_NF", { exact: true })).toHaveCount(0);

    // Filtro por status e busca por ciclo.
    await page.getByRole("group", { name: "Filtrar por status" }).getByRole("button", { name: /Medição concluída/ }).click();
    await expect(linhas).toHaveCount(1);
    await page.getByRole("group", { name: "Filtrar por status" }).getByRole("button", { name: /Todas/ }).click();
    await page.getByLabel("Buscar por ciclo ou competência").fill("2510");
    await expect(linhas).toHaveCount(1);
    await page.getByLabel("Buscar por ciclo ou competência").fill("nada-disso");
    await expect(page.getByText("Nenhuma medição encontrada com estes filtros.")).toBeVisible();
    await page.getByLabel("Buscar por ciclo ou competência").fill("");

    // Detalhe do ciclo concluído (com REV) — teclado.
    await page.getByRole("row", { name: `Abrir medição do ciclo ${CICLO_ANTIGO}` }).focus();
    await page.keyboard.press("Enter");
    const detalhe = page.getByTestId("minhas-medicoes-detalhe");
    await expect(detalhe.getByRole("heading", { level: 2, name: new RegExp(`^Ciclo ${CICLO_ANTIGO}`) })).toBeVisible();
    await expect(detalhe.getByTestId("minhas-medicoes-total-pagar")).toHaveText(brl(1750));
    await expect(detalhe.getByTestId("minhas-medicoes-total-medicao")).toHaveText(brl(1500));
    await expect(detalhe.getByTestId("minhas-medicoes-rev")).toHaveText(`+ ${brl(250)}`);
    await expect(detalhe.getByTestId("minhas-medicoes-proximo-passo")).toHaveText("Pagamento concluído.");
    await expect(detalhe.getByTestId("minhas-medicoes-andamento").locator("li")).toHaveText([/Boletim aprovado/, /Nota fiscal recebida/, /Comprovante de pagamento disponível/, /Pagamento concluído/]);
    await expect(detalhe.getByRole("link", { name: "Visualizar NF" })).toBeVisible();
    await expect(detalhe.getByRole("link", { name: "Ver comprovante" })).toBeVisible();
    await expect(detalhe.getByTestId("portal-composicao")).toContainText(`Total da medição${brl(1500)}`);
    await expect(detalhe.getByTestId("portal-composicao")).toContainText(`Total a pagar${brl(1750)}`);
    await detalhe.getByRole("button", { name: "Ver boletim" }).click();
    const bm = page.getByRole("dialog", { name: "Boletim de Medição" });
    await expect(bm.getByRole("button", { name: "Gerar PDF / Imprimir" })).toBeVisible();
    await expect(bm).toContainText(/TOTAL DA MEDIÇÃO\s*R\$\s?1\.500,00/);
    await expect(bm).toContainText(/TOTAL A PAGAR: R\$\s?1\.750,00/);
    await bm.getByRole("button", { name: "Fechar boletim" }).click();
    await page.keyboard.press("Escape");
    await expect(detalhe).toHaveCount(0);

    // Detalhe do ciclo aguardando NF: sem REV, próximo passo e envio da NF (ação que já existia).
    await page.getByRole("row", { name: `Abrir medição do ciclo ${ciclo}` }).click();
    await expect(detalhe.getByTestId("minhas-medicoes-total-pagar")).toHaveText(brl(1500));
    await expect(detalhe.getByTestId("minhas-medicoes-rev")).toHaveCount(0);
    await expect(detalhe.getByTestId("minhas-medicoes-proximo-passo")).toHaveText("Seu boletim foi aprovado. Envie a nota fiscal para continuar.");
    await expect(detalhe.getByRole("button", { name: "Escolher arquivo da Nota Fiscal" })).toBeVisible();
    await expect(detalhe.getByTestId("minhas-medicoes-andamento").locator("li")).toHaveText([/Boletim aprovado/, /Aguardando nota fiscal/]);
  });

  test("erro ao carregar: mensagem amigável e Tentar novamente", async ({ page }) => {
    let falhar = true;
    await page.route("**/api/colaborador/medicoes", async (route) => {
      if (falhar) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return route.continue();
    });
    await abrirMinhasMedicoes(page);
    await expect(page.getByText("Não foi possível carregar suas medições.")).toBeVisible();
    falhar = false;
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByTestId("minhas-medicoes-tabela").locator("tbody tr")).toHaveCount(2);
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: sem rolagem horizontal; cards no celular; painel dentro da tela`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 860 });
      await abrirMinhasMedicoes(page);
      if (largura < 768) {
        await expect(page.getByTestId("minhas-medicoes-lista-mobile")).toBeVisible();
        await expect(page.getByTestId("minhas-medicoes-tabela")).toBeHidden();
        await page.getByTestId("minhas-medicoes-lista-mobile").getByRole("button", { name: `Abrir medição do ciclo ${CICLO_ANTIGO}` }).click();
      } else {
        await expect(page.getByTestId("minhas-medicoes-tabela")).toBeVisible();
        await page.getByRole("row", { name: `Abrir medição do ciclo ${CICLO_ANTIGO}` }).click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "sem rolagem horizontal").toBe(true);
      const painel = page.getByTestId("minhas-medicoes-detalhe").locator("aside");
      const caixa = await painel.boundingBox();
      expect(caixa!.x).toBeGreaterThanOrEqual(0);
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(largura + 1);
      const botao = page.getByTestId("minhas-medicoes-detalhe").getByRole("button", { name: "Ver boletim" });
      await expect(botao).toBeInViewport();
      expect((await botao.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    });
  }
});
