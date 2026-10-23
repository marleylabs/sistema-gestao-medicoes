import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { APIRequestContext, Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { e2eUsers } from "./fixtures";
import { LoginPage } from "./pages/login-page";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Aprovação das horas pelo fiscal (docs/brain/specs/timesheet-aprovacao-fiscal.md): o fornecedor lança três
 * dias; o fiscal do contrato aprova dois e reprova um em lote (com motivo); a medição vê as decisões sem
 * poder decidir; o fornecedor corrige o dia reprovado e ele volta a pendente. Também cadastra um fiscal
 * pelo Administrativo e envia o primeiro acesso.
 */

const ATO = { usuario: "P0909976", nome: "E2E Timesheet Fiscal ATO" };
const FISCAL = { usuario: "P0909977", nome: "E2E Fiscal Aprovador" };
const CONTRATO = "E2E Contrato Aprovacao Fiscal";
const NOVO_FISCAL = "E2E Fiscal Cadastrado";
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let dias: string[] = [];
let liberacaoAnterior: string | null = null;
let fornecedor: APIRequestContext;

async function limpar() {
  const p = await prisma.profissional.findUnique({ where: { codigo: ATO.usuario }, select: { id: true } });
  await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminUsuario: { in: [ATO.usuario, FISCAL.usuario] } }, { targetCodigo: ATO.usuario }] } });
  if (p) {
    await prisma.timesheetFolha.deleteMany({ where: { profissionalId: p.id } });
    await prisma.timesheetConfig.deleteMany({ where: { profissionalId: p.id } });
  }
  await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: ATO.usuario } });
  await prisma.profissional.deleteMany({ where: { codigo: ATO.usuario } });
  await prisma.contrato.deleteMany({ where: { nome: CONTRATO } });
  await prisma.usuario.deleteMany({ where: { OR: [{ usuario: { in: [ATO.usuario, FISCAL.usuario] } }, { nome: NOVO_FISCAL }] } });
}

async function entrar(page: Page, usuario: string, senha: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario, senha);
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

test.beforeAll(async ({ baseURL }) => {
  await assertConnectedToE2eDatabase();
  await limpar();
  const senhaHash = await hashPassword(SENHA);
  await prisma.usuario.create({ data: { usuario: ATO.usuario, nome: ATO.nome, perfil: "COLABORADOR", senhaHash, ativo: true } });
  const fiscal = await prisma.usuario.create({ data: { usuario: FISCAL.usuario, nome: FISCAL.nome, perfil: "FISCAL", senhaHash, ativo: true }, select: { id: true } });
  const contrato = await prisma.contrato.create({ data: { nome: CONTRATO, codigo: "5900777001", fiscalId: fiscal.id }, select: { id: true } });
  const p = await prisma.profissional.create({ data: { nome: ATO.usuario, codigo: ATO.usuario, nomeCompleto: ATO.nome, statusColaborador: "ATO" }, select: { id: true } });
  await prisma.timesheetConfig.create({ data: { profissionalId: p.id, contratoId: contrato.id } });
  await prisma.cadastroFornecedor.create({ data: { colaboradorCodigo: ATO.usuario, responsavel: ATO.nome, razaoSocial: `${ATO.nome} LTDA`, cnpjNormalizado: "11222333000181" } });

  fornecedor = await playwrightRequest.newContext({ baseURL });
  expect((await fornecedor.post("/api/auth/login", { data: { usuario: ATO.usuario, senha: SENHA } })).ok()).toBeTruthy();
  const folha = await (await fornecedor.get("/api/colaborador/timesheet")).json() as { ciclo: string; dias: Array<{ data: string; tipo: string }> };
  ciclo = folha.ciclo;
  dias = folha.dias.filter((d) => d.tipo === "UTIL").slice(0, 3).map((d) => d.data);
  liberacaoAnterior = (await prisma.timesheetCiclo.findUnique({ where: { ciclo } }))?.liberacao ?? null;
  await prisma.timesheetCiclo.upsert({ where: { ciclo }, create: { ciclo, liberacao: "CICLO" }, update: { liberacao: "CICLO" } });
  for (const data of dias) {
    const r = await fornecedor.put("/api/colaborador/timesheet/dia", { data: { ciclo, data, entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2: "17:00" } });
    expect(r.status()).toBe(200);
  }
});

test.afterAll(async () => {
  await fornecedor?.dispose();
  await limpar();
  if (liberacaoAnterior) await prisma.timesheetCiclo.update({ where: { ciclo }, data: { liberacao: liberacaoAnterior } });
  else await prisma.timesheetCiclo.deleteMany({ where: { ciclo } });
});

