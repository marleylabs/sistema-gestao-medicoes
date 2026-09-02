import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * PROBLEMA 2 — cadastro manual de fornecedor no Painel Administrativo, reusando a mesma camada de
 * serviço da importação por XLSX (lib/cadastro-fornecedor.ts:upsertCadastroFornecedor) em vez de
 * duplicar a regra. CNPJ nunca é tratado como identidade única — dois fornecedores podem
 * compartilhar o mesmo CNPJ e continuam sendo cadastros independentes.
 */

test.beforeAll(assertConnectedToE2eDatabase);

async function abrirAdministrativo(page: import("@playwright/test").Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
  await page.goto("/?section=administrativo");
  await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
  // Espera a listagem real terminar de carregar — antes disso o card "Total" mostra 0
  // momentaneamente (estado inicial dos itens antes do primeiro fetch resolver).
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
}

async function preencherNovoFornecedor(page: import("@playwright/test").Page, opts: { responsavel: string; cnpj: string; email?: string }) {
  await page.getByRole("button", { name: "Novo fornecedor" }).click();
  await expect(page.getByRole("heading", { name: "Novo fornecedor" })).toBeVisible();
  await page.getByLabel("Nome / Responsável").fill(opts.responsavel);
  await page.getByLabel("CNPJ", { exact: true }).fill(opts.cnpj);
  await page.getByLabel("Razão social").fill(`${opts.responsavel} LTDA`);
  if (opts.email) await page.getByLabel("E-mail", { exact: true }).fill(opts.email);
}

test.describe.serial("Administrativo — cadastro manual de fornecedor", () => {
  test("SUCESSO: Novo fornecedor cadastra, atualiza cards/busca sem F5, e Editar funciona depois", async ({ page }) => {
    await abrirAdministrativo(page);

    const totalCard = page.locator("p", { hasText: "Total" }).locator("xpath=following-sibling::p[1]");
    const totalAntes = Number((await totalCard.textContent()) ?? "0");

    await preencherNovoFornecedor(page, { responsavel: "E2E Fornecedor Manual A", cnpj: "11.444.777/0001-61", email: "manuala@example.com" });

    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await expect(page.getByRole("button", { name: "Cadastrando..." })).toBeVisible();
    const res = await criarResponse;
    expect(res.status()).toBe(201);

    await expect(page.getByText("Fornecedor cadastrado com sucesso.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Novo fornecedor" })).toHaveCount(0);

    // Card "Total" incrementa sozinho — sem reload.
    await expect.poll(async () => Number((await totalCard.textContent()) ?? "0")).toBe(totalAntes + 1);

    // Busca encontra o fornecedor recém-criado sem reload.
    await page.getByPlaceholder("Buscar por responsável, razão social, CNPJ ou e-mail...").fill("E2E Fornecedor Manual A");
    await expect(page.getByRole("heading", { name: /Fornecedor Manual A/i })).toBeVisible();

    // Editar funciona normalmente — mesmo tipo de registro de um fornecedor importado.
    // (displayText() title-caseia o nome exibido — "E2E" pode virar "E2e" — busca só por um
    // trecho estável do nome, não pelo texto completo/caixa exata.)
    await page.getByRole("button", { name: "Editar" }).click();
    await expect(page.getByRole("heading", { name: /Fornecedor Manual A/i, level: 2 })).toBeVisible();
    await page.getByRole("button", { name: "Fechar" }).click();

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: "E2E Fornecedor Manual A" } });
    expect(cadastro.cnpjNormalizado).toBe("11444777000161");
    expect(cadastro.colaboradorCodigo).toBeTruthy();

    const profissional = await prisma.profissional.findFirst({ where: { codigo: cadastro.colaboradorCodigo! } });
    expect(profissional).toBeTruthy();

    await page.request.post("/api/auth/logout");
  });

  test("CNPJ COMPARTILHADO: dois fornecedores manuais com o MESMO CNPJ geram dois cadastros independentes", async ({ page }) => {
    await abrirAdministrativo(page);

    const mesmoCnpj = "22.666.899/0001-30";
    await preencherNovoFornecedor(page, { responsavel: "E2E Fornecedor Manual B", cnpj: mesmoCnpj });
    const criarB = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    expect((await criarB).status()).toBe(201);
    await expect(page.getByRole("heading", { name: "Novo fornecedor" })).toHaveCount(0);

    await preencherNovoFornecedor(page, { responsavel: "E2E Fornecedor Manual C", cnpj: mesmoCnpj });
    const criarC = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    expect((await criarC).status()).toBe(201);
    await expect(page.getByRole("heading", { name: "Novo fornecedor" })).toHaveCount(0);

    const cadastroB = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: "E2E Fornecedor Manual B" } });
    const cadastroC = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: "E2E Fornecedor Manual C" } });
    expect(cadastroB.cnpjNormalizado).toBe(cadastroC.cnpjNormalizado);
    expect(cadastroB.id).not.toBe(cadastroC.id);
    expect(cadastroB.colaboradorCodigo).not.toBe(cadastroC.colaboradorCodigo);

    await page.request.post("/api/auth/logout");
  });

  test("VALIDAÇÃO: CNPJ inválido é rejeitado com mensagem clara, nada é criado", async ({ page }) => {
    await abrirAdministrativo(page);
    await preencherNovoFornecedor(page, { responsavel: "E2E Fornecedor Manual Invalido", cnpj: "123" });
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await expect(page.getByText(/CNPJ inválido/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Novo fornecedor" })).toBeVisible();

    const count = await prisma.cadastroFornecedor.count({ where: { responsavel: "E2E Fornecedor Manual Invalido" } });
    expect(count).toBe(0);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.request.post("/api/auth/logout");
  });

  test("AUTORIZAÇÃO: FORNECEDOR (COLABORADOR) não consegue chamar o endpoint de cadastro manual", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);
    const res = await page.request.post("/api/admin/administrativo/fornecedores/manual", {
      data: { responsavel: "Tentativa Não Autorizada", cnpj: "11222333000181" },
    });
    expect(res.status()).toBe(403);
    await page.request.post("/api/auth/logout");
  });
});
