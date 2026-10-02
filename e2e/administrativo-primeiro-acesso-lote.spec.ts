import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Administrativo → Fornecedores: seleção múltipla + "Enviar primeiro acesso" em lote.
 * Fixtures próprias (removidas no fim):
 *   A, B — COLABORADOR com primeiro acesso pendente e e-mail → aptos;
 *   C    — senha já definida pelo usuário (primeiroLogin = false) → inapto (regra real do botão individual);
 *   D    — sem e-mail de acesso → inapto.
 * E-mail: EMAIL_TEST_MODE + provider fake do webServer do Playwright — nada sai para endereço real.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 6).toUpperCase();
const PREFIXO = `E2E PAL ${S}`;
const NOMES = { A: `${PREFIXO} A`, B: `${PREFIXO} B`, C: `${PREFIXO} C`, D: `${PREFIXO} D` } as const;
type Letra = keyof typeof NOMES;
const cadastroIds: Record<Letra, string> = { A: "", B: "", C: "", D: "" };
const usuarioIds: Record<Letra, string> = { A: "", B: "", C: "", D: "" };
const hashInicial: Record<Letra, string> = { A: "", B: "", C: "", D: "" };

async function abrir(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
  await page.goto("/?section=administrativo");
  await expect(page.getByRole("heading", { name: "Administrativo", exact: true, level: 1 }).last()).toBeVisible();
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(PREFIXO);
}

