import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Financeiro (redesign) — fechamento por ciclo. Fixtures próprias num ciclo isolado; a composição
 * vem do BM real (condição fixa 8.340 + documentos 7.000 − desconto 280 = 15.060, igual ao valor
 * do mapa). Nenhum valor é hardcoded como regra de produto: tudo deriva das fixtures abaixo.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const CICLO = "2911";
const S = randomUUID().slice(0, 5).toUpperCase();
const A = { codigo: `FIN RD A ${S}`, valor: 15060, rev: 0 };
const B = { codigo: `FIN RD B ${S}`, valor: 5000, rev: 0 };
const C = { codigo: `FIN RD C ${S}`, valor: 3000, rev: 150 };
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

async function abrir(page: Page, usuario: { usuario: string; senha: string }) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario.usuario, usuario.senha);
  await page.goto("/?section=financeiro");
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true, level: 1 }).last()).toBeVisible();
}

async function selecionarCiclo(page: Page) {
  await page.getByRole("combobox", { name: "Ciclo" }).selectOption(CICLO);
  // Desktop: tabela; mobile: lista compacta (a outra fica no DOM, oculta).
  await expect(page.locator("[data-testid=financeiro-tabela]:visible, [data-testid=financeiro-lista-mobile]:visible").first()).toBeVisible();
}

