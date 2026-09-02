import { test, expect, type Page } from "@playwright/test";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { PortalPage } from "./pages/portal-page";
import { FinanceiroPage } from "./pages/financeiro-page";
import { e2eUsers, e2eCiclo } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * BUG 2 — a aplicação só refletia mudanças feitas por outro usuário depois de F5. Esta suíte prova
 * o oposto: dois `browser.newContext()` simultâneos (um "observador" que fica com a página aberta
 * e nunca navega de novo, outro "ator" que executa a mudança), usando `expect.poll` (nunca
 * `waitForTimeout` como estratégia principal — item 60 do pedido) para confirmar que o observador
 * se atualiza sozinho, dentro do intervalo de polling configurado (hooks/use-live-refresh.ts +
 * SSE ampliado de app/api/sgc/alertas/stream).
 *
 * Fornecedor D é dedicado só a esta suíte — nunca tocado por nenhum outro arquivo de spec, então
 * roda em qualquer ordem sem contaminação (mesma regra já aplicada ao Fornecedor C na Fase 4).
 */

const FORNECEDOR_NOME = "E2E Fornecedor D";
const CODIGO_D = e2eUsers.fornecedorD.usuario;

test.beforeAll(assertConnectedToE2eDatabase);

async function loginAs(page: Page, usuario: string, senha: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario, senha);
}

