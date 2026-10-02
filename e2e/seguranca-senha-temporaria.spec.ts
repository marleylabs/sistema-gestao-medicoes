import { randomUUID } from "node:crypto";
import type { APIResponse, Page, Response } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Hardening da senha temporária — "Redefinir senha" persiste só o hash; a senha aparece UMA vez
 * (resposta imediata, no-store) e nunca mais é recuperável: nem por refresh, nem por nenhuma
 * listagem (inclusive a que ADMINISTRATIVO lê). A senha capturada da resposta só é comparada,
 * nunca impressa no log do teste.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 6).toUpperCase();
const NOME = `E2E SENHA ${S}`;
let usuarioId = "";
let login = "";

async function entrar(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function abrirDetalhe(page: Page) {
  await page.goto("/?section=administrativo");
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(NOME);
  await page.locator("[data-testid=administrativo-tabela]:visible, [data-testid=administrativo-lista-mobile]:visible").first()
    .getByRole(page.viewportSize()!.width < 768 ? "button" : "row", { name: new RegExp(`Abrir cadastro de ${NOME}`) }).click();
  await expect(page.getByTestId("administrativo-detalhe")).toBeVisible();
}

async function redefinir(page: Page): Promise<{ senha: string; resposta: Response }> {
  await page.getByTestId("administrativo-detalhe").getByRole("button", { name: "Redefinir senha" }).click();
  const resposta = page.waitForResponse((r) => r.url().endsWith(`/api/admin/usuarios/${usuarioId}`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Redefinir senha" }).last().click();
  const res = await resposta;
  expect(res.status()).toBe(200);
  const senha = (await res.json()).senhaTemporaria as string;
  expect(typeof senha === "string" && senha.length >= 6).toBe(true);
  return { senha, resposta: res };
}

async function semCredenciais(res: APIResponse, senha: string, rotulo: string) {
  expect(res.status(), rotulo).toBe(200);
  const texto = await res.text();
  expect(texto.includes(senha), `${rotulo}: senha recuperável`).toBe(false);
  expect(texto, `${rotulo}: chave de credencial`).not.toMatch(/"(senhaTemporaria|senhaHash|senha|password)"\s*:/);
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

test.describe.serial("Segurança — senha temporária (Redefinir senha)", () => {
  test.beforeAll(async () => {
    login = `P0${970000 + Math.floor(Math.random() * 9000)}`;
    // Usuário já ativo, com senha definida por ele (primeiroLogin=false) — caso real do "Redefinir senha".
    const u = await prisma.usuario.create({
      data: { usuario: login, nome: NOME, perfil: "COLABORADOR", ativo: true, primeiroLogin: false, senhaHash: `hash-anterior-${S}`, email: `senha-${S.toLowerCase()}@example.test` },
    });
    usuarioId = u.id;
    await prisma.cadastroFornecedor.create({ data: { responsavel: NOME, razaoSocial: `${NOME} LTDA`, cnpjNormalizado: `7${String(Date.now()).slice(-13)}` } });
  });

  test.afterAll(async () => {
    await prisma.emailLog.deleteMany({ where: { OR: [{ idempotencyKey: { startsWith: `password-reset/${usuarioId}/` } }, { idempotencyKey: { startsWith: `first-access/${usuarioId}/` } }] } });
    await prisma.adminAuditLog.deleteMany({ where: { targetId: usuarioId } });
    await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: NOME } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
  });

  test("reset: só hash no banco, senha exibida uma vez (no-store), refresh e listagens não recuperam; login com a nova senha", async ({ page, browser }) => {
    await entrar(page, e2eUsers.admin);
    await abrirDetalhe(page);
    const hashAntes = (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).senhaHash;
    const { senha, resposta } = await redefinir(page);

    // Resposta imediata: única que carrega a senha, nunca cacheável.
    expect(resposta.headers()["cache-control"]).toContain("no-store");

    // Banco: só o hash mudou; nenhum texto puro.
    const depois = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    expect(depois.senhaHash).not.toBe(hashAntes);
    expect(depois.senhaTemporaria).toBeNull();
    expect(depois.primeiroLogin, "fluxo atual: reset obriga a trocar a senha no próximo login").toBe(true);

    // Exibição única, com o aviso.
    const modal = page.getByTestId("credencial-modal");
    await expect(modal.getByRole("heading", { name: "Senha redefinida com sucesso" })).toBeVisible();
    await expect(modal).toContainText("Copie esta senha agora. Ela não poderá ser visualizada novamente.");
    await modal.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(modal.getByText(senha, { exact: true })).toBeVisible();
    await modal.getByRole("button", { name: "Concluir" }).click();
    await expect(modal).toHaveCount(0);

    // Refresh: nada recupera a senha (tela nem APIs de listagem).
    await page.reload();
    await abrirDetalhe(page);
    await expect(page.getByTestId("credencial-modal")).toHaveCount(0);
    expect((await page.content()).includes(senha), "senha no DOM após refresh").toBe(false);
    for (const url of ["/api/admin/administrativo/fornecedores?includeInactive=true", "/api/admin/administrativo/funcionarios", "/api/admin/usuarios", "/api/usuario/me"]) {
      await semCredenciais(await page.request.get(url), senha, url);
    }
    const acesso = ((await (await page.request.get("/api/admin/administrativo/fornecedores?includeInactive=true")).json()) as { responsavel: string; acesso: Record<string, unknown> | null }[])
      .find((c) => c.responsavel === NOME)?.acesso;
    expect(Object.keys(acesso ?? {}).sort(), "DTO explícito do acesso").toEqual(["ativo", "email", "id", "perfil", "primeiroLogin", "usuario"]);
    await page.request.post("/api/auth/logout");

    // A senha exibida autentica (contexto novo, sem sessão do ADMIN).
    const ctx = await browser.newContext();
    const r = await ctx.request.post("/api/auth/login", { data: { usuario: login, senha } });
    expect(r.status(), "login com a senha temporária").toBe(200);
    await ctx.close();
  });

  test("ADMINISTRATIVO: lê a listagem sem nenhuma credencial e não redefine senha (403)", async ({ page }) => {
    await entrar(page, e2eUsers.administrativo);
    const res = await page.request.get("/api/admin/administrativo/fornecedores?includeInactive=true");
    await semCredenciais(res, "\u0000nunca\u0000", "listagem ADMINISTRATIVO");
    const negado = await page.request.patch(`/api/admin/usuarios/${usuarioId}`, { data: { action: "reset_senha" } });
    expect(negado.status()).toBe(403);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).senhaTemporaria).toBeNull();
    await page.request.post("/api/auth/logout");
  });

  test("primeiro acesso individual: servidor recusa (409) quem já definiu a senha, sem rotacionar", async ({ page }) => {
    await prisma.usuario.update({ where: { id: usuarioId }, data: { primeiroLogin: false } });
    const hash = (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).senhaHash;
    await entrar(page, e2eUsers.admin);
    const res = await page.request.patch(`/api/admin/usuarios/${usuarioId}`, { data: { action: "enviar_primeiro_acesso", requestId: randomUUID() } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("Este usuário já definiu a própria senha. Para trocar a senha dele, use Redefinir senha.");
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).senhaHash).toBe(hash);
    expect(await prisma.adminAuditLog.count({ where: { action: "FIRST_ACCESS_SENT", targetId: usuarioId } })).toBe(0);

    // Com primeiro acesso pendente o mesmo endpoint segue funcionando (provider fake, destinatário de teste).
    await prisma.usuario.update({ where: { id: usuarioId }, data: { primeiroLogin: true } });
    const ok = await page.request.patch(`/api/admin/usuarios/${usuarioId}`, { data: { action: "enviar_primeiro_acesso", requestId: randomUUID() } });
    expect(ok.status()).toBe(200);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    expect(u.senhaTemporaria).toBeNull();
    expect(await prisma.emailLog.count({ where: { event: "FIRST_ACCESS", status: "SENT", idempotencyKey: { startsWith: `first-access/${usuarioId}/` } } })).toBe(1);
    await page.request.post("/api/auth/logout");
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: diálogo da senha sem overflow`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await entrar(page, e2eUsers.admin);
      await abrirDetalhe(page);
      await redefinir(page);
      const modal = page.getByTestId("credencial-modal");
      await expect(modal).toContainText("Ela não poderá ser visualizada novamente.");
      await semOverflow(page);
      await modal.getByRole("button", { name: "Concluir" }).click();
      await expect(modal).toHaveCount(0);
    });
  }
});