test.describe.serial("Aprovação das horas pelo fiscal", () => {
  test("fiscal aprova e reprova dias em lote; só vê o Timesheet dos contratos dele", async ({ page }) => {
    await entrar(page, FISCAL.usuario, SENHA);
    await expect(page.getByTestId("fiscal-timesheet")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Feriados" })).toHaveCount(0);
    await expect(page.getByLabel("Liberação do preenchimento")).toHaveCount(0);
    await expect(page.getByTestId("ciclo-publicado-timesheet")).toHaveCount(0);

    await page.getByTestId(`timesheet-linha-${ATO.usuario}`).click();
    const folha = page.getByTestId("fiscal-folha");
    await folha.getByLabel(`Selecionar ${dataBr(dias[0])}`).check();
    await folha.getByLabel(`Selecionar ${dataBr(dias[1])}`).check();
    await folha.getByRole("button", { name: "Aprovar" }).click();
    await expect(folha.getByTestId(`timesheet-aprovacao-${dias[0]}`)).toHaveText("Aprovado");
    await expect(folha.getByTestId(`timesheet-aprovacao-${dias[1]}`)).toHaveText("Aprovado");

    await folha.getByLabel(`Selecionar ${dataBr(dias[2])}`).check();
    await folha.getByRole("button", { name: "Reprovar" }).click();
    const dialogo = page.getByRole("dialog", { name: "Reprovar 1 dia" });
    await dialogo.getByLabel("Motivo da reprovação").fill("Horário diferente da portaria");
    await dialogo.getByRole("button", { name: "Reprovar" }).click();
    await expect(dialogo).toBeHidden();
    await expect(folha.getByTestId(`timesheet-aprovacao-${dias[2]}`)).toContainText("Reprovado");
    await expect(folha.getByTestId(`timesheet-aprovacao-${dias[2]}`)).toContainText("Horário diferente da portaria");
    // As 8 h do dia reprovado saem do total (3 dias de 8 h → 16 h).
    await expect(page.getByTestId("timesheet-total-total")).toHaveText("16:00");

    // O fiscal não usa as rotas da medição.
    expect((await page.request.get(`/api/admin/timesheet?ciclo=${ciclo}`)).status()).toBe(403);
  });

  test("medição vê as decisões, sem poder decidir; fornecedor corrige e o dia volta a pendente", async ({ page }) => {
    await entrar(page, e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=timesheet");
    const linha = page.getByTestId(`timesheet-linha-${ATO.usuario}`);
    await expect(linha.getByTestId(`timesheet-aprovacoes-${ATO.usuario}`)).toContainText("2 aprov.");
    await expect(linha.getByTestId(`timesheet-aprovacoes-${ATO.usuario}`)).toContainText("1 reprov.");
    await linha.click();
    const gaveta = page.getByTestId("timesheet-drawer");
    await expect(gaveta.getByTestId(`timesheet-aprovacao-${dias[2]}`)).toContainText("Reprovado");
    await expect(gaveta.getByRole("checkbox")).toHaveCount(0);
    await expect(gaveta.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
    expect((await page.request.post(`/api/fiscal/timesheet/x/decisao`, { data: {} })).status()).toBe(403);

    // As exportações levam a coluna "Aprovação" (PDF pela página de impressão; XLSX na coluna M).
    const { id: profissionalId } = await prisma.profissional.findUniqueOrThrow({ where: { codigo: ATO.usuario }, select: { id: true } });
    await page.goto(`/timesheet/imprimir/${profissionalId}?ciclo=${ciclo}`);
    await expect(page.getByTestId("timesheet-impressao").getByRole("columnheader", { name: "Aprovação" })).toBeVisible();
    await expect(page.getByTestId(`timesheet-impressao-aprovacao-${dias[0]}`)).toHaveText("Aprovado");
    await expect(page.getByTestId(`timesheet-impressao-aprovacao-${dias[2]}`)).toHaveText("Reprovado");
    await expect(page.getByTestId("timesheet-impressao-total")).toContainText("16:00");
    await expect(page.getByTestId("timesheet-impressao-motivos")).toContainText(`Reprovado em ${dataBr(dias[2]).slice(0, 5)}: Horário diferente da portaria`);
    const xlsx = await page.request.get(`/api/admin/timesheet/${profissionalId}/xlsx?ciclo=${ciclo}`);
    expect(xlsx.status()).toBe(200);
    const { readZipEntries } = await import("../lib/xlsx");
    const planilha = readZipEntries(Buffer.from(await xlsx.body())).get("xl/worksheets/sheet1.xml")!.toString("utf8");
    expect(planilha).toContain("APROVAÇÃO");
    expect(planilha).toContain("Reprovado: Horário diferente da portaria");

    const r = await fornecedor.put("/api/colaborador/timesheet/dia", { data: { ciclo, data: dias[2], entrada1: "08:00", saida1: "12:00", entrada2: "13:00", saida2: "16:00" } });
    expect(r.status()).toBe(200);
    const folha = await (await fornecedor.get("/api/colaborador/timesheet")).json() as { dias: Array<{ data: string; aprovacao: string | null }>; totais: { total: number } };
    expect(folha.dias.find((d) => d.data === dias[2])?.aprovacao).toBeNull();
    expect(folha.totais.total, "corrigido (7 h), o dia volta ao total").toBe((8 + 8 + 7) * 60);
    expect(folha.dias.find((d) => d.data === dias[0])?.aprovacao).toBe("APROVADO");
  });

  test("Administrativo cadastra um fiscal e envia o primeiro acesso", async ({ page }) => {
    await entrar(page, e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await page.getByRole("tab", { name: /Fiscais/ }).click();
    await page.getByRole("button", { name: "Novo fiscal" }).click();
    const painel = page.getByTestId("administrativo-fiscal-painel");
    await painel.getByLabel("Nome").fill(NOVO_FISCAL);
    await painel.getByLabel("E-mail").fill("fiscal.e2e@example.com");
    await painel.getByRole("button", { name: "Cadastrar fiscal" }).click();
    await expect(painel.getByText("1º acesso pendente")).toBeVisible();
    await expect(painel).toContainText(/P0\d{6}/);
    await painel.getByRole("button", { name: "Enviar primeiro acesso" }).click();
    await expect(painel.getByRole("status")).toContainText("Acesso enviado para fiscal.e2e@example.com");
    const criado = await prisma.usuario.findFirst({ where: { nome: NOVO_FISCAL }, select: { perfil: true, primeiroLogin: true } });
    expect(criado).toMatchObject({ perfil: "FISCAL", primeiroLogin: true });

    // Edição dos dados (docs/brain/specs/fiscal-cadastro-acesso.md); sem ADMIN, não há "Redefinir senha".
    await expect(painel.getByRole("button", { name: "Redefinir senha" })).toHaveCount(0);
    await painel.getByRole("button", { name: "Editar dados" }).click();
    await painel.getByLabel("Telefone").fill("31998765432");
    await painel.getByLabel("Empresa / órgão").fill("VALE");
    await painel.getByLabel("Matrícula").fill("M-4471");
    await painel.getByRole("button", { name: "Salvar" }).click();
    await expect(painel.getByRole("button", { name: "Editar dados" })).toBeVisible();
    await expect(painel).toContainText("(31) 99876-5432");
    await expect(painel).toContainText("VALE");
    await expect(painel).toContainText("M-4471");
  });

  test("ADMIN redefine a senha do fiscal pela seção Acesso ao portal", async ({ page }) => {
    await entrar(page, e2eUsers.admin.usuario, e2eUsers.admin.senha);
    await page.goto("/?section=administrativo");
    await page.getByRole("tab", { name: /Fiscais/ }).click();
    await page.getByLabel(`Abrir fiscal ${FISCAL.nome}`).click();
    const painel = page.getByTestId("administrativo-fiscal-painel");
    await expect(painel).toContainText("Definida pelo usuário");
    await painel.getByRole("button", { name: "Redefinir senha" }).click();
    const resposta = page.waitForResponse((r) => r.url().includes("/api/admin/usuarios/") && r.request().method() === "PATCH");
    await page.getByRole("dialog", { name: "Redefinir senha" }).getByRole("button", { name: "Redefinir senha" }).click();
    const { senhaTemporaria } = await (await resposta).json() as { senhaTemporaria: string };
    const modal = page.getByTestId("credencial-modal");
    await expect(modal.getByRole("heading", { name: "Senha redefinida com sucesso" })).toBeVisible();
    await modal.getByRole("button", { name: "Concluir" }).click();
    await expect(painel).toContainText("Primeiro acesso pendente");
    await expect(painel.getByRole("button", { name: "Enviar primeiro acesso" })).toBeVisible();

    const ctx = await playwrightRequest.newContext({ baseURL: new URL(page.url()).origin });
    expect((await ctx.post("/api/auth/login", { data: { usuario: FISCAL.usuario, senha: senhaTemporaria } })).ok()).toBeTruthy();
    expect((await ctx.post("/api/auth/login", { data: { usuario: FISCAL.usuario, senha: SENHA } })).ok()).toBeFalsy();
    await ctx.dispose();
  });
});
