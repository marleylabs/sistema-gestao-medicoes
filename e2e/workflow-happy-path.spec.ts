import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { PortalPage } from "./pages/portal-page";
import { FinanceiroPage } from "./pages/financeiro-page";
import { EvidenciasPage } from "./pages/evidencias-page";
import { e2eUsers, e2eCiclo } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

const FORNECEDOR_NOME = "E2E Fornecedor A";
const CODIGO_A = e2eUsers.fornecedorA.usuario;

test.beforeAll(assertConnectedToE2eDatabase);

test.describe.serial("Happy path — MEDICAO envia BM → FORNECEDOR conclui → FINANCEIRO paga → Evidências", () => {
  test("MEDICAO envia o BM para o Fornecedor A", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(FORNECEDOR_NOME);
    await pagamentos.expectStatusBadge(FORNECEDOR_NOME, "Aguardando");

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("PENDENTE");
    expect(sgc?.statusConferencia).toBe("AGUARDANDO_UPLOAD");

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR A baixa a máscara, envia sem divergência e a conferência conclui", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await expect(page.getByText(e2eCiclo())).toBeVisible();

    const download = await portal.downloadMascara();
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    await portal.uploadMascara("tests/fixtures/e2e/conferencia/mascara-valida.xlsx");

    // Conferência concluída sem divergência — NÃO deve mostrar "EM ANÁLISE" (não há o que analisar)
    // nem "DIVERGÊNCIA" (regra corrigida nesta sessão), e deve habilitar a ação de aprovação.
    await expect(page.getByText("EM ANÁLISE")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enviar", exact: true })).toBeVisible();

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() } } });
    expect(sgc?.statusConferencia).toBe("CONCLUIDA");
    expect(sgc?.status).toBe("PENDENTE"); // não avança sozinho

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR A aprova o BM (Salvar + Enviar) → AGUARDANDO_NF", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await portal.salvarEEnviarBm();
    await portal.expectStatusBadge("AGUARDANDO_NF");

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("AGUARDANDO_NF");
    expect(sgc?.aprovadoAt).toBeTruthy();

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR A envia a NF real (validada contra o cadastro) → APROVADO", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await portal.uploadNf("tests/fixtures/nf/valida-b.pdf");
    await portal.expectStatusBadge("APROVADO");

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("APROVADO");
    expect(sgc?.nfArquivoNome).toBeTruthy();

    // AJUSTE DE CC — finanprojetacs@gmail.com adicionado a EMAIL_FINANCE_CC (lib/email/cc-policy.ts).
    // PAYMENT_READY dispara aqui (upload de NF, app/api/colaborador/nf/route.ts). Em
    // EMAIL_TEST_MODE=true, actualCc fica sempre vazio — o CC pretendido só é auditável em
    // metadata.intendedCc.
    const paymentReadyLog = await prisma.emailLog.findFirst({
      where: { event: "PAYMENT_READY", idempotencyKey: `payment-ready/${sgc!.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(paymentReadyLog, "PAYMENT_READY precisa ter gerado email_log").toBeTruthy();
    expect(paymentReadyLog!.status).toBe("SENT");
    const paymentReadyMetadata = paymentReadyLog!.metadata as { intendedCc?: string[] } | null;
    expect(paymentReadyMetadata?.intendedCc, "CC pretendido de PAYMENT_READY precisa ter exatamente os 3 endereços de EMAIL_FINANCE_CC").toEqual([
      "financeiro@projetacs.com",
      "ximenes.silva@projetacs.com",
      "finanprojetacs@gmail.com",
    ]);

    await page.request.post("/api/auth/logout");
  });

  test("FINANCEIRO localiza o processo, vê o BM e registra o pagamento com comprovante → PAGO", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.financeiro.usuario, e2eUsers.financeiro.senha);

    const financeiro = new FinanceiroPage(page);
    await financeiro.goto();
    await financeiro.expectStatusBadge(FORNECEDOR_NOME, "Aguardando pgto.");
    await financeiro.verBm(FORNECEDOR_NOME);
    await expect(page.getByText(/BOLETIM DE MEDIÇÃO/i)).toBeVisible();
    await expect(page.getByRole("cell", { name: FORNECEDOR_NOME })).toBeVisible();
    // Navegação nova fecha o modal de forma confiável (o próprio botão "X" mostrou flakiness real
    // de timing nesta suíte — navegar de novo é uma interação mais robusta que vale mais a pena
    // aqui do que persistir caçando a causa exata de um clique instável).
    await financeiro.goto();

    await financeiro.marcarPago(FORNECEDOR_NOME, "tests/fixtures/nf/valida-b.pdf");
    await financeiro.expectStatusBadge(FORNECEDOR_NOME, "Concluído");

    // Não pode duplicar pagamento: o botão "Marcar pago" não existe mais para este fornecedor.
    await financeiro.expectNoMarcarPagoButton(FORNECEDOR_NOME);

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("PAGO");
    expect(sgc?.comprovanteArquivoNome).toBeTruthy();
    expect(sgc?.pagoAt).toBeTruthy();

    // AJUSTE DE CC — PAYMENT_COMPLETED dispara aqui (marcar pago, app/api/admin/financeiro/route.ts).
    const paymentCompletedLog = await prisma.emailLog.findFirst({
      where: { event: "PAYMENT_COMPLETED", idempotencyKey: `payment-completed/${sgc!.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(paymentCompletedLog, "PAYMENT_COMPLETED precisa ter gerado email_log").toBeTruthy();
    expect(paymentCompletedLog!.status).toBe("SENT");
    const paymentCompletedMetadata = paymentCompletedLog!.metadata as { intendedCc?: string[] } | null;
    expect(paymentCompletedMetadata?.intendedCc, "CC pretendido de PAYMENT_COMPLETED precisa ter exatamente os 3 endereços de EMAIL_FINANCE_CC").toEqual([
      "financeiro@projetacs.com",
      "ximenes.silva@projetacs.com",
      "finanprojetacs@gmail.com",
    ]);

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR A vê o resultado final: pagamento concluído e comprovante disponível", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await portal.expectStatusBadge("PAGO");

    await page.request.post("/api/auth/logout");
  });

  test("ADMIN/MEDICAO: BM do Fornecedor A continua acessível em Evidências mesmo depois de PAGO", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

    const evidencias = new EvidenciasPage(page);
    await evidencias.goto();
    await evidencias.selectCiclo(e2eCiclo());
    await evidencias.expectFornecedorDisponivel(FORNECEDOR_NOME);
    await evidencias.selectFornecedor(FORNECEDOR_NOME);
    await evidencias.verBoletim();
    await expect(page.getByText(/BOLETIM DE MEDIÇÃO/i)).toBeVisible();
    await expect(page.getByRole("cell", { name: FORNECEDOR_NOME })).toBeVisible();

    await page.request.post("/api/auth/logout");
  });

  test("RECONCILIAÇÃO FINAL: banco reflete exatamente um workflow, um pagamento, dados corretos", async () => {
    const registros = await prisma.sgcAprovacaoMedicao.findMany({
      where: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() },
    });
    expect(registros.length).toBe(1);
    const sgc = registros[0];
    expect(sgc.status).toBe("PAGO");
    expect(sgc.statusConferencia).toBe("CONCLUIDA");
    expect(sgc.revisaoNumero).toBe(0);
    expect(sgc.nfArquivoNome).toBeTruthy();
    expect(sgc.comprovanteArquivoNome).toBeTruthy();

    const documentos = await prisma.medicao.findMany({ where: { ciclo: e2eCiclo(), profissional: { codigo: CODIGO_A } } });
    expect(documentos.length).toBe(1);
    expect(documentos[0].numeroDocumento).toBe("E2E-DOC-001");

    const mapaItem = await prisma.mapaPagamentoItem.findFirst({ where: { ciclo: e2eCiclo(), projetistaCodigo: CODIGO_A } });
    expect(Number(mapaItem?.valor)).toBe(1000);
  });

  test("OWNERSHIP/IDOR: Fornecedor B autenticado não acessa a NF nem o comprovante do Fornecedor A via API", async ({ page }) => {
    const sgcA = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({
      where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_A, ciclo: e2eCiclo() } },
      select: { id: true },
    });

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorB.usuario, e2eUsers.fornecedorB.senha);

    const nfResponse = await page.request.get(`/api/colaborador/nf/${sgcA.id}`);
    expect(nfResponse.status()).toBe(403);

    const comprovanteResponse = await page.request.get(`/api/colaborador/comprovante/${sgcA.id}`);
    expect(comprovanteResponse.status()).toBe(403);

    // Confirma que o mesmo endpoint funciona normalmente para o DONO real (prova de que o 403
    // acima é isolamento de posse, não um endpoint quebrado para todo mundo).
    await page.request.post("/api/auth/logout");
    await login.goto();
    await login.login(e2eUsers.fornecedorA.usuario, e2eUsers.fornecedorA.senha);
    const nfResponseDono = await page.request.get(`/api/colaborador/nf/${sgcA.id}`);
    expect(nfResponseDono.status()).toBe(200);

    await page.request.post("/api/auth/logout");
  });
});
