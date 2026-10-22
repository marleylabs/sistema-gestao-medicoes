import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Aba Contratos do Administrativo (docs/brain/specs/contratos-cadastro.md): o Administrativo cadastra,
 * edita e inativa; a Medição lê a lista que o timesheet usa; o Financeiro não acessa.
 */

const NOME = `E2E Contrato ${randomUUID().slice(0, 6).toUpperCase()}`;

test.beforeAll(assertConnectedToE2eDatabase);
test.afterAll(async () => {
  const c = await prisma.contrato.findUnique({ where: { nome: NOME }, select: { id: true } });
  if (c) await prisma.adminAuditLog.deleteMany({ where: { targetType: "CONTRATO", targetId: c.id } });
  await prisma.contrato.deleteMany({ where: { nome: NOME } });
});

async function entrar(page: Page, usuario: { usuario: string; senha: string }) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario.usuario, usuario.senha);
}

test.describe.serial("Contratos no Administrativo", () => {
  test("Administrativo cadastra, edita e inativa um contrato", async ({ page }) => {
    await entrar(page, e2eUsers.administrativo);
    await page.goto("/?section=administrativo");
    await page.getByRole("tab", { name: /Contratos/ }).click();
    await page.getByRole("button", { name: "Novo contrato" }).click();

    const painel = page.getByTestId("administrativo-contrato-painel");
    await painel.getByLabel("Nº do contrato").fill("5900999001");
    await painel.getByLabel("Nome do contrato").fill(NOME);
    await painel.getByLabel("Gestor").fill("Gestor E2E");
    await painel.getByLabel("Fiscal (assina a folha do timesheet)").fill("Fiscal E2E");
    await painel.getByLabel("Início").fill("2026-01-01");
    await painel.getByLabel("Término").fill("2025-12-31");
    await painel.getByLabel("Valor contratual (R$)").fill("1.250.000,50");
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel.getByRole("alert")).toContainText("término não pode ser anterior");

    await painel.getByLabel("Término").fill("2026-12-31");
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel).toBeHidden();

    const linha = page.getByTestId("administrativo-contratos-tabela").getByRole("row", { name: `Abrir contrato ${NOME}` });
    await expect(linha).toContainText("5900999001");
    await expect(linha).toContainText("01/01/2026 → 31/12/2026");
    await expect(linha).toContainText("1.250.000,50");
    expect((await prisma.contrato.findUnique({ where: { nome: NOME }, select: { valorTotal: true } }))?.valorTotal?.toFixed(2)).toBe("1250000.50");

    await linha.click();
    await painel.getByRole("button", { name: "Inativar contrato" }).click();
    await expect(painel).toBeHidden();
    await expect(linha).toBeHidden(); // filtro padrão: só ativos
    await page.getByLabel("Situação do contrato").selectOption("inativos");
    await expect(linha).toContainText("Inativo");
  });

  test("Medição lê os contratos do timesheet; Financeiro não acessa o cadastro", async ({ page }) => {
    await entrar(page, e2eUsers.medicao);
    const lista = await (await page.request.get("/api/admin/contratos")).json() as Array<{ nome: string; fiscal: string | null; ativo: boolean }>;
    expect(lista.find((c) => c.nome === NOME)).toMatchObject({ fiscal: "Fiscal E2E", ativo: false });
    await page.request.post("/api/auth/logout");

    await entrar(page, e2eUsers.financeiro);
    expect((await page.request.get("/api/admin/contratos")).status()).toBe(403);
    expect((await page.request.post("/api/admin/contratos", { data: { nome: `${NOME} X` } })).status()).toBe(403);
  });
});
