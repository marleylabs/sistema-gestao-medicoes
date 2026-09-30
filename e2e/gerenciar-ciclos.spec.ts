import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Gerenciar ciclos em /fornecedores (antes no Histórico). Só a interface mudou: Novo ciclo = mesmo
 * POST /api/ciclos, Excluir = mesmo DELETE (somente ADMIN), Selecionar = troca o ciclo de trabalho
 * sem nenhuma escrita (nunca publica no portal). Ciclos isolados abaixo do ciclo do seed; os flags
 * originais de ativoMedicao são restaurados no fim.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const A = "2601";
const B = "2602";
const NOVO = "2509";
let flagsOriginais: { ciclo: string; ativoMedicao: boolean }[] = [];

async function login(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  // Espera o redirecionamento pós-login terminar — um page.goto() durante essa navegação é abortado.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function escritasEmCiclos(page: Page) {
  const escritas: { method: string; body: unknown }[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/ciclos" && r.method() !== "GET") escritas.push({ method: r.method(), body: r.postDataJSON() });
  });
  return escritas;
}

const publicados = async () =>
  (await prisma.mapaPagamentoContexto.findMany({ where: { ativoMedicao: true }, select: { ciclo: true } })).map((c) => c.ciclo);

test.describe.serial("Gerenciar ciclos — em /fornecedores", () => {
  test.beforeAll(async () => {
    flagsOriginais = await prisma.mapaPagamentoContexto.findMany({ select: { ciclo: true, ativoMedicao: true } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [A, B, NOVO] } } });
    for (const ciclo of [A, B]) await prisma.mapaPagamentoContexto.create({ data: { ciclo, mesReferencia: `E2E Gestão ${ciclo}`, atoCiclo: ciclo } });
  });

  test.afterAll(async () => {
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [A, B, NOVO] } } });
    for (const f of flagsOriginais) {
      await prisma.mapaPagamentoContexto.updateMany({ where: { ciclo: f.ciclo }, data: { ativoMedicao: f.ativoMedicao } });
    }
  });

  test("SELECIONAR: painel lista os ciclos; selecionar troca o ciclo de trabalho, fecha o painel e não publica", async ({ page }) => {
    const escritas = escritasEmCiclos(page);
    const antes = await publicados();
    await login(page, e2eUsers.admin);
    await page.goto(`/fornecedores?ciclo=${B}`);
    const publicadoAntes = await page.getByTestId("ciclo-publicado").innerText();

    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");
    await expect(painel.getByRole("heading", { name: "Gerenciar ciclos" })).toBeVisible();
    const lista = painel.getByTestId("gerenciar-ciclos-lista");
    await expect(lista.locator(`[data-ciclo="${A}"]`)).toBeVisible();
    await expect(lista.locator(`[data-ciclo="${B}"]`)).toContainText("Selecionado");

    await painel.getByRole("button", { name: `Selecionar ciclo ${A}` }).click();
    await expect(painel).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/fornecedores\\?ciclo=${A}$`));
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(A);

    expect(escritas, "selecionar ciclo nunca escreve").toEqual([]);
    expect(await publicados()).toEqual(antes);
    await expect(page.getByTestId("ciclo-publicado")).toContainText(publicadoAntes.split("\n").find((l) => l.startsWith("Ciclo publicado")) ?? "Ciclo publicado");

    // Fechar sem escolher preserva o contexto.
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("gerenciar-ciclos")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(A);
    expect(escritas).toEqual([]);
    await page.request.post("/api/auth/logout");
  });

  test("NOVO CICLO: mesmo POST /api/ciclos; o ciclo criado passa a ser o de trabalho e NÃO é publicado", async ({ page }) => {
    const escritas = escritasEmCiclos(page);
    const antes = await publicados();
    await login(page, e2eUsers.admin);
    await page.goto(`/fornecedores?ciclo=${B}`);
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");
    const input = painel.getByRole("textbox", { name: "Novo ciclo (YYMM)" });
    await input.fill("25");
    await expect(painel.getByRole("button", { name: "Novo ciclo" })).toBeDisabled();
    await input.fill(NOVO);
    await painel.getByRole("button", { name: "Novo ciclo" }).click();
    await expect(painel.getByTestId("gerenciar-ciclos-lista").locator(`[data-ciclo="${NOVO}"]`)).toContainText("Selecionado");
    expect(escritas).toEqual([{ method: "POST", body: { ciclo: NOVO } }]);
    const criado = await prisma.mapaPagamentoContexto.findUniqueOrThrow({ where: { ciclo: NOVO } });
    expect(criado.ativoMedicao).toBe(false);
    expect(await publicados()).toEqual(antes);
    await page.request.post("/api/auth/logout");
  });

  test("EXCLUIR (ADMIN): confirmação do design system; Cancelar não exclui; DELETE real limpa só o que pertencia ao ciclo", async ({ page }) => {
    const escritas = escritasEmCiclos(page);
    let dialogoNativo = false;
    page.on("dialog", async (d) => { dialogoNativo = true; await d.dismiss(); });
    await login(page, e2eUsers.admin);
    await page.goto(`/fornecedores?ciclo=${B}`);
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");

    await painel.getByRole("button", { name: `Excluir ciclo ${NOVO}` }).click();
    const dialogo = page.getByRole("alertdialog", { name: "Excluir ciclo" });
    await expect(dialogo.getByRole("heading", { name: `Excluir o ciclo ${NOVO}?` })).toBeVisible();
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(painel).toBeVisible();
    expect(escritas).toEqual([]);
    expect(await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo: NOVO } })).not.toBeNull();

    // DELETE REAL (sem interceptação). Cenário: o ciclo NOVO (= ciclo A excluído) tem um projeto e um
    // profissional usados só nele; o ciclo B tem os seus; e existem entidades SEM relação com o ciclo
    // excluído (profissional órfão, projeto sem medição, identidade canônica com alias, cadastro
    // administrativo). Excluir NOVO só pode limpar o que pertencia a NOVO.
    const S = `${Date.now()}`.slice(-6);
    const projA = await prisma.projeto.create({ data: { codigoProjeto: `E2E-DEL-PA-${S}`, contrato: "CTR DEL" } });
    const projB = await prisma.projeto.create({ data: { codigoProjeto: `E2E-DEL-PB-${S}`, contrato: "CTR DEL" } });
    const projSolto = await prisma.projeto.create({ data: { codigoProjeto: `E2E-DEL-PSOLTO-${S}` } });
    const profA = await prisma.profissional.create({ data: { nome: `E2E DEL PROF A ${S}`, codigo: `E2E-DEL-A-${S}` } });
    const profACadastro = await prisma.profissional.create({ data: { nome: `E2E DEL PROF A CAD ${S}`, codigo: `E2E-DEL-ACAD-${S}` } });
    const profB = await prisma.profissional.create({ data: { nome: `E2E DEL PROF B ${S}`, codigo: `E2E-DEL-B-${S}` } });
    const profSolto = await prisma.profissional.create({ data: { nome: `E2E DEL PROF SOLTO ${S}`, codigo: `E2E-DEL-SOLTO-${S}` } });
    const profCanonico = await prisma.profissional.create({ data: { nome: `E2E DEL CANONICO ${S}`, codigo: `E2E-DEL-CAN-${S}` } });
    await prisma.profissionalAlias.create({ data: { profissionalId: profCanonico.id, alias: `E2E DEL APELIDO ${S}`, aliasNormalizado: `e2e del apelido ${S}`, origem: "MANUAL" } });
    const cadastro = await prisma.cadastroFornecedor.create({ data: { colaboradorCodigo: profACadastro.codigo, responsavel: profACadastro.nome, cnpjNormalizado: "00000000000000", razaoSocial: "E2E DEL LTDA", ativo: true } });
    const doc = (ciclo: string, idProjeto: string, idProfissional: string, n: string) =>
      prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto, idProfissional, ciclo, numeroDocumento: `E2E-DEL-${n}-${S}`, tipo2: "DG", condicao: "100", equivalenteA1Horas: 1, percentualEmissao: 1, sourceRowHash: `e2e-del-${n}-${S}` } });
    await doc(NOVO, projA.id, profA.id, "A1");
    await doc(NOVO, projA.id, profACadastro.id, "A2");
    const medB = await doc(B, projB.id, profB.id, "B1");
    await prisma.mapaPagamentoItem.create({ data: { ciclo: B, ordem: 1, projetistaCodigo: profB.codigo, responsavel: profB.nome, valor: 10, sourceRowHash: `e2e-del-mapa-${S}` } });
    try {
      await painel.getByRole("button", { name: `Excluir ciclo ${NOVO}` }).click();
      const resposta = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/ciclos" && r.request().method() === "DELETE");
      await dialogo.getByRole("button", { name: "Excluir ciclo" }).click();
      const res = await resposta;
      expect(res.status()).toBe(200);
      const removed = (await res.json()).removed;
      await expect(dialogo).toHaveCount(0);
      await expect(painel.getByTestId("gerenciar-ciclos-lista").locator(`[data-ciclo="${NOVO}"]`)).toHaveCount(0);
      expect(escritas).toEqual([{ method: "DELETE", body: { confirmacao: "RESETAR_CICLOS", ciclo: NOVO } }]);

      // Ciclo excluído: contexto e medições removidos; projeto e profissional usados só nele, limpos.
      expect(await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo: NOVO } })).toBeNull();
      expect(await prisma.medicao.count({ where: { ciclo: NOVO, sourceRowHash: { startsWith: "e2e-del-" } } })).toBe(0);
      expect(await prisma.projeto.findUnique({ where: { id: projA.id } })).toBeNull();
      expect(await prisma.profissional.findUnique({ where: { id: profA.id } })).toBeNull();
      expect(removed.projetosOrfaos).toBe(1);
      expect(removed.profissionaisOrfaos).toBe(1);
      // Profissional do ciclo excluído, mas com cadastro administrativo: preservado (e o cadastro também).
      expect(await prisma.profissional.findUnique({ where: { id: profACadastro.id } })).not.toBeNull();
      expect(await prisma.cadastroFornecedor.findUnique({ where: { id: cadastro.id } })).not.toBeNull();
      // Outro ciclo intacto.
      expect(await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo: B } })).not.toBeNull();
      expect(await prisma.medicao.findUnique({ where: { id: medB.id } })).not.toBeNull();
      expect(await prisma.projeto.findUnique({ where: { id: projB.id } })).not.toBeNull();
      expect(await prisma.profissional.findUnique({ where: { id: profB.id } })).not.toBeNull();
      // Entidades sem relação com o ciclo excluído: nunca tocadas (antes: limpeza global silenciosa).
      expect(await prisma.projeto.findUnique({ where: { id: projSolto.id } }), "projeto sem medição de outro contexto").not.toBeNull();
      expect(await prisma.profissional.findUnique({ where: { id: profSolto.id } }), "profissional sem vínculo de outro contexto").not.toBeNull();
      expect(await prisma.profissional.findUnique({ where: { id: profCanonico.id } }), "identidade canônica").not.toBeNull();
      expect(await prisma.profissionalAlias.count({ where: { profissionalId: profCanonico.id } }), "aliases preservados").toBe(1);
    } finally {
      await prisma.mapaPagamentoItem.deleteMany({ where: { sourceRowHash: `e2e-del-mapa-${S}` } });
      await prisma.medicao.deleteMany({ where: { sourceRowHash: { startsWith: "e2e-del-" } } });
      await prisma.cadastroFornecedor.deleteMany({ where: { id: cadastro.id } });
      await prisma.profissional.deleteMany({ where: { codigo: { startsWith: "E2E-DEL-" } } });
      await prisma.projeto.deleteMany({ where: { codigoProjeto: { startsWith: "E2E-DEL-" } } });
    }
    expect(dialogoNativo, "sem window.confirm/alert").toBe(false);
    await expect(page.getByRole("combobox", { name: "Ciclo", exact: true })).toHaveValue(B);
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÕES: MEDICAO gerencia mas não exclui (botão ausente, DELETE 403); FINANCEIRO não tem controles de ciclo", async ({ page }) => {
    await login(page, e2eUsers.medicao);
    await page.goto(`/fornecedores?ciclo=${B}`);
    await page.getByRole("button", { name: "Gerenciar ciclos" }).click();
    const painel = page.getByTestId("gerenciar-ciclos");
    await expect(painel.getByRole("button", { name: "Novo ciclo" })).toBeVisible();
    await expect(painel.getByRole("button", { name: `Selecionar ciclo ${A}` })).toBeVisible();
    await expect(painel.getByRole("button", { name: /Excluir ciclo/ })).toHaveCount(0);
    expect((await page.request.delete("/api/ciclos", { data: { confirmacao: "RESETAR_CICLOS", ciclo: A } })).status()).toBe(403);
    await page.request.post("/api/auth/logout");

    await login(page, e2eUsers.financeiro);
    await page.goto("/fornecedores");
    await expect(page.getByRole("button", { name: "Gerenciar ciclos" })).toHaveCount(0);
    await expect(page.getByTestId("ciclo-publicado")).toHaveCount(0);
    expect((await page.request.post("/api/ciclos", { data: { ciclo: NOVO } })).status()).toBe(403);
    await page.request.post("/api/auth/logout");
  });
});
