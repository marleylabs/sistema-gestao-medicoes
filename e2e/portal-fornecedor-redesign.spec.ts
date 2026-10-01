import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Redesign do Portal do Fornecedor (aprovação do BM) — só apresentação. Fornecedor DEDICADO a esta
 * suíte (criado aqui e removido no fim; o seed também limpa o prefixo), para nunca depender do
 * estado deixado pelos specs de workflow. As transições reais de status (Salvar → Enviar, Solicitar
 * revisão, NF) continuam provadas nos specs workflow-*; aqui o foco é o que o fornecedor vê:
 * hierarquia, rótulos, diálogos, estados concluídos e responsividade. A aprovação é interceptada
 * (nenhum ENVIAR real, nenhum e-mail) só para provar que o diálogo dispara UMA única requisição.
 */

const NOME = "E2E Portal Redesign Fornecedor";
const USUARIO = "P0909961";
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;
const VALOR = 1234.56;

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let sgcId = "";

async function limpar() {
  const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: USUARIO }, select: { id: true } });
  await prisma.sgcLog.deleteMany({ where: { sgcId: { in: sgcs.map((s) => s.id) } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: USUARIO } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: USUARIO } });
  await prisma.usuario.deleteMany({ where: { usuario: USUARIO, nome: NOME } });
}

async function entrar(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(USUARIO, SENHA);
  await page.goto("/");
  await expect(page.getByTestId("portal-bm-resumo")).toBeVisible();
}

async function definirStatus(data: Record<string, unknown>) {
  await prisma.sgcAprovacaoMedicao.update({ where: { id: sgcId }, data: { updatedAt: new Date(), ...data } });
}

test.beforeAll(async ({ browser }) => {
  await assertConnectedToE2eDatabase();
  const existente = await prisma.usuario.findUnique({ where: { usuario: USUARIO } });
  if (existente && existente.nome !== NOME) throw new Error(`${USUARIO} já pertence a outro usuário E2E — escolha outro código.`);
  await limpar();
  await prisma.usuario.create({ data: { usuario: USUARIO, nome: NOME, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });

  // Ciclo publicado no portal é decidido pelo servidor (lib/ciclo-ativo.ts) — lido pela própria API.
  const page = await browser.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(USUARIO, SENHA);
  const me = await (await page.request.get("/api/colaborador/me")).json();
  ciclo = me.cicloAtivo;
  await page.request.post("/api/auth/logout");
  await page.close();

  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 9961, projetistaCodigo: USUARIO, responsavel: NOME, valor: VALOR, sourceRowHash: `e2e-portal-redesign-${USUARIO}` },
  });
  const sgc = await prisma.sgcAprovacaoMedicao.create({
    data: { colaboradorCodigo: USUARIO, colaboradorNome: NOME, ciclo, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
  });
  sgcId = sgc.id;
});

test.afterAll(async () => {
  await limpar();
});

