import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Administrativo (redesign) — cadastro mestre e configuração, separado da operação (/fornecedores).
 * Listagem limpa → linha abre o detalhe lateral → Editar cadastro troca o MESMO painel → Salvar volta
 * ao detalhe; Novo fornecedor usa o mesmo editor. Fixtures próprias, removidas no fim.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 6).toUpperCase();
const NOME = `E2E ADM REDESIGN ${S}`;
const RAZAO = `REDESIGN ${S} ENGENHARIA LTDA`;
const CNPJ = "45.723.174/0001-10";
let cadastroId = "";
let profissionalId = "";

async function abrir(page: Page, usuario: { usuario: string; senha: string }) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario.usuario, usuario.senha);
  await page.goto("/?section=administrativo");
  // No mobile a barra superior também mostra "Administrativo" (h1); o título da página vem depois.
  await expect(page.getByRole("heading", { name: "Administrativo", exact: true, level: 1 }).last()).toBeVisible();
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
}

function linha(page: Page) {
  return page.getByTestId("administrativo-tabela").getByRole("row", { name: new RegExp(`Abrir cadastro de ${NOME}`, "i") });
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

test.describe.serial("Administrativo — redesign (listagem, detalhe, edição, create)", () => {
  test.beforeAll(async () => {
    const profissional = await prisma.profissional.create({ data: { nome: NOME, codigo: NOME, nomeCompleto: NOME } });
    profissionalId = profissional.id;
    const cadastro = await prisma.cadastroFornecedor.create({
      data: {
        cnpjNormalizado: CNPJ.replace(/\D/g, ""),
        cnpj: CNPJ,
        colaboradorCodigo: NOME,
        responsavel: NOME,
        razaoSocial: RAZAO,
        fonteMedicao: "DOCUMENTOS_AUXILIARES",
        tipoCondicaoFixa: "CONDICIONAL_PRODUCAO",
        valorCondicaoFixa: 5310,
        valorCondicaoFixaComProducao: 8340,
        valorCondicaoFixaSemProducao: 12000,
        inicio: new Date("2026-01-01"),
        final: new Date("2027-12-31"),
        rawPayload: {},
      },
    });
    cadastroId = cadastro.id;
  });

  test.afterAll(async () => {
    await prisma.cadastroFornecedor.deleteMany({ where: { OR: [{ id: cadastroId }, { responsavel: `E2E ADM NOVO ${S}` }] } });
    await prisma.profissional.deleteMany({ where: { OR: [{ id: profissionalId }, { nome: `E2E ADM NOVO ${S}` }] } });
  });

  test("LISTAGEM: abre, KPIs, busca, filtro e linha abre o detalhe com identificação, empresa, medição e condição", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await expect(page.getByTestId("administrativo-kpis")).toBeVisible();
    await expect(page.getByTestId("administrativo-tabela")).toBeVisible();

    // Busca por nome, por razão social e por CNPJ (só dígitos).
    const busca = page.getByRole("textbox", { name: "Buscar cadastros" });
    await busca.fill(NOME);
    await expect(linha(page)).toHaveCount(1);
    await busca.fill(RAZAO);
    await expect(linha(page)).toHaveCount(1);
    await busca.fill("45723174");
    await expect(linha(page)).toHaveCount(1);

    // Filtro: fonte de medição mantém; condição "Fixa" exclui (fixture é condicional); limpar volta.
    await page.getByRole("button", { name: /Filtros/ }).click();
    await page.getByRole("combobox", { name: "Fonte de medição" }).selectOption("DOCUMENTOS_AUXILIARES");
    await expect(linha(page)).toHaveCount(1);
    await page.getByRole("combobox", { name: "Tipo de condição" }).selectOption("FIXA");
    await expect(linha(page)).toHaveCount(0);
    await expect(page.getByText("Nenhum cadastro encontrado com os filtros aplicados.")).toBeVisible();
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await page.getByRole("button", { name: "Concluído" }).click();
    await expect(linha(page)).toHaveCount(1);

    // Tabela sem coluna de botões: a linha abre o detalhe.
    await expect(page.getByTestId("administrativo-tabela").getByRole("button", { name: /Editar/ })).toHaveCount(0);
    await linha(page).click();
    const detalhe = page.getByTestId("administrativo-detalhe");
    await expect(detalhe.getByRole("heading", { name: NOME, level: 2 })).toBeVisible();
    await expect(detalhe.getByText("Identificação", { exact: true })).toBeVisible();
    await expect(detalhe.getByText("Código do colaborador")).toBeVisible();
    await expect(detalhe.getByText("Empresa", { exact: true })).toBeVisible();
    await expect(detalhe.getByText(CNPJ)).toBeVisible();
    await expect(detalhe.getByText("Configuração de medição")).toBeVisible();
    await expect(detalhe.getByText("Documentos auxiliares", { exact: true })).toBeVisible();
    await expect(detalhe.getByText("Condicional por produção")).toBeVisible();
    await expect(detalhe.getByText("Com produção")).toBeVisible();
    await expect(detalhe.getByText("Sem produção")).toBeVisible();
    await expect(detalhe.getByText("Base / fixa")).toBeVisible();
    await expect(detalhe.getByRole("button", { name: "Excluir permanentemente" })).toBeVisible();
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("DETALHE → EDITAR → CANCELAR → EDITAR → SALVAR → DETALHE: mesmo painel, fonte/condição preservadas", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(NOME);
    await linha(page).click();
    await page.getByRole("button", { name: "Editar cadastro" }).click();
    const editor = page.getByTestId("administrativo-editor");
    await expect(editor.getByText("Editar cadastro", { exact: true })).toBeVisible();
    await expect(page.getByTestId("administrativo-detalhe")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByTestId("administrativo-detalhe")).toBeVisible();

    await page.getByRole("button", { name: "Editar cadastro" }).click();
    await editor.getByLabel("Cargo").fill("Engenheiro Revisor");
    const salvar = page.waitForResponse((r) => r.url().includes(`/api/admin/administrativo/fornecedores/${cadastroId}`) && r.request().method() === "PATCH");
    await editor.getByRole("button", { name: "Salvar alterações" }).click();
    expect((await salvar).status()).toBe(200);
    await expect(page.getByText("Fornecedor atualizado com sucesso.")).toBeVisible();
    const detalhe = page.getByTestId("administrativo-detalhe");
    await expect(detalhe).toBeVisible();
    await expect(detalhe.getByText("Engenheiro Revisor")).toBeVisible();

    const salvo = await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroId } });
    expect(salvo.cargo).toBe("Engenheiro Revisor");
    expect(salvo.fonteMedicao).toBe("DOCUMENTOS_AUXILIARES");
    expect(salvo.tipoCondicaoFixa).toBe("CONDICIONAL_PRODUCAO");
    expect(Number(salvo.valorCondicaoFixaComProducao)).toBe(8340);
    expect(Number(salvo.valorCondicaoFixaSemProducao)).toBe(12000);
    await page.request.post("/api/auth/logout");
  });

  test("INATIVAR e REATIVAR pela confirmação do app (sem window.confirm); status reflete no detalhe", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(NOME);
    await linha(page).click();
    const detalhe = page.getByTestId("administrativo-detalhe");
    await detalhe.getByRole("button", { name: "Inativar fornecedor" }).click();
    const confirmacao = page.getByRole("alertdialog", { name: "Inativar fornecedor" });
    await expect(confirmacao).toBeVisible();
    await confirmacao.getByRole("button", { name: "Inativar fornecedor" }).click();
    await expect(page.getByText("Fornecedor inativado.")).toBeVisible();
    await expect.poll(async () => (await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroId } })).ativo).toBe(false);
    await expect(detalhe.getByText("Inativo", { exact: true }).first()).toBeVisible();
    // Profissional preservado (regra da inativação).
    expect(await prisma.profissional.findUnique({ where: { id: profissionalId } })).toBeTruthy();

    await detalhe.getByRole("button", { name: "Reativar fornecedor" }).click();
    await page.getByRole("alertdialog", { name: "Reativar fornecedor" }).getByRole("button", { name: "Reativar fornecedor" }).click();
    await expect(page.getByText("Fornecedor reativado.")).toBeVisible();
    await expect.poll(async () => (await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroId } })).ativo).toBe(true);
    await page.request.post("/api/auth/logout");
  });

  test("NOVO FORNECEDOR usa o mesmo editor lateral (create) e cadastra", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    const editor = page.getByTestId("administrativo-editor");
    await expect(editor.getByRole("heading", { name: "Novo fornecedor", exact: true })).toBeVisible();
    await expect(editor.getByText("Configuração de medição")).toBeVisible();
    await expect(editor.getByText("Condição fixa", { exact: true })).toBeVisible();
    await editor.getByLabel("Nome / Responsável").fill(`E2E ADM NOVO ${S}`);
    await editor.getByLabel("CNPJ", { exact: true }).fill("61.585.865/0001-51");
    await editor.getByLabel("Razão social").fill(`E2E ADM NOVO ${S} LTDA`);
    const criar = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await editor.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    expect((await criar).status()).toBe(201);
    await expect(page.getByTestId("administrativo-editor")).toHaveCount(0);
    await expect.poll(() => prisma.cadastroFornecedor.count({ where: { responsavel: `E2E ADM NOVO ${S}` } })).toBe(1);
    await page.request.post("/api/auth/logout");
  });

  test("MOBILE 375: lista compacta, toque abre o detalhe em tela cheia, sem overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrir(page, e2eUsers.admin);
    await semOverflow(page);
    await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(NOME);
    const item = page.getByTestId("administrativo-lista-mobile").getByRole("button", { name: new RegExp(NOME, "i") });
    await expect(item).toBeVisible();
    await item.click();
    const detalhe = page.getByTestId("administrativo-detalhe");
    await expect(detalhe.getByRole("heading", { name: NOME, level: 2 })).toBeVisible();
    const box = await detalhe.locator("aside").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(370);
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÕES: ADMINISTRATIVO edita mas não inativa/exclui/seleciona; MEDICAO sem permissão extra não vê a área", async ({ page }) => {
    await abrir(page, e2eUsers.administrativo);
    await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(NOME);
    await expect(page.getByRole("checkbox", { name: /Selecionar/ })).toHaveCount(0);
    await linha(page).click();
    const detalhe = page.getByTestId("administrativo-detalhe");
    await expect(detalhe.getByRole("button", { name: "Editar cadastro" })).toBeVisible();
    await expect(detalhe.getByRole("button", { name: /Inativar fornecedor|Reativar fornecedor/ })).toHaveCount(0);
    await expect(detalhe.getByRole("button", { name: "Excluir permanentemente" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo funcionário" })).toHaveCount(0);
    await page.request.post("/api/auth/logout");

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByRole("heading", { name: "Administrativo", exact: true, level: 1 })).toHaveCount(0);
    await page.request.post("/api/auth/logout");
  });
});