function linha(page: Page, codigo: string) {
  return page.getByTestId("financeiro-tabela").getByRole("row", { name: `Abrir pagamento de ${codigo}` });
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

test.describe.serial("Financeiro — redesign (resumo, lista, detalhe, pagamento)", () => {
  test.beforeAll(async () => {
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: CICLO } });
    await prisma.mapaPagamentoContexto.create({
      data: { ciclo: CICLO, mesReferencia: "E2E Financeiro", producaoInicio: new Date("2029-10-01"), producaoFim: new Date("2029-10-31"), atoCiclo: CICLO },
    });
    const projeto = await prisma.projeto.findFirstOrThrow();
    for (const f of [A, B, C]) {
      await prisma.profissional.create({ data: { nome: f.codigo, codigo: f.codigo, nomeCompleto: f.codigo, cnpj: "11.222.333/0001-81", razaoSocial: `${f.codigo} LTDA` } });
      await prisma.mapaPagamentoItem.create({
        data: {
          ciclo: CICLO, ordem: 1, projetistaCodigo: f.codigo, responsavel: f.codigo, razaoSocial: `${f.codigo} LTDA`,
          valor: f.valor, rev: f.rev, sourceRowHash: `e2e-fin-rd-${S}-${f.codigo}`,
          rawPayload: f === A ? { condicoesFixas: { valorFixo: "8340" } } : {},
        },
      });
    }
    const profA = await prisma.profissional.findUniqueOrThrow({ where: { codigo: A.codigo } });
    await prisma.medicao.create({
      data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: profA.id, ciclo: CICLO, numeroDocumento: `DOC-${S}`, tipo2: "DG", condicao: "700", equivalenteA1Horas: 10, percentualEmissao: 1, sourceRowHash: `e2e-fin-rd-doc-${S}` },
    });
    await prisma.medicao.create({
      data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: profA.id, ciclo: CICLO, numeroDocumento: `DESC-${S}`, tipo2: "DESCONTO", condicao: "-280", equivalenteA1Horas: 1, percentualEmissao: 1, obs: `Desconto teste ${S}`, sourceRowHash: `e2e-fin-rd-desc-${S}` },
    });
    const agora = new Date();
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: A.codigo, colaboradorNome: A.codigo, ciclo: CICLO, status: "APROVADO", nfArquivo: Buffer.from("nf"), nfArquivoNome: "nf-a.pdf", nfCarregadoAt: agora } });
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: B.codigo, colaboradorNome: B.codigo, ciclo: CICLO, status: "AGUARDANDO_NF" } });
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: C.codigo, colaboradorNome: C.codigo, ciclo: CICLO, status: "PAGO", nfArquivo: Buffer.from("nf"), nfArquivoNome: "nf-c.pdf", nfCarregadoAt: agora, pagoAt: agora } });
  });

  test.afterAll(async () => {
    const codigos = [A.codigo, B.codigo, C.codigo];
    await prisma.medicao.deleteMany({ where: { ciclo: CICLO, sourceRowHash: { startsWith: `e2e-fin-rd-` } } });
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: CICLO, colaboradorCodigo: { in: codigos } } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { ciclo: CICLO, projetistaCodigo: { in: codigos } } });
    await prisma.profissional.deleteMany({ where: { codigo: { in: codigos } } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: CICLO } });
  });

  test("RESUMO + LISTA: totais e contagens por status vêm da mesma fonte da tabela; busca e aba de status filtram", async ({ page }) => {
    await abrir(page, e2eUsers.financeiro);
    await selecionarCiclo(page);
    const resumo = page.getByTestId("financeiro-resumo");
    const totalEsperado = A.valor + A.rev + B.valor + B.rev + C.valor + C.rev;
    await expect(resumo).toContainText(brl(totalEsperado));
    await expect(resumo).toContainText("3 BM(s) aprovado(s)");
    await expect(page.getByTestId("financeiro-total")).toHaveText(brl(totalEsperado));

    await expect(linha(page, A.codigo)).toContainText("Aguardando pgto.");
    await expect(linha(page, B.codigo)).toContainText("Aguardando NF");
    await expect(linha(page, C.codigo)).toContainText("Concluído");
    await expect(linha(page, C.codigo)).toContainText(brl(C.valor + C.rev)); // valor + rev

    await page.getByRole("textbox", { name: "Buscar pagamentos" }).fill(`FIN RD B ${S}`);
    await expect(page.getByTestId("financeiro-tabela").locator("tbody tr")).toHaveCount(1);
    await page.getByRole("textbox", { name: "Buscar pagamentos" }).fill("");
    await page.getByRole("tab", { name: /Concluído/ }).click();
    await expect(page.getByTestId("financeiro-tabela").locator("tbody tr")).toHaveCount(1);
    await expect(linha(page, C.codigo)).toBeVisible();
    await page.getByRole("tab", { name: /Todos/ }).click();
    await expect(page.getByTestId("financeiro-tabela").getByRole("button", { name: /Marcar pago|Ver BM/ })).toHaveCount(0);
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("DETALHE: valor igual ao da lista; composição do BM (condição fixa, documentos, desconto negativo); ação só no APROVADO", async ({ page }) => {
    await abrir(page, e2eUsers.financeiro);
    await selecionarCiclo(page);
    const valorLinha = norm(await linha(page, A.codigo).locator("td").nth(4).textContent());
    await linha(page, A.codigo).click();
    const detalhe = page.getByTestId("financeiro-detalhe");
    await expect(detalhe.getByRole("heading", { name: A.codigo, level: 2 })).toBeVisible();
    await expect(detalhe.getByTestId("financeiro-detalhe-valor")).toHaveText(valorLinha);
    const composicao = detalhe.getByTestId("financeiro-composicao");
    await expect(composicao).toContainText(`Condições fixas${brl(8340)}`);
    await expect(composicao).toContainText(`Documentos medidos${brl(7000)}`);
    await expect(composicao).toContainText(`Descontos- ${brl(280)}`);
    await expect(composicao).toContainText(`Total da medição${brl(15060)}`);
    await expect(detalhe.getByText(/não corresponde ao valor gravado/)).toHaveCount(0);
    await expect(detalhe.getByText(`Desconto teste ${S}`)).toBeVisible();
    await expect(detalhe.getByRole("link", { name: "Abrir NF" })).toBeVisible();
    await expect(detalhe.getByRole("button", { name: "Marcar pago" })).toBeVisible();
    await detalhe.getByRole("button", { name: "Fechar" }).click();

    for (const outro of [B, C]) {
      await linha(page, outro.codigo).click();
      await expect(detalhe.getByRole("heading", { name: outro.codigo, level: 2 })).toBeVisible();
      await expect(detalhe.getByRole("button", { name: "Marcar pago" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(detalhe).toHaveCount(0);
    }
    await page.request.post("/api/auth/logout");
  });

  test("MARCAR PAGO no detalhe: cancelar não altera; confirmar registra PAGO (mesmo PATCH) e a lista reflete", async ({ page }) => {
    await abrir(page, e2eUsers.financeiro);
    await selecionarCiclo(page);
    await linha(page, A.codigo).click();
    const detalhe = page.getByTestId("financeiro-detalhe");
    await detalhe.getByRole("button", { name: "Marcar pago" }).click();
    await expect(detalhe.getByTestId("financeiro-confirmar-pagamento")).toBeVisible();
    await detalhe.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(detalhe.getByTestId("financeiro-confirmar-pagamento")).toHaveCount(0);
    expect((await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: A.codigo, ciclo: CICLO } })).status).toBe("APROVADO");

    await detalhe.getByRole("button", { name: "Marcar pago" }).click();
    const patch = page.waitForResponse((r) => r.url().endsWith("/api/admin/financeiro") && r.request().method() === "PATCH");
    await detalhe.getByRole("button", { name: "Confirmar pagamento" }).click();
    expect((await patch).status()).toBe(200);
    await expect(linha(page, A.codigo)).toContainText("Concluído");
    await expect(detalhe.getByRole("button", { name: "Marcar pago" })).toHaveCount(0);
    await expect(detalhe.getByText("Registrado sem comprovante")).toBeVisible();
    expect((await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: A.codigo, ciclo: CICLO } })).status).toBe("PAGO");
    await page.request.post("/api/auth/logout");
  });

  test("MOBILE 375: lista compacta com valor e status; toque abre detalhe em tela cheia; sem overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrir(page, e2eUsers.financeiro);
    await selecionarCiclo(page);
    const lista = page.getByTestId("financeiro-lista-mobile");
    const item = lista.getByRole("button", { name: new RegExp(B.codigo) });
    await expect(item).toContainText(brl(B.valor));
    await expect(item).toContainText("Aguardando NF");
    await semOverflow(page);
    await item.click();
    const detalhe = page.getByTestId("financeiro-detalhe");
    await expect(detalhe.getByRole("heading", { name: B.codigo, level: 2 })).toBeVisible();
    expect((await detalhe.locator("aside").boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(370);
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÕES: ADMINISTRATIVO só exporta (sem lista/detalhe/ação); MEDICAO não acessa o Financeiro", async ({ page }) => {
    await abrir(page, e2eUsers.administrativo);
    await expect(page.getByRole("button", { name: "Exportar concluídos" })).toBeVisible();
    await expect(page.getByTestId("financeiro-tabela")).toHaveCount(0);
    await expect(page.getByTestId("financeiro-resumo")).toHaveCount(0);
    await page.request.post("/api/auth/logout");

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=financeiro");
    await expect(page.getByRole("heading", { name: "Financeiro", exact: true, level: 1 })).toHaveCount(0);
    await page.request.post("/api/auth/logout");
  });
});