test.describe.serial("Atualização automática (sem F5) entre dois usuários", () => {
  test("preparação: MEDICAO envia o BM para o Fornecedor D", async ({ page }) => {
    await loginAs(page, e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(FORNECEDOR_NOME);
    await page.request.post("/api/auth/logout");
  });

  test("REALTIME — Portal: fornecedor com a página aberta sai de 'EM ANÁLISE' sozinho quando a Equipe resolve a última divergência", async ({ browser }) => {
    const observadorCtx = await browser.newContext();
    const observador = await observadorCtx.newPage();
    await loginAs(observador, e2eUsers.fornecedorD.usuario, e2eUsers.fornecedorD.senha);
    const portalObservador = new PortalPage(observador);
    await portalObservador.goto();
    await portalObservador.uploadMascara("tests/fixtures/e2e/conferencia/mascara-divergente.xlsx");
    await expect(observador.getByText("EM ANÁLISE")).toBeVisible();

    const sgc = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_D, ciclo: e2eCiclo() } } });
    expect(sgc.statusConferencia).toBe("DIVERGENCIA");

    // Ator: Equipe resolve as duas divergências pendentes num contexto/aba SEPARADO — o observador
    // acima nunca navega de novo a partir daqui.
    const atorCtx = await browser.newContext();
    const ator = await atorCtx.newPage();
    try {
      await loginAs(ator, e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
      const pagamentosAtor = new PagamentosPage(ator);
      await pagamentosAtor.goto();
      await pagamentosAtor.abrirEditarPagamento(FORNECEDOR_NOME);

      const pendentes = await prisma.divergenciaMedicao.findMany({ where: { sgcId: sgc.id, status: "PENDENTE" } });
      expect(pendentes.length).toBeGreaterThan(0);
      for (const d of pendentes) {
        await pagamentosAtor.descartarDivergencia(d.nrVale, "Descartado no teste de tempo real.");
      }

      const restantes = await prisma.divergenciaMedicao.count({ where: { sgcId: sgc.id, status: "PENDENTE" } });
      expect(restantes).toBe(0);
      await ator.request.post("/api/auth/logout");
    } finally {
      await atorCtx.close();
    }

    // O observador NUNCA recarregou a página — só o polling/SSE pode ter atualizado isto.
    await expect.poll(async () => observador.getByText("EM ANÁLISE").count(), { timeout: 15000, intervals: [500, 1000, 1500] }).toBe(0);
    await expect(observador.getByText("Documentos não considerados")).toBeVisible();

    await observador.request.post("/api/auth/logout");
    await observadorCtx.close();
  });

  test("REALTIME — Pagamentos: Equipe com a tabela aberta vê o status mudar sozinho quando o fornecedor aprova o BM", async ({ browser }) => {
    const observadorCtx = await browser.newContext();
    const observador = await observadorCtx.newPage();
    await loginAs(observador, e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    const pagamentosObservador = new PagamentosPage(observador);
    await pagamentosObservador.goto();
    await pagamentosObservador.expectStatusBadge(FORNECEDOR_NOME, "Aguardando");

    const atorCtx = await browser.newContext();
    const ator = await atorCtx.newPage();
    try {
      await loginAs(ator, e2eUsers.fornecedorD.usuario, e2eUsers.fornecedorD.senha);
      const portalAtor = new PortalPage(ator);
      await portalAtor.goto();
      await portalAtor.salvarEEnviarBm();
      await portalAtor.expectStatusBadge("AGUARDANDO_NF");
      await ator.request.post("/api/auth/logout");
    } finally {
      await atorCtx.close();
    }

    // Sem reload no observador — a linha vira "Concluído" (badge usado para todo status
    // isConcluido = APROVADO/AGUARDANDO_NF/PAGO) só via polling/SSE.
    await expect.poll(
      async () => {
        const row = pagamentosObservador["rowFor"](FORNECEDOR_NOME);
        return (await row.textContent()) ?? "";
      },
      { timeout: 15000, intervals: [500, 1000, 1500] },
    ).toContain("Concluído");

    await observador.request.post("/api/auth/logout");
    await observadorCtx.close();
  });

  test("REALTIME — Financeiro: painel aberto detecta sozinho a NF enviada pelo fornecedor", async ({ browser }) => {
    const observadorCtx = await browser.newContext();
    const observador = await observadorCtx.newPage();
    await loginAs(observador, e2eUsers.financeiro.usuario, e2eUsers.financeiro.senha);
    const financeiroObservador = new FinanceiroPage(observador);
    await financeiroObservador.goto();
    await financeiroObservador.expectStatusBadge(FORNECEDOR_NOME, "Aguardando NF");

    const atorCtx = await browser.newContext();
    const ator = await atorCtx.newPage();
    try {
      await loginAs(ator, e2eUsers.fornecedorD.usuario, e2eUsers.fornecedorD.senha);
      const portalAtor = new PortalPage(ator);
      await portalAtor.goto();
      await portalAtor.uploadNf("tests/fixtures/nf/valida-b.pdf");
      await portalAtor.expectStatusBadge("APROVADO");
      await ator.request.post("/api/auth/logout");
    } finally {
      await atorCtx.close();
    }

    await expect.poll(
      async () => {
        const row = financeiroObservador["rowFor"](FORNECEDOR_NOME);
        return (await row.textContent()) ?? "";
      },
      { timeout: 15000, intervals: [500, 1000, 1500] },
    ).toContain("Aguardando pgto.");

    await observador.request.post("/api/auth/logout");
    await observadorCtx.close();
  });

  test("REALTIME — Chat: contador de não lidas e bolha atualizam sozinhos com o chat FECHADO", async ({ browser }) => {
    const observadorCtx = await browser.newContext();
    const observador = await observadorCtx.newPage();
    await loginAs(observador, e2eUsers.fornecedorD.usuario, e2eUsers.fornecedorD.senha);
    await observador.goto("/");

    const bolha = observador.getByRole("button", { name: /Conversas/i });
    await expect(bolha).toBeVisible();
    await expect(bolha).not.toContainText(/[1-9]/); // sem badge de não lidas ainda

    const atorCtx = await browser.newContext();
    const ator = await atorCtx.newPage();
    try {
      await loginAs(ator, e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
      await ator.goto("/?section=visao");
      await ator.getByRole("button", { name: /Conversas/i }).click();
      await ator.getByPlaceholder("Pesquisar...").fill("E2E Fornecedor D");
      // "E2E Fornecedor D" também aparece na tabela de Pagamentos atrás do widget — escopa pelo
      // botão de resultado de busca do chat, identificável pelo texto "Iniciar conversa" ao lado.
      await ator.locator("button", { hasText: "Iniciar conversa" }).filter({ hasText: FORNECEDOR_NOME }).click();
      const texto = `Mensagem de teste em tempo real ${Date.now()}`;
      await ator.getByPlaceholder("Digite uma mensagem...").fill(texto);
      await ator.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(ator.getByText(texto)).toBeVisible();
      await ator.request.post("/api/auth/logout");
    } finally {
      await atorCtx.close();
    }

    // Chat do observador continua FECHADO durante todo o teste — só a bolha precisa reagir.
    await expect.poll(
      async () => (await bolha.textContent()) ?? "",
      { timeout: 15000, intervals: [500, 1000, 1500] },
    ).toMatch(/[1-9]/);

    await observador.request.post("/api/auth/logout");
    await observadorCtx.close();
  });
});
