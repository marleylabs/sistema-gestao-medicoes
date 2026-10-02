import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Resolução de identidades na importação de medição. O ETL não roda no E2E: o status do último
 * processamento (GET /api/admin/etl) é simulado com os detalhes que o etl devolve; as ações
 * (verificar, buscar, vincular, cadastrar) usam as rotas e o banco E2E reais. Dados sintéticos.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().replace(/[^a-f]/g, "").slice(0, 6).toUpperCase().padEnd(6, "X");
const ALFA = `E2E IDENT ALFA ${S}`;
const BETA = `E2E IDENT BETA ${S}`;
const APELIDO = `IDENT APELIDO ${S}`;
const ESCOLHA = `IDENT ESCOLHA ${S}`;
const NOVO = `IDENT NOVO ${S}`;
const GRD = "GRD-T-SINT-2026-0001";

const detalhes = [
  { valor: "", origem: "Documentos", coluna: "PROJETISTA", ciclo: "2804", status: "SEM_PROJETISTA", candidatos: [], ocorrencias: 2, linhas: [9, 10],
    exemplos: [{ linha: 9, numeroDocumento: "DOC-SINT-1", evidencia: "DESCRICAO SINTETICA" }] },
  { valor: APELIDO, origem: "Documentos", coluna: "PROJETISTA", ciclo: "2804", status: "NAO_RESOLVIDO", candidatos: [], ocorrencias: 7, linhas: [11, 12, 13, 14, 15, 16, 17], sugestoesCadastro: [ALFA] },
  { valor: ESCOLHA, origem: "Documentos Auxiliares", coluna: "Responsavel", ciclo: "2804", status: "NAO_RESOLVIDO", candidatos: [], ocorrencias: 1, linhas: [4], sugestoesCadastro: [] },
  { valor: GRD, origem: "Documentos", coluna: "PROJETISTA", ciclo: "2804", status: "NAO_RESOLVIDO", candidatos: [], ocorrencias: 3, linhas: [20, 21, 22], sugestoesCadastro: [] },
  { valor: NOVO, origem: "Documentos", coluna: "PROJETISTA", ciclo: "2804", status: "NAO_RESOLVIDO", candidatos: [], ocorrencias: 2, linhas: [30, 31], sugestoesCadastro: [] },
];

async function simularEtlBloqueado(page: Page, itens: unknown[], posts: string[]) {
  await page.route("**/api/admin/etl", async (route) => {
    if (route.request().method() !== "GET") {
      posts.push(route.request().method());
      return route.fulfill({ status: 500, json: { error: "ETL não deve ser chamado neste teste." } });
    }
    return route.fulfill({
      status: 200,
      json: { running: false, lastResult: null, lastError: "Importação bloqueada.", lastErrorType: "validation", lastErrorDetails: itens },
    });
  });
}

