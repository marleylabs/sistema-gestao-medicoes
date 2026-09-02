import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";

/**
 * Login e matriz de acesso por perfil — a parte do E2E autenticado que este ambiente consegue
 * provar de ponta a ponta (credenciais próprias, seedadas em scripts/seed-e2e.ts, banco isolado).
 */

test.describe("Login por perfil", () => {
  test("ADMIN: login, sessão criada, sidebar com todas as seções administrativas", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

    await expect(page).toHaveURL("/");
    for (const label of ["Visão Geral", "Administrativo", "Evidências", "Financeiro", "Histórico", "Usuários"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("MEDICAO: login, sessão criada, sidebar restrita (sem Administrativo/Financeiro/Usuários)", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Visão Geral" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Evidências" })).toBeVisible();
    for (const label of ["Administrativo", "Financeiro", "Usuários", "Histórico"]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  });

  test("FINANCEIRO: login, acesso restrito só à área Financeira", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.financeiro.usuario, e2eUsers.financeiro.senha);

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Financeiro", exact: true })).toBeVisible();
    for (const label of ["Administrativo", "Evidências", "Usuários", "Visão Geral"]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  });

  test("FORNECEDOR A: login abre o Portal do Fornecedor, não o painel administrativo", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);

    await expect(page).toHaveURL("/");
    await expect(page.getByText(/Acompanhe seu BM, nota fiscal, pagamento e comprovante\./)).toBeVisible();
    // Nunca deve ver navegação administrativa.
    await expect(page.getByRole("button", { name: "Usuários" })).toHaveCount(0);
  });

  test("senha incorreta: mensagem genérica e segura, sem autenticar", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, "senha-completamente-errada-123");

    await expect(page).toHaveURL(/\/login/);
    await login.expectErrorMessage(/Credenciais inválidas/i);
  });

  test("usuário inativo: login rejeitado mesmo com a senha correta", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.inativo.usuario, e2eUsers.inativo.senha);

    await expect(page).toHaveURL(/\/login/);
    await login.expectErrorMessage(/Credenciais inválidas|bloqueado/i);
  });

  test("logout: sessão anterior deixa de dar acesso a rota protegida", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
    await expect(page).toHaveURL("/");

    // Logout real via API (mesma chamada que o botão "Sair" dispara).
    await page.request.post("/api/auth/logout");
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("troca de perfil: logout de MEDICAO seguido de login de FORNECEDOR A não vaza sessão/estado entre contas", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await expect(page.getByRole("button", { name: "Visão Geral" })).toBeVisible();

    await page.request.post("/api/auth/logout");
    await page.goto("/login");
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);

    await expect(page.getByText(/Acompanhe seu BM, nota fiscal, pagamento e comprovante\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Visão Geral" })).toHaveCount(0);
  });
});
