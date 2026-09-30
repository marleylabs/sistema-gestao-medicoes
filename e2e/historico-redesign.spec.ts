import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Histórico (redesign) — consulta com três perspectivas sobre os mesmos dados.
 * Fixtures (ciclos isolados abaixo do seed): F1 2511 = 1.500 (100% contrato A); F1 2512 = 2.000
 * (50% A / 50% B, PAGO); F2 2511 = 800 (100% B). Valor por contrato pela regra do Dashboard:
 * A = 1.500 + 1.000 = 2.500; B = 800 + 1.000 = 1.800.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 5).toUpperCase();
const C1 = "2511";
const C2 = "2512";
const F1 = `HIST F1 ${S}`;
const F2 = `HIST F2 ${S}`;
const CTR_A = `CTR HIST A ${S}`;
const CTR_B = `CTR HIST B ${S}`;
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

async function abrir(page: Page, usuario: { usuario: string; senha: string }) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario.usuario, usuario.senha);
  await page.goto("/?section=historico");
  await expect(page.getByRole("heading", { name: "Histórico", exact: true, level: 1 }).last()).toBeVisible();
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

const tabela = (page: Page, id: string) => page.getByTestId(id).locator("tbody tr");

test.describe.serial("Histórico — redesign (Medições, Fornecedores, Contratos)", () => {
  test.beforeAll(async () => {
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [C1, C2] } } });
    for (const ciclo of [C1, C2]) await prisma.mapaPagamentoContexto.create({ data: { ciclo, mesReferencia: `E2E Histórico ${ciclo}`, atoCiclo: ciclo } });
    const pA = await prisma.projeto.create({ data: { codigoProjeto: `PRJ-A-${S}`, contrato: CTR_A } });
    const pB = await prisma.projeto.create({ data: { codigoProjeto: `PRJ-B-${S}`, contrato: CTR_B } });
    const f1 = await prisma.profissional.create({ data: { nome: F1, codigo: F1, nomeCompleto: F1, razaoSocial: `${F1} LTDA` } });
    const f2 = await prisma.profissional.create({ data: { nome: F2, codigo: F2, nomeCompleto: F2, razaoSocial: `${F2} LTDA` } });
    const doc = (idProfissional: string, idProjeto: string, ciclo: string, n: string) =>
      prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto, idProfissional, ciclo, numeroDocumento: `${n}-${S}`, tipo2: "DG", condicao: "100", equivalenteA1Horas: 5, percentualEmissao: 1, sourceRowHash: `e2e-hist-${S}-${n}` } });
    await doc(f1.id, pA.id, C1, "F1C1A");
    await doc(f2.id, pB.id, C1, "F2C1B");
    await doc(f1.id, pA.id, C2, "F1C2A");
    await doc(f1.id, pB.id, C2, "F1C2B");
    const item = (codigo: string, ciclo: string, valor: number) =>
      prisma.mapaPagamentoItem.create({ data: { ciclo, ordem: 1, projetistaCodigo: codigo, responsavel: codigo, razaoSocial: `${codigo} LTDA`, valor, sourceRowHash: `e2e-hist-${S}-${codigo}-${ciclo}` } });
    await item(F1, C1, 1500);
    await item(F2, C1, 800);
    await item(F1, C2, 2000);
    const agora = new Date();
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: F1, colaboradorNome: F1, ciclo: C1, status: "APROVADO", aprovadoAt: agora, nfArquivo: Buffer.from("nf"), nfArquivoNome: "nf.pdf", nfCarregadoAt: agora } });
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: F2, colaboradorNome: F2, ciclo: C1, status: "AGUARDANDO_NF", aprovadoAt: agora } });
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: F1, colaboradorNome: F1, ciclo: C2, status: "PAGO", aprovadoAt: agora, nfArquivo: Buffer.from("nf"), nfArquivoNome: "nf.pdf", nfCarregadoAt: agora, pagoAt: agora } });
  });

  test.afterAll(async () => {
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { in: [F1, F2] } } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { sourceRowHash: { startsWith: `e2e-hist-${S}` } } });
    await prisma.medicao.deleteMany({ where: { sourceRowHash: { startsWith: `e2e-hist-${S}` } } });
    await prisma.profissional.deleteMany({ where: { codigo: { in: [F1, F2] } } });
    await prisma.projeto.deleteMany({ where: { codigoProjeto: { in: [`PRJ-A-${S}`, `PRJ-B-${S}`] } } });
    await prisma.contrato.deleteMany({ where: { nome: { in: [CTR_A, CTR_B] } } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [C1, C2] } } });
  });

  test("MEDIÇÕES (padrão): busca, ciclo e status filtram; total segue a lista", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await expect(page.getByRole("tab", { name: "Medições" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(S);
    await expect(tabela(page, "historico-medicoes")).toHaveCount(3);
    await expect(page.getByTestId("historico-total")).toHaveText(brl(4300));
    await page.getByRole("combobox", { name: "Ciclo" }).selectOption(C1);
    await expect(tabela(page, "historico-medicoes")).toHaveCount(2);
    await page.getByRole("combobox", { name: "Ciclo" }).selectOption("");
    await page.getByRole("button", { name: /Filtros/ }).click();
    await page.getByRole("combobox", { name: "Status" }).selectOption("Pago");
    await page.getByRole("button", { name: "Concluído" }).click();
    await expect(tabela(page, "historico-medicoes")).toHaveCount(1);
    await expect(tabela(page, "historico-medicoes").first()).toContainText(C2);
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("DETALHE DA MEDIÇÃO: valor, contratos com participação, composição do BM, NF/pagamento e linha do tempo reais", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(F1);
    await page.getByRole("row", { name: `Abrir medição de ${F1} no ciclo ${C2}` }).click();
    const d = page.getByTestId("historico-detalhe-medicao");
    await expect(d.getByRole("heading", { name: F1, level: 2 })).toBeVisible();
    await expect(d).toContainText(brl(2000));
    await expect(d).toContainText(CTR_A);
    await expect(d).toContainText(CTR_B);
    await expect(d.getByTestId("historico-composicao")).toContainText("Documentos medidos");
    await expect(d.getByRole("link", { name: "Abrir NF" })).toBeVisible();
    await expect(d.getByTestId("historico-linha-do-tempo")).not.toContainText("Pagamento registradoSem registro");
    await d.getByRole("button", { name: "Ver BM" }).click();
    await expect(page.getByText("Boletim de Medição", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Fechar boletim" }).click();
    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDORES: trajetória (total, ciclos, contratos, última) e detalhe por ciclo com Voltar", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("tab", { name: "Fornecedores" }).click();
    await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(F1);
    const linha = page.getByRole("row", { name: `Abrir histórico de ${F1}` });
    await expect(linha).toContainText(brl(3500));
    await expect(linha).toContainText(C2);
    await linha.click();
    const d = page.getByTestId("historico-detalhe-fornecedor");
    await expect(d).toContainText(brl(3500));
    await expect(d.getByTestId("historico-fornecedor-ciclos").getByRole("button")).toHaveCount(2);
    await d.getByRole("button", { name: `Abrir medição de ${F1} no ciclo ${C1}` }).click();
    const m = page.getByTestId("historico-detalhe-medicao");
    await expect(m).toContainText(brl(1500));
    await m.getByRole("button", { name: "Voltar" }).click();
    await expect(page.getByTestId("historico-detalhe-fornecedor")).toBeVisible();
    await page.request.post("/api/auth/logout");
  });

  test("CONTRATOS: valor atribuído pela regra do Dashboard; detalhe com fornecedores e medições", async ({ page }) => {
    await abrir(page, e2eUsers.admin);
    await page.getByRole("tab", { name: "Contratos" }).click();
    await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(S);
    const a = page.getByRole("row", { name: `Abrir contrato ${CTR_A}` });
    const b = page.getByRole("row", { name: `Abrir contrato ${CTR_B}` });
    await expect(a).toContainText(brl(2500));
    await expect(b).toContainText(brl(1800));
    await b.click();
    const d = page.getByTestId("historico-detalhe-contrato");
    await expect(d).toContainText("Somente consulta");
    await expect(d.getByTestId("historico-contrato-medicoes").getByRole("button")).toHaveCount(2);
    await expect(d).toContainText(F1);
    await expect(d).toContainText(F2);
    await expect(d.getByRole("button", { name: /Editar|Salvar/ })).toHaveCount(0);
    await page.request.post("/api/auth/logout");
  });

  test("MOBILE 375: lista compacta; toque abre detalhe em tela cheia; sem overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrir(page, e2eUsers.admin);
    await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(F2);
    const item = page.getByTestId("historico-medicoes-mobile").getByRole("button", { name: new RegExp(F2) });
    await expect(item).toContainText(brl(800));
    await semOverflow(page);
    await item.click();
    const d = page.getByTestId("historico-detalhe-medicao");
    await expect(d.getByRole("heading", { name: F2, level: 2 })).toBeVisible();
    expect((await d.locator("aside").boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(370);
    await semOverflow(page);
    await page.request.post("/api/auth/logout");
  });

  test("SOMENTE CONSULTA: uma chamada GET /api/historico (com ciclo em cada registro), sem mapa por ciclo e sem ações de ciclo", async ({ page }) => {
    const chamadas: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) { const u = new URL(r.url()); chamadas.push(`${r.method()} ${u.pathname}${u.search}`); } });
    await abrir(page, e2eUsers.admin);
    await expect(tabela(page, "historico-medicoes").first()).toBeVisible();
    expect(chamadas.filter((c) => c === "GET /api/historico")).toHaveLength(1);
    // O shell do app continua carregando o mapa do ciclo ativo (Dashboard/Fornecedores); o Histórico não
    // faz mais uma requisição de mapa por ciclo histórico.
    expect(chamadas.filter((c) => c.includes("/api/mapa-pagamento") && (c.includes(`ciclo=${C1}`) || c.includes(`ciclo=${C2}`))), "nenhuma requisição de mapa por ciclo").toEqual([]);
    expect(chamadas.filter((c) => c === "GET /api/sgc/status"), "status SGC de todos os ciclos vem na resposta do histórico").toEqual([]);
    for (const nome of ["Gerenciar ciclos", "Novo ciclo", "Excluir ciclo", "Abrir ciclo", "Publicar ciclo", "Ativar medição"]) {
      await expect(page.getByRole("button", { name: nome })).toHaveCount(0);
    }
    const payload = await (await page.request.get("/api/historico")).json() as { registros: { ciclo: string; codigo: string; valor: number; sgc: { status: string } | null }[]; total: number };
    const meus = payload.registros.filter((r) => r.codigo === F1 || r.codigo === F2);
    expect(meus.map((r) => `${r.ciclo}|${r.codigo}|${r.valor}|${r.sgc?.status}`).sort()).toEqual([
      `${C1}|${F1}|1500|APROVADO`, `${C1}|${F2}|800|AGUARDANDO_NF`, `${C2}|${F1}|2000|PAGO`,
    ]);
    expect(payload.total).toBe(payload.registros.length);
    const filtrado = await (await page.request.get(`/api/historico?ciclo=${C2}`)).json() as { registros: { ciclo: string }[] };
    expect(new Set(filtrado.registros.map((r) => r.ciclo))).toEqual(new Set([C2]));
    await page.request.post("/api/auth/logout");
  });

  test("PERMISSÕES: HISTORICO_MEDICOES dá leitura completa a FINANCEIRO/ADMINISTRATIVO/MEDICAO; sem permissão = 403 e sem acesso", async ({ page }) => {
    const admin = await prisma.usuario.findUniqueOrThrow({ where: { usuario: e2eUsers.admin.usuario } });
    const conceder = async (usuario: string) => {
      const u = await prisma.usuario.findUniqueOrThrow({ where: { usuario } });
      const existia = await prisma.usuarioPermissao.findUnique({ where: { usuarioId_permissao: { usuarioId: u.id, permissao: "HISTORICO_MEDICOES" } } });
      if (!existia) await prisma.usuarioPermissao.create({ data: { usuarioId: u.id, permissao: "HISTORICO_MEDICOES", createdById: admin.id } });
      return async () => { if (!existia) await prisma.usuarioPermissao.deleteMany({ where: { usuarioId: u.id, permissao: "HISTORICO_MEDICOES" } }); };
    };
    const semPermissao = async (usuario: string) => {
      const u = await prisma.usuario.findUniqueOrThrow({ where: { usuario } });
      await prisma.usuarioPermissao.deleteMany({ where: { usuarioId: u.id, permissao: "HISTORICO_MEDICOES" } });
    };

    // Sem autenticação: 401.
    expect((await page.request.get("/api/historico")).status()).toBe(401);

    // ADMIN: 200 (já coberto na tela pelos testes acima).
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
    expect((await page.request.get("/api/historico")).status()).toBe(200);
    await page.request.post("/api/auth/logout");

    // FINANCEIRO e ADMINISTRATIVO sem a permissão: API 403 e sem a seção Histórico.
    for (const u of [e2eUsers.financeiro, e2eUsers.administrativo]) {
      await semPermissao(u.usuario);
      await loginPage.goto();
      await loginPage.login(u.usuario, u.senha);
      expect((await page.request.get("/api/historico")).status(), `${u.usuario} sem permissão`).toBe(403);
      await page.goto("/?section=historico");
      await expect(page.getByRole("heading", { name: "Histórico", exact: true, level: 1 })).toHaveCount(0);
      await page.request.post("/api/auth/logout");
    }

    // Com HISTORICO_MEDICOES: dados completos, somente leitura (sem nenhuma ação de ciclo/medição).
    for (const u of [e2eUsers.financeiro, e2eUsers.administrativo, e2eUsers.medicao]) {
      const revogar = await conceder(u.usuario);
      try {
        await abrir(page, u);
        expect((await page.request.get("/api/historico")).status(), `${u.usuario} com permissão`).toBe(200);
        await page.getByRole("textbox", { name: "Buscar no histórico" }).fill(S);
        await expect(tabela(page, "historico-medicoes")).toHaveCount(3);
        await expect(page.getByTestId("historico-total")).toHaveText(brl(4300));
        await page.getByRole("row", { name: `Abrir medição de ${F1} no ciclo ${C2}` }).click();
        await expect(page.getByTestId("historico-composicao")).toContainText("Documentos medidos");
        await page.keyboard.press("Escape");
        await page.getByRole("tab", { name: "Contratos" }).click();
        await expect(page.getByRole("row", { name: `Abrir contrato ${CTR_A}` })).toContainText(brl(2500));
        for (const nome of ["Gerenciar ciclos", "Novo ciclo", "Excluir ciclo", "Publicar ciclo"]) {
          await expect(page.getByRole("button", { name: nome })).toHaveCount(0);
        }
        if (u !== e2eUsers.medicao) {
          // A leitura histórica não amplia nada: ações de ciclo e APIs de operação continuam 403.
          expect((await page.request.post("/api/ciclos", { data: { ciclo: "2509" } })).status()).toBe(403);
          expect((await page.request.patch("/api/ciclos", { data: { action: "set_ativo_medicao", ciclo: C1 } })).status()).toBe(403);
          expect((await page.request.delete("/api/ciclos", { data: { confirmacao: "RESETAR_CICLOS", ciclo: C1 } })).status()).toBe(403);
          expect((await page.request.get(`/api/mapa-pagamento?ciclo=${C1}`)).status()).toBe(403);
          await page.goto("/fornecedores");
          await expect(page.getByTestId("ciclo-publicado")).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Gerenciar ciclos" })).toHaveCount(0);
        }
        await page.request.post("/api/auth/logout");
      } finally {
        await revogar();
      }
    }
  });
});
