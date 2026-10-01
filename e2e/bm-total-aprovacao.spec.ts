import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * GATE DE RELEASE — fonte única do total do BM (lib/boletim-calculo.ts), ponta a ponta nas telas reais.
 *
 * BM com condição fixa (3.000) + adicional (300) + documento DG (1.000) + desconto identificado só
 * pelo NÚMERO do documento e gravado com valor POSITIVO (100) + REV (250):
 *   TOTAL DA MEDIÇÃO = 3.000 + 300 + 1.000 − 100 = R$ 4.200,00 (= mapaPagamentoItem.valor)
 *   TOTAL A PAGAR    = 4.200 + 250            = R$ 4.450,00
 * Prova: o valor que o fornecedor vê ANTES de aprovar é o TOTAL DA MEDIÇÃO do PDF DEPOIS da
 * aprovação (aprovação real: Salvar → Aprovar), e Histórico/Evidências (lista e detalhe) mostram o
 * mesmo total. Fornecedor dedicado, criado e removido aqui (o seed também limpa o prefixo).
 */

const NOME = "E2E BM Gate Fornecedor";
const USUARIO = "P0909962";
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;
const S = randomBytes(3).toString("hex").toUpperCase();
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const TOTAL_MEDICAO = brl(4200);
const REV = brl(250);
const TOTAL_A_PAGAR = brl(4450);

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let valorAntesDeAprovar = "";
let totalAPagarAntesDeAprovar = "";

async function limpar() {
  const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: USUARIO }, select: { id: true } });
  await prisma.sgcLog.deleteMany({ where: { sgcId: { in: sgcs.map((s) => s.id) } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: USUARIO } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: USUARIO } });
  await prisma.medicao.deleteMany({ where: { sourceRowHash: { startsWith: "e2e-bm-gate-" } } });
  await prisma.projeto.deleteMany({ where: { codigoProjeto: { startsWith: "PRJ-BM-GATE-" } } });
  await prisma.profissional.deleteMany({ where: { codigo: USUARIO } });
  await prisma.usuario.deleteMany({ where: { usuario: USUARIO, nome: NOME } });
}

async function entrar(page: Page, usuario: string, senha: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario, senha);
}

test.beforeAll(async ({ browser }) => {
  await assertConnectedToE2eDatabase();
  const existente = await prisma.usuario.findUnique({ where: { usuario: USUARIO } });
  if (existente && existente.nome !== NOME) throw new Error(`${USUARIO} já pertence a outro usuário E2E — escolha outro código.`);
  await limpar();
  await prisma.usuario.create({ data: { usuario: USUARIO, nome: NOME, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });

  // Ciclo publicado no portal: decidido pelo servidor (lib/ciclo-ativo.ts), lido pela própria API.
  const page = await browser.newPage();
  await entrar(page, USUARIO, SENHA);
  ciclo = (await (await page.request.get("/api/colaborador/me")).json()).cicloAtivo;
  await page.request.post("/api/auth/logout");
  await page.close();

  const profissional = await prisma.profissional.create({ data: { codigo: USUARIO, nome: NOME, nomeCompleto: NOME, razaoSocial: `${NOME} LTDA` } });
  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `PRJ-BM-GATE-${S}`, contrato: `CTO GATE ${S}` } });
  await prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: profissional.id, ciclo, numeroDocumento: `GATE-DOC-${S}`, tipo2: "DG", condicao: "100", equivalenteA1Horas: 10, percentualEmissao: 1, sourceRowHash: `e2e-bm-gate-doc-${S}` } });
  // Desconto só pelo número do documento, gravado com sinal POSITIVO (antes, o BM interno o somava).
  await prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: profissional.id, ciclo, numeroDocumento: "DESCONTO", tipo2: null, condicao: "100", equivalenteA1Horas: 1, percentualEmissao: 1, obs: `Desconto gate ${S}`, sourceRowHash: `e2e-bm-gate-desc-${S}` } });
  await prisma.mapaPagamentoItem.create({
    data: {
      ciclo, ordem: 9962, projetistaCodigo: USUARIO, responsavel: NOME, razaoSocial: `${NOME} LTDA`,
      valor: 4200, rev: 250, sourceRowHash: `e2e-bm-gate-${USUARIO}-${S}`,
      rawPayload: { condicoesFixas: { valorFixo: "3000", tipoContratacao: "FIXO (PJ)", adicionaisFixos: "300", observacoesContrato: null } },
    },
  });
  await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: USUARIO, colaboradorNome: NOME, ciclo, status: "PENDENTE", statusConferencia: "CONCLUIDA" } });
});

test.afterAll(async () => {
  await limpar();
});