function checkbox(page: Page, letra: Letra) {
  return page.getByRole("checkbox", { name: `Selecionar ${NOMES[letra]}`, exact: true });
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

test.describe.serial("Administrativo — envio em lote do primeiro acesso", () => {
  test.beforeAll(async () => {
    const def: Record<Letra, { primeiroLogin: boolean; email: string | null }> = {
      A: { primeiroLogin: true, email: `pal-a-${S.toLowerCase()}@example.test` },
      B: { primeiroLogin: true, email: `pal-b-${S.toLowerCase()}@example.test` },
      C: { primeiroLogin: false, email: `pal-c-${S.toLowerCase()}@example.test` },
      D: { primeiroLogin: true, email: null },
    };
    const base = 990000 + Math.floor(Math.random() * 9000);
    for (const [i, letra] of (["A", "B", "C", "D"] as const).entries()) {
      const usuario = await prisma.usuario.create({
        data: { usuario: `P0${base + i}`, nome: NOMES[letra], perfil: "COLABORADOR", senhaHash: `hash-inicial-${letra}`, ativo: true, ...def[letra] },
      });
      usuarioIds[letra] = usuario.id;
      hashInicial[letra] = usuario.senhaHash;
      const cadastro = await prisma.cadastroFornecedor.create({
        data: { responsavel: NOMES[letra], razaoSocial: `${NOMES[letra]} LTDA`, cnpjNormalizado: `9${base}${i}000101`.slice(0, 14), email: def[letra].email },
      });
      cadastroIds[letra] = cadastro.id;
    }
  });

  test.afterAll(async () => {
    const ids = Object.values(usuarioIds).filter(Boolean);
    await prisma.emailLog.deleteMany({ where: { OR: ids.map((id) => ({ idempotencyKey: { startsWith: `first-access/${id}/` } })) } });
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: PREFIXO } } });
    await prisma.usuario.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  });

  test("seleção, confirmação com prévia, envio único (duplo clique) e resultado — só os aptos recebem", async ({ page }) => {
    await abrir(page);
    await expect(page.getByTestId("administrativo-tabela").getByRole("row", { name: new RegExp(`Abrir cadastro de ${PREFIXO}`) })).toHaveCount(4);

    // Nenhum selecionado → nenhuma barra de lote.
    await expect(page.getByTestId("bulk-selection-bar")).toHaveCount(0);

    // Um selecionado → barra contextual, cabeçalho "indeterminate".
    await checkbox(page, "A").check();
    const barra = page.getByTestId("bulk-selection-bar");
    await expect(barra).toContainText("1 fornecedor selecionado");
    await expect(barra.getByTestId("bulk-aptos-primeiro-acesso")).toHaveText("1 apto ao primeiro acesso");
    const cabecalho = page.getByRole("checkbox", { name: "Selecionar todos os fornecedores filtrados" }).first();
    expect(await cabecalho.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);

    // Vários selecionados.
    await checkbox(page, "B").check();
    await expect(barra).toContainText("2 fornecedores selecionados");
    await expect(barra.getByTestId("bulk-aptos-primeiro-acesso")).toHaveText("2 aptos ao primeiro acesso");

    await barra.getByRole("button", { name: "Enviar primeiro acesso" }).click();
    const dialogo = page.getByTestId("primeiro-acesso-lote-dialog");
    await expect(dialogo.getByRole("heading", { name: "Enviar primeiro acesso" })).toBeVisible();
    await expect(dialogo.getByTestId("primeiro-acesso-lote-previa")).toContainText("Selecionados2");
    await expect(dialogo.getByTestId("primeiro-acesso-lote-previa")).toContainText("Aptos para envio2");

    // Duplo clique no confirmar → UMA requisição.
    let posts = 0;
    page.on("request", (r) => { if (r.url().endsWith("/api/admin/administrativo/fornecedores/primeiro-acesso") && r.method() === "POST") posts += 1; });
    const resposta = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/primeiro-acesso") && r.request().method() === "POST");
    await dialogo.getByRole("button", { name: "Enviar 2 acessos" }).dblclick();
    const res = await resposta;
    expect(res.status()).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ totalSelecionados: 2, enviados: 2, ignorados: 0, falhas: 0 });
    expect(JSON.stringify(corpo), "resposta sem e-mail/login/senha").not.toMatch(/@example\.test|P0\d{6}|senha/i);

    await expect(dialogo.getByRole("heading", { name: "Envio concluído" })).toBeVisible();
    await expect(dialogo.getByTestId("primeiro-acesso-lote-resumo")).toContainText("2 primeiros acessos enviados.");
    await dialogo.getByRole("button", { name: "Ver detalhes" }).click();
    await expect(dialogo.getByTestId("primeiro-acesso-lote-detalhes").locator('[data-status="ENVIADO"]')).toHaveCount(2);
    expect(posts).toBe(1);

    // Mesma regra do individual: senha rotacionada, primeiroLogin mantido, sem senha em texto, e-mail FIRST_ACCESS registrado.
    for (const letra of ["A", "B"] as const) {
      const u = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioIds[letra] } });
      expect(u.senhaHash).not.toBe(hashInicial[letra]);
      expect(u.primeiroLogin).toBe(true);
      expect(u.senhaTemporaria).toBeNull();
      const logs = await prisma.emailLog.findMany({ where: { event: "FIRST_ACCESS", idempotencyKey: { startsWith: `first-access/${usuarioIds[letra]}/` } } });
      expect(logs.map((l) => l.status)).toEqual(["SENT"]);
      expect(logs[0].actualRecipients, "EMAIL_TEST_MODE: nunca o endereço do fornecedor").toEqual(["e2e-test-recipient@example.test"]);
    }
    for (const letra of ["C", "D"] as const) {
      const u = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioIds[letra] } });
      expect(u.senhaHash, `${letra} não selecionado → intocado`).toBe(hashInicial[letra]);
    }

    // Fechar: seleção processada limpa, busca preservada, sem refresh completo.
    await dialogo.getByRole("button", { name: "Fechar" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(barra).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Buscar cadastros" })).toHaveValue(PREFIXO);
  });

  test("selecionar todos da visualização: inaptos ficam explícitos, com o motivo real, antes de enviar", async ({ page }) => {
    await abrir(page);
    await page.getByRole("checkbox", { name: "Selecionar todos os fornecedores filtrados" }).first().check();
    const barra = page.getByTestId("bulk-selection-bar");
    await expect(barra).toContainText("4 fornecedores selecionados");
    await expect(barra.getByTestId("bulk-aptos-primeiro-acesso")).toHaveText("2 aptos ao primeiro acesso");

    // Filtro/busca não descarta a seleção em silêncio: a barra avisa o que ficou fora da visualização.
    await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(NOMES.A);
    await expect(barra).toContainText("3 selecionados fora da visualização atual");
    await page.getByRole("textbox", { name: "Buscar cadastros" }).fill(PREFIXO);

    await barra.getByRole("button", { name: "Enviar primeiro acesso" }).click();
    const dialogo = page.getByTestId("primeiro-acesso-lote-dialog");
    await expect(dialogo.getByTestId("primeiro-acesso-lote-previa")).toContainText("Selecionados4");
    await expect(dialogo.getByTestId("primeiro-acesso-lote-previa")).toContainText("Aptos para envio2");
    await expect(dialogo.getByTestId("primeiro-acesso-lote-previa")).toContainText("Não serão enviados2");
    await dialogo.getByRole("button", { name: "Ver quem não será enviado" }).click();
    const inaptos = dialogo.getByTestId("primeiro-acesso-lote-inaptos");
    await expect(inaptos.getByRole("listitem").filter({ hasText: NOMES.C })).toContainText("Acesso já ativado (senha definida pelo usuário)");
    await expect(inaptos.getByRole("listitem").filter({ hasText: NOMES.D })).toContainText("Sem e-mail cadastrado");
    await expect(dialogo.getByRole("button", { name: "Enviar 2 acessos" })).toBeEnabled();

    // Cancelar não envia nada e mantém a seleção.
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(barra).toContainText("4 fornecedores selecionados");
    await barra.getByRole("button", { name: "Limpar seleção" }).click();
    await expect(barra).toHaveCount(0);
  });

  test("servidor: revalida no envio, ignora inaptos, replay do mesmo requestId não reenvia; não-ADMIN recebe 403 sem envio", async ({ page }) => {
    await abrir(page);
    const url = "/api/admin/administrativo/fornecedores/primeiro-acesso";

    // Selecionado como apto, mas o fornecedor definiu a senha antes do envio → o estado do envio vale.
    await prisma.usuario.update({ where: { id: usuarioIds.B }, data: { primeiroLogin: false } });
    const requestId = randomUUID();
    const r1 = await page.request.post(url, { data: { ids: [cadastroIds.A, cadastroIds.B, cadastroIds.C, cadastroIds.D, cadastroIds.A], requestId } });
    expect(r1.status()).toBe(200);
    const b1 = await r1.json();
    expect(b1).toMatchObject({ totalSelecionados: 4, enviados: 1, ignorados: 3, falhas: 0 });
    const motivo = (id: string, b: typeof b1) => b.resultados.find((x: { id: string }) => x.id === id)?.motivo;
    expect(motivo(cadastroIds.B, b1)).toBe("Acesso já ativado (senha definida pelo usuário)");
    expect(motivo(cadastroIds.D, b1)).toBe("Sem e-mail cadastrado");

    const hashDepois = (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioIds.A } })).senhaHash;
    const r2 = await page.request.post(url, { data: { ids: [cadastroIds.A], requestId } });
    expect(motivo(cadastroIds.A, await r2.json())).toBe("Acesso já enviado nesta operação");
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioIds.A } })).senhaHash, "replay não rotaciona").toBe(hashDepois);

    expect((await page.request.post(url, { data: { ids: [cadastroIds.A], requestId: "x" } })).status()).toBe(400);
    expect((await page.request.post(url, { data: { ids: ["not-a-uuid"], requestId: randomUUID() } })).status()).toBe(400);
    await page.request.post("/api/auth/logout");

    // MEDICAO passa por requireAdmin, mas o envio é exclusivo do ADMIN literal (mesmo do individual).
    const claimsAntes = await prisma.adminAuditLog.count({ where: { targetId: { in: Object.values(usuarioIds) } } });
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    const negado = await page.request.post(url, { data: { ids: [cadastroIds.A], requestId: randomUUID() } });
    expect(negado.status()).toBe(403);
    expect(await prisma.adminAuditLog.count({ where: { targetId: { in: Object.values(usuarioIds) } } }), "403 sem nenhum envio parcial").toBe(claimsAntes);
    await page.request.post("/api/auth/logout");
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: seleção, barra e diálogo sem overflow`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await abrir(page);
      await checkbox(page, "A").check();
      const barra = page.getByTestId("bulk-selection-bar");
      await expect(barra.getByRole("button", { name: "Enviar primeiro acesso" })).toBeVisible();
      await semOverflow(page);
      await barra.getByRole("button", { name: "Enviar primeiro acesso" }).click();
      const dialogo = page.getByTestId("primeiro-acesso-lote-dialog");
      await expect(dialogo.getByRole("button", { name: "Enviar 1 acesso" })).toBeVisible();
      await semOverflow(page);
      await page.keyboard.press("Escape");
      await expect(dialogo).toHaveCount(0);
    });
  }
});
