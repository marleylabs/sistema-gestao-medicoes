import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { PortalPage } from "./pages/portal-page";
import { e2eUsers, e2eCiclo } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

const FORNECEDOR_NOME = "E2E Fornecedor B";
const CODIGO_B = e2eUsers.fornecedorB.usuario;

test.beforeAll(assertConnectedToE2eDatabase);

test.describe.serial("Divergência — upload divergente → EM ANÁLISE (fornecedor) / DIVERGÊNCIA (Equipe) → tratamento → aprovação", () => {
  test("MEDICAO envia o BM para o Fornecedor B", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(FORNECEDOR_NOME);
    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR B envia máscara divergente → statusConferencia=DIVERGENCIA no banco, Portal mostra 'EM ANÁLISE', nunca 'DIVERGÊNCIA'", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorB.usuario, e2eUsers.fornecedorB.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await portal.uploadMascara("tests/fixtures/e2e/conferencia/mascara-divergente.xlsx");
    await portal.expectEmAnalise();

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_B, ciclo: e2eCiclo() } } });
    expect(sgc?.statusConferencia).toBe("DIVERGENCIA");
    expect(sgc?.status).toBe("PENDENTE");

    await page.request.post("/api/auth/logout");
  });

  test("MEDICAO vê DIVERGÊNCIA e os itens reais para tratamento", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.expectStatusBadge(FORNECEDOR_NOME, "Divergência");
    await pagamentos.abrirEditarPagamento(FORNECEDOR_NOME);

    await expect(page.getByText("2 divergências encontradas")).toBeVisible();
    await expect(page.getByText("E2E-DOC-002", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E-DOC-EXTRA", { exact: true })).toBeVisible();
    await expect(page.getByText("Não mapeado pela Equipe")).toBeVisible();

    const divergencias = await prisma.divergenciaMedicao.findMany({ where: { colaboradorCodigo: CODIGO_B, ciclo: e2eCiclo() } });
    expect(divergencias.length).toBe(2);

    await page.request.post("/api/auth/logout");
  });

  test("MEDICAO: Descartar sem observação é bloqueado; com observação, é aceito e persistido", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.abrirEditarPagamento(FORNECEDOR_NOME);

    await pagamentos.expectDescartarDesabilitado("E2E-DOC-EXTRA");
    await pagamentos.descartarDivergencia("E2E-DOC-EXTRA", "Documento não pertence ao escopo do ciclo.");
    await expect(page.getByText("Descartada")).toBeVisible();

    const divergencia = await prisma.divergenciaMedicao.findFirst({ where: { colaboradorCodigo: CODIGO_B, nrVale: "E2E-DOC-EXTRA" } });
    expect(divergencia?.status).toBe("DESCARTADA");
    expect(divergencia?.observacao).toBe("Documento não pertence ao escopo do ciclo.");

    const documentoIncluido = await prisma.medicao.findFirst({ where: { ciclo: e2eCiclo(), numeroDocumento: "E2E-DOC-EXTRA" } });
    expect(documentoIncluido).toBeNull();

    await page.request.post("/api/auth/logout");
  });

  test("MEDICAO: Incluir integra o documento a Documentos Medidos e resolve a divergência", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.abrirEditarPagamento(FORNECEDOR_NOME);
    await pagamentos.incluirDivergencia("E2E-DOC-002");
    await expect(pagamentos["divergenciaCard"]("E2E-DOC-002")).toContainText("Incluída");

    const divergencia = await prisma.divergenciaMedicao.findFirst({ where: { colaboradorCodigo: CODIGO_B, nrVale: "E2E-DOC-002" } });
    expect(divergencia?.status).toBe("INCLUIDA");

    // Todas as divergências resolvidas → conferência volta a CONCLUIDA, mas status continua PENDENTE
    // (não avança sozinho — só quando o fornecedor executar ENVIAR).
    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_B, ciclo: e2eCiclo() } } });
    expect(sgc?.statusConferencia).toBe("CONCLUIDA");
    expect(sgc?.status).toBe("PENDENTE");

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR B: Portal sai de 'EM ANÁLISE' e permite aprovar → AGUARDANDO_NF", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorB.usuario, e2eUsers.fornecedorB.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await expect(page.getByText("EM ANÁLISE")).toHaveCount(0);

    // BUG 1: o documento descartado (com motivo real) precisa aparecer para o fornecedor, ANTES de
    // "Documentos da Medição do Ciclo" — nunca usando a palavra "Divergência".
    await expect(page.getByText("Documentos não considerados")).toBeVisible();
    await expect(page.getByText("E2E-DOC-EXTRA", { exact: true })).toBeVisible();
    await expect(page.getByText("Documento não pertence ao escopo do ciclo.")).toBeVisible();
    await expect(page.getByText(/DIVERGÊNCIA/)).toHaveCount(0);
    // O documento incluído (E2E-DOC-002) não é um "descarte" — não pode aparecer nesta seção.
    await expect(page.getByText("E2E-DOC-002", { exact: true })).toHaveCount(0);

    await portal.salvarEEnviarBm();
    await portal.expectStatusBadge("AGUARDANDO_NF");

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_B, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("AGUARDANDO_NF");
    expect(sgc?.statusConferencia).toBe("CONCLUIDA");

    await page.request.post("/api/auth/logout");
  });
});