test.describe.serial("Gate — total do BM: Portal → aprovação → PDF; Histórico e Evidências", () => {
  test("Portal mostra TOTAL DA MEDIÇÃO, REV e TOTAL A PAGAR; aprovação real com o mesmo valor", async ({ page }) => {
    await entrar(page, USUARIO, SENHA);
    await page.goto("/");
    await expect(page.getByTestId("portal-bm-valor")).toHaveText(TOTAL_MEDICAO);
    await expect(page.getByTestId("portal-bm-rev")).toHaveText(REV);
    await expect(page.getByTestId("portal-bm-total-pagar")).toHaveText(TOTAL_A_PAGAR);
    valorAntesDeAprovar = (await page.getByTestId("portal-bm-valor").innerText()).trim();
    totalAPagarAntesDeAprovar = (await page.getByTestId("portal-bm-total-pagar").innerText()).trim();

    const composicao = page.getByTestId("portal-composicao");
    await expect(composicao).toContainText(`Condições fixas`);
    await expect(composicao).toContainText(brl(3300));
    await expect(composicao).toContainText(`- ${brl(100)}`);
    await expect(composicao).toContainText(TOTAL_MEDICAO);

    await page.getByRole("button", { name: "Salvar validação", exact: true }).click();
    await page.getByRole("button", { name: "Aprovar boletim", exact: true }).click();
    const dialogo = page.getByRole("alertdialog", { name: "Aprovar boletim" });
    await expect(dialogo).toContainText(`Total da medição${TOTAL_MEDICAO}`);
    await expect(dialogo).toContainText(`REV / Ajustes${REV}`);
    await expect(dialogo).toContainText(`Total a pagar${TOTAL_A_PAGAR}`);
    await dialogo.getByRole("button", { name: "Aprovar boletim" }).click();
    await expect(page.getByTestId("portal-status")).toHaveText("Aguardando envio da NF");
    const sgc = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: USUARIO, ciclo } } });
    expect(sgc.status).toBe("AGUARDANDO_NF");
  });

  test("GATE: PDF depois da aprovação — TOTAL DA MEDIÇÃO = valor aprovado; TOTAL A PAGAR = medição + REV", async ({ page }) => {
    await entrar(page, USUARIO, SENHA);
    await page.goto("/");
    await page.getByRole("button", { name: "Minhas Medições" }).first().click();
    const card = page.locator("div").filter({ hasText: `Ciclo ${ciclo}` }).filter({ has: page.getByRole("button", { name: /Ver Boletim de Medição/ }) }).last();
    await expect(card).toContainText(`Total a pagar${TOTAL_A_PAGAR}`);
    await card.getByRole("button", { name: /Ver Boletim de Medição/ }).click();
    const bm = page.locator("table").filter({ hasText: "BOLETIM DE MEDIÇÃO" }).first();
    await expect(bm).toBeVisible();
    const texto = (await bm.innerText()).replace(/\s+/g, " ");
    const totalMedicaoPdf = texto.match(/TOTAL DA MEDIÇÃO (R\$\s?[\d.,]+)/)?.[1]?.replace(/\s/g, " ");
    const totalAPagarPdf = texto.match(/TOTAL A PAGAR: (R\$\s?[\d.,]+)/)?.[1]?.replace(/\s/g, " ");
    expect(totalMedicaoPdf, "PDF: TOTAL DA MEDIÇÃO = valor mostrado antes de aprovar").toBe(valorAntesDeAprovar.replace(/\s/g, " "));
    expect(totalAPagarPdf, "PDF: TOTAL A PAGAR = TOTAL DA MEDIÇÃO + REV").toBe(totalAPagarAntesDeAprovar.replace(/\s/g, " "));
    expect(texto).toMatch(/Total da medição R\$\s?4\.200,00/);
    expect(texto).toMatch(/REV \/ Ajustes R\$\s?250,00/);
    expect(texto).toMatch(/Total a pagar R\$\s?4\.450,00/);
    expect(texto).not.toMatch(/TOTAL DA MEDIÇÃO R\$\s?4\.450,00/);
  });

  test("Histórico e Evidências: lista e detalhe com o mesmo TOTAL DA MEDIÇÃO; REV e TOTAL A PAGAR separados", async ({ page }) => {
    await entrar(page, e2eUsers.admin.usuario, e2eUsers.admin.senha);

    await page.goto(`/?section=evidencias&ciclo=${ciclo}`);
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true }).locator(`option[value="${ciclo}"]`)).toHaveCount(1);
    await page.getByRole("textbox", { name: "Buscar evidências" }).fill(NOME);
    const linhaEvidencia = page.getByRole("row", { name: `Abrir evidência de ${NOME} no ciclo ${ciclo}` });
    await expect(linhaEvidencia).toContainText(TOTAL_MEDICAO);
    await linhaEvidencia.click();
    const evidencia = page.getByTestId("evidencia-composicao");
    await expect(evidencia).toContainText(`Total da medição${TOTAL_MEDICAO}`);
    await expect(evidencia).toContainText(`REV / Ajustes${REV}`);
    await expect(evidencia).toContainText(`Total a pagar${TOTAL_A_PAGAR}`);
    await expect(evidencia).not.toContainText("não corresponde ao valor gravado");

    await page.goto("/?section=historico");
    await expect(page.getByRole("heading", { name: "Histórico", exact: true, level: 1 }).last()).toBeVisible();
    await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(NOME);
    const linhaHistorico = page.getByRole("row", { name: `Abrir medição de ${NOME} no ciclo ${ciclo}` });
    await expect(linhaHistorico).toContainText(TOTAL_MEDICAO);
    await linhaHistorico.click();
    const historico = page.getByTestId("historico-composicao");
    await expect(historico).toContainText(`Total da medição${TOTAL_MEDICAO}`);
    await expect(historico).toContainText(`Total a pagar${TOTAL_A_PAGAR}`);
    await expect(historico).not.toContainText("não corresponde ao valor gravado");
  });
});