test.describe.serial("Portal do Fornecedor — redesign da aprovação do BM", () => {
  test("resumo responde quem, ciclo, valor e status; ações com pesos distintos", async ({ page }) => {
    await entrar(page);
    const resumo = page.getByTestId("portal-bm-resumo");
    await expect(resumo.getByRole("heading", { name: NOME })).toBeVisible();
    await expect(resumo).toContainText(`Ciclo ${ciclo}`);
    await expect(page.getByTestId("portal-bm-valor")).toHaveText("R$ 1.234,56");
    await expect(page.getByTestId("portal-status")).toHaveText("Pendente de validação");
    await expect(page.getByText("PENDENTE", { exact: true })).toHaveCount(0);
    await expect(page.getByText("SISTEMA APROVAÇÃO")).toHaveCount(0);

    const aprovar = page.getByRole("button", { name: "Aprovar boletim", exact: true });
    const revisao = page.getByRole("button", { name: "Solicitar revisão", exact: true });
    await expect(aprovar).toBeDisabled(); // regra do servidor: Salvar antes de Enviar
    await expect(page.getByRole("button", { name: "Salvar validação", exact: true })).toBeEnabled();
    await expect(revisao).toBeEnabled();
    const fundo = async (el: typeof aprovar) => el.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await fundo(aprovar)).not.toBe(await fundo(revisao)); // primária cheia × secundária outline

    await expect(page.getByTestId("portal-composicao")).toContainText("Total medido líquido");
    await page.getByRole("button", { name: /Documentos da medição/ }).click();
    await expect(page.getByTestId("portal-documentos")).toContainText("Nenhum documento medido neste ciclo.");
  });

  test("aprovar: diálogo próprio com fornecedor/ciclo/valor; cancelar não envia; confirmação dispara UMA requisição", async ({ page }) => {
    let dialogoNativo = false;
    page.on("dialog", async (d) => { dialogoNativo = true; await d.dismiss(); });
    let envios = 0;
    await page.route("**/api/colaborador/sgc", async (route) => {
      if (route.request().postDataJSON()?.action !== "ENVIAR") return route.continue();
      envios += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "AGUARDANDO_NF" }) });
    });

    await entrar(page);
    await page.getByRole("button", { name: "Salvar validação", exact: true }).click();
    await expect(page.getByText("Validação salva com sucesso.")).toBeVisible();
    const aprovar = page.getByRole("button", { name: "Aprovar boletim", exact: true });
    await expect(aprovar).toBeEnabled();

    await aprovar.click();
    const dialogo = page.getByRole("alertdialog", { name: "Aprovar boletim" });
    await expect(dialogo).toContainText(NOME);
    await expect(dialogo).toContainText(ciclo);
    await expect(dialogo).toContainText("R$ 1.234,56");
    await expect(dialogo).toContainText("Aprovar BM");
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    expect(envios).toBe(0);

    await aprovar.click();
    const confirmar = dialogo.getByRole("button", { name: "Aprovar boletim" });
    await confirmar.dblclick();
    await expect(dialogo.getByRole("button", { name: "Aprovando..." })).toBeDisabled();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByText("BM enviado com sucesso. Aguardando envio da Nota Fiscal.")).toBeVisible();
    expect(envios).toBe(1);
    expect(dialogoNativo, "sem window.confirm").toBe(false);

    const sgc = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgcId } });
    expect(sgc.status).toBe("PENDENTE"); // ENVIAR foi interceptado: nada mudou de verdade
    expect(sgc.salvoAt).toBeTruthy(); // SALVAR foi real
  });

  test("solicitar revisão: campo rotulado, validação do servidor no diálogo, Esc fecha sem alterar nada", async ({ page }) => {
    await entrar(page);
    await page.getByRole("button", { name: "Solicitar revisão", exact: true }).click();
    const dialogo = page.getByRole("dialog", { name: "Solicitar revisão" });
    await dialogo.getByLabel("Pontos de discordância").fill("curto");
    await dialogo.getByRole("button", { name: "Solicitar revisão" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Informe os pontos de discordância com mais detalhes.");
    await page.keyboard.press("Escape");
    await expect(dialogo).toHaveCount(0);
    const sgc = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgcId } });
    expect(sgc.status).toBe("PENDENTE");
  });

  test("estados concluídos: aprovado (NF), revisão solicitada, aguardando pagamento — sem ações repetidas", async ({ page }) => {
    const aprovadoAt = new Date("2026-09-15T13:45:00Z");
    await definirStatus({ status: "AGUARDANDO_NF", aprovadoAt });
    await entrar(page);
    const acao = page.getByTestId("portal-acao");
    await expect(page.getByTestId("portal-status")).toHaveText("Aguardando envio da NF");
    await expect(acao.getByRole("heading", { name: "Boletim aprovado" })).toBeVisible();
    await expect(acao).toContainText("Aprovado em");
    await expect(acao.getByRole("heading", { name: "Envio da Nota Fiscal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aprovar boletim" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Solicitar revisão" })).toHaveCount(0);

    await definirStatus({ status: "REVISAO_SOLICITADA", aprovadoAt: null, revisaoSolicitadaAt: new Date(), pontosDiscordancia: "Valor do documento E2E diverge do combinado." });
    await page.reload();
    await expect(page.getByTestId("portal-status")).toHaveText("Revisão solicitada");
    await expect(acao.getByRole("heading", { name: "Revisão solicitada" })).toBeVisible();
    await expect(page.getByText("Solicitação enviada.")).toBeVisible();
    await expect(acao).toContainText("Valor do documento E2E diverge do combinado.");
    await expect(page.getByRole("button", { name: "Aprovar boletim" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Solicitar revisão", exact: true })).toHaveCount(0);

    await definirStatus({ status: "APROVADO", aprovadoAt, revisaoSolicitadaAt: null, pontosDiscordancia: null });
    await page.reload();
    await expect(page.getByTestId("portal-status")).toHaveText("Aguardando pagamento");
    await expect(acao.getByRole("heading", { name: "Boletim aprovado" })).toBeVisible();
    await expect(acao.getByRole("button", { name: "Ver medições" })).toBeVisible();
    await expect(page.getByTestId("portal-composicao")).toHaveCount(0);

    await definirStatus({ status: "PENDENTE", aprovadoAt: null, salvoAt: null });
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: sem rolagem horizontal, valor e ações alcançáveis, diálogo dentro da tela`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 860 });
      await entrar(page);
      const semOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(await semOverflow(), "página sem rolagem horizontal").toBe(true);
      await expect(page.getByTestId("portal-bm-valor")).toBeVisible();

      await page.getByRole("button", { name: /Documentos da medição/ }).click();
      expect(await semOverflow(), "documentos abertos sem rolagem horizontal").toBe(true);

      const salvar = page.getByRole("button", { name: "Salvar validação", exact: true });
      await salvar.scrollIntoViewIfNeeded();
      const caixa = await salvar.boundingBox();
      expect(caixa!.height, "área de toque adequada").toBeGreaterThanOrEqual(36);
      await salvar.click();
      await page.getByRole("button", { name: "Aprovar boletim", exact: true }).click();
      const dialogo = page.getByRole("alertdialog", { name: "Aprovar boletim" });
      const caixaDialogo = await dialogo.boundingBox();
      expect(caixaDialogo!.x).toBeGreaterThanOrEqual(0);
      expect(caixaDialogo!.x + caixaDialogo!.width).toBeLessThanOrEqual(largura + 1);
      await expect(dialogo.getByRole("button", { name: "Aprovar boletim" })).toBeInViewport();
      await dialogo.getByRole("button", { name: "Cancelar" }).click();
      await expect(dialogo).toHaveCount(0);
      await definirStatus({ salvoAt: null });
    });
  }
});