async function login(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const card = (page: Page, valor: string) => page.locator(`[data-testid="identidade-card"][data-valor="${valor}"]`).locator("xpath=..");

let alfaId = "";
let betaId = "";

test.describe.serial("Importação — resolução de identidades", () => {
  test.beforeAll(async () => {
    for (const [codigo, razao] of [[ALFA, `ALFA RAZAO ${S} LTDA`], [BETA, `BETA RAZAO ${S} LTDA`]]) {
      const p = await prisma.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: codigo } });
      await prisma.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigo, responsavel: codigo, razaoSocial: razao, rawPayload: {} } });
      if (codigo === ALFA) alfaId = p.id; else betaId = p.id;
    }
  });

  test.afterAll(async () => {
    const codigos = [ALFA, BETA, NOVO];
    const ids = (await prisma.profissional.findMany({ where: { codigo: { in: codigos } }, select: { id: true } })).map((p) => p.id);
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
    await prisma.profissional.deleteMany({ where: { id: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { nome: NOVO, perfil: "COLABORADOR" } });
  });

  test("ADMIN: cards, filtros, vínculo à sugestão, escolha de fornecedor e novo cadastro pré-preenchido", async ({ page }) => {
    test.setTimeout(120_000);
    const posts: string[] = [];
    await simularEtlBloqueado(page, detalhes, posts);
    await login(page, e2eUsers.admin);
    await page.goto("/?section=importar");

    const contador = page.getByTestId("identidades-contador");
    await expect(contador).toHaveText("4 de 4 identidade(s) pendente(s)");
    await expect(page.getByTestId("identidades-sem-projetista")).toContainText("2 linha(s) de medição sem PROJETISTA");
    await expect(page.getByTestId("identidades-sem-projetista").getByRole("button")).toHaveCount(0);

    // Ordenado por ocorrências; só as primeiras linhas, com expansão.
    const valores = await page.getByTestId("identidade-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-valor")));
    expect(valores).toEqual([APELIDO, GRD, NOVO, ESCOLHA]);
    await expect(card(page, APELIDO)).toContainText("linha(s) 11, 12, 13, 14, 15…");
    await card(page, APELIDO).getByRole("button", { name: `Expandir ${APELIDO}` }).click();
    await expect(card(page, APELIDO)).toContainText("linha(s) 11, 12, 13, 14, 15, 16, 17");
    await expect(card(page, APELIDO)).toContainText(`Sugestão (não aplicada): ${ALFA}`);
    await expect(card(page, ESCOLHA)).toContainText("Documentos Auxiliares · coluna Responsavel");

    // Resíduo de parser: sem ações (nem "novo").
    await expect(card(page, GRD).getByTestId("identidade-nao-parece-nome")).toBeVisible();
    await expect(card(page, GRD).getByRole("button", { name: /Vincular|Escolher|novo fornecedor/ })).toHaveCount(0);

    // Filtros e busca
    await page.getByRole("button", { name: "Sem sugestão", exact: true }).click();
    await expect(page.getByTestId("identidade-card")).toHaveCount(3);
    await page.getByRole("button", { name: "Com sugestão", exact: true }).click();
    await expect(page.getByTestId("identidade-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    await page.getByLabel("Buscar identidade").fill("escolha");
    await expect(page.getByTestId("identidade-card")).toHaveCount(1);
    await page.getByLabel("Buscar identidade").fill("");

    // 1) Vincular à sugestão — diálogo do design system, duplo clique cria um único alias.
    await card(page, APELIDO).getByRole("button", { name: "Vincular à sugestão" }).click();
    const vincular = page.getByTestId("identidade-vincular-dialog");
    await expect(vincular).toContainText(APELIDO);
    await expect(vincular).toContainText(ALFA);
    await vincular.getByRole("button", { name: "Confirmar vínculo" }).dblclick();
    await expect(vincular).toHaveCount(0);
    await expect(page.getByText(`"${APELIDO}" vinculado a ${ALFA}.`)).toBeVisible();
    await expect(contador).toHaveText("3 de 4 identidade(s) pendente(s)");
    await expect(card(page, APELIDO)).toContainText("Resolvido");
    const aliases = await prisma.profissionalAlias.findMany({ where: { profissionalId: alfaId } });
    expect(aliases.map((a) => [a.alias, a.origem])).toEqual([[APELIDO, "DOCUMENTOS"]]);
    const alfa = await prisma.profissional.findUniqueOrThrow({ where: { id: alfaId } });
    expect([alfa.codigo, alfa.nome]).toEqual([ALFA, ALFA]); // canônico intocado

    // 2) Escolher fornecedor — busca por razão social.
    await card(page, ESCOLHA).getByRole("button", { name: "Escolher fornecedor" }).click();
    const escolher = page.getByTestId("identidade-escolher-dialog");
    await escolher.getByLabel("Buscar fornecedor").fill(`BETA RAZAO ${S}`);
    await escolher.getByTestId("identidade-busca-resultados").getByRole("button", { name: new RegExp(BETA) }).click();
    await expect(escolher).toContainText(ESCOLHA);
    await escolher.getByRole("button", { name: "Confirmar vínculo" }).click();
    await expect(escolher).toHaveCount(0);
    await expect(contador).toHaveText("2 de 4 identidade(s) pendente(s)");
    expect((await prisma.profissionalAlias.findFirstOrThrow({ where: { profissionalId: betaId } })).origem).toBe("DOCUMENTOS_AUXILIARES");

    // Filtro "Resolvidos"
    await page.getByRole("button", { name: "Resolvidos", exact: true }).click();
    await expect(page.getByTestId("identidade-card")).toHaveCount(2);
    await page.getByRole("button", { name: "Todos", exact: true }).click();

    // 3) Confirmar como novo — abre o cadastro oficial só com o nome preenchido.
    await card(page, NOVO).getByRole("button", { name: "Confirmar como novo fornecedor" }).click();
    await page.getByTestId("identidade-novo-dialog").getByRole("button", { name: "Abrir cadastro" }).click();
    await expect(page.getByRole("heading", { name: "Novo fornecedor", exact: true })).toBeVisible();
    await expect(page.getByLabel("Nome / Responsável")).toHaveValue(NOVO);
    await expect(page.getByLabel("CNPJ", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Razão social")).toHaveValue("");
    await page.getByLabel("CNPJ", { exact: true }).fill("11.444.777/0001-61");
    await page.getByLabel("Razão social").fill(`${NOVO} LTDA`);
    const criar = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    expect((await criar).status()).toBe(201);
    await expect(page.getByRole("heading", { name: "Fornecedor cadastrado com sucesso" })).toBeVisible();
    await page.getByRole("button", { name: "Concluir" }).click();

    // De volta à importação: o novo fornecedor resolve pelo próprio código; resta o resíduo.
    await page.goto("/?section=importar");
    await expect(contador).toHaveText("1 de 4 identidade(s) pendente(s)");
    await expect(card(page, NOVO)).toContainText("Resolvido");
    await expect(page.getByTestId("identidades-todas-resolvidas")).toHaveCount(0);
    expect(posts, "nenhuma reimportação automática").toEqual([]);
    await page.request.post("/api/auth/logout");
  });

  test("tudo resolvido: pede reimportação, sem reimportar sozinho", async ({ page }) => {
    const posts: string[] = [];
    await simularEtlBloqueado(page, detalhes.filter((d) => d.valor === APELIDO || d.valor === ESCOLHA), posts);
    await login(page, e2eUsers.admin);
    await page.goto("/?section=importar");
    await expect(page.getByTestId("identidades-contador")).toHaveText("0 de 2 identidade(s) pendente(s)");
    await expect(page.getByTestId("identidades-todas-resolvidas")).toHaveText("Todas as identidades foram resolvidas. Reimporte a medição.");
    expect(posts).toEqual([]);
    await page.request.post("/api/auth/logout");
  });

  test("MEDICAO: vê as pendências sem ações; backend recusa vínculo e busca", async ({ page }) => {
    await simularEtlBloqueado(page, detalhes, []);
    await login(page, e2eUsers.medicao);
    await page.goto("/?section=importar");
    await expect(page.getByTestId("identidades-contador")).toHaveText("1 de 4 identidade(s) pendente(s)");
    await expect(page.getByText("Somente o perfil ADMIN pode vincular ou cadastrar fornecedores.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Vincular à sugestão|Escolher fornecedor|Confirmar como novo/ })).toHaveCount(0);
    const alias = await page.request.post("/api/admin/importacao/identidades/alias", { data: { alias: `OUTRO ${S}`, profissionalId: alfaId } });
    expect(alias.status()).toBe(403);
    expect((await page.request.get(`/api/admin/importacao/identidades/fornecedores?q=${encodeURIComponent(ALFA)}`)).status()).toBe(403);
    expect(await prisma.profissionalAlias.count({ where: { aliasNormalizado: `OUTRO ${S}` } })).toBe(0);
    await page.request.post("/api/auth/logout");
  });
});
