import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { PortalPage } from "./pages/portal-page";
import { EvidenciasPage } from "./pages/evidencias-page";
import { e2eUsers, e2eCiclo } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

const FORNECEDOR_NOME = "E2E Fornecedor C";
const CODIGO_C = e2eUsers.fornecedorC.usuario;
const MOTIVO = "O valor medido não corresponde ao volume real de horas executadas neste ciclo.";

test.beforeAll(assertConnectedToE2eDatabase);

test.describe.serial("Revisão — Solicitar revisão → motivo persistido → reenvio pela Equipe → nova rodada → aprovação", () => {
  test("MEDICAO envia o BM para o Fornecedor C", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(FORNECEDOR_NOME);
    await pagamentos.expectStatusBadge(FORNECEDOR_NOME, "Aguardando");

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_C, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("PENDENTE");

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR C conclui a conferência (sem divergência) e solicita revisão com motivo", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorC.usuario, e2eUsers.fornecedorC.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await portal.uploadMascara("tests/fixtures/e2e/conferencia/mascara-valida.xlsx");
    await expect(page.getByText("EM ANÁLISE")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Solicitar revisão" })).toBeVisible();

    await portal.solicitarRevisao(MOTIVO);
    await expect(page.getByText("Solicitação enviada.")).toBeVisible();

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_C, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("REVISAO_SOLICITADA");
    expect(sgc?.pontosDiscordancia).toBe(MOTIVO);
    expect(sgc?.revisaoNumero).toBe(0);

    await page.request.post("/api/auth/logout");
  });

  test("MEDICAO reenvia o BM revisado → status volta a PENDENTE, revisaoNumero incrementa, pontosDiscordancia é limpo", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();

    // "Reenviar BM" só habilita depois que o item do fornecedor for salvo após a solicitação de
    // revisão (regra real: item.updatedAt precisa ser posterior a revisaoSolicitadaAt) — abre o
    // modal e salva (o PUT sempre marca updatedAt, independente de mudança de valor).
    await pagamentos.abrirEditarPagamento(FORNECEDOR_NOME);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Divergências da Medição")).toHaveCount(0);

    await pagamentos.enviarBm(FORNECEDOR_NOME);

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_C, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("PENDENTE");
    expect(sgc?.revisaoNumero).toBe(1);
    expect(sgc?.pontosDiscordancia).toBeNull();
    expect(sgc?.statusConferencia).toBe("AGUARDANDO_UPLOAD");

    const divergenciasResiduais = await prisma.divergenciaMedicao.count({ where: { sgcId: sgc!.id } });
    expect(divergenciasResiduais).toBe(0);

    // AUDITORIA — Solicitar Revisão é um fluxo DIFERENTE de "Retornar BM" (e2e/bm-retornar-reenvio.spec.ts):
    // aqui revisaoNumero INCREMENTA (1) e a chave de idempotência do BM_AVAILABLE reflete isso
    // (`bm-available/{sgcId}/1`, SEM sufixo "-retorno-", que só existe no caminho de Retornar BM).
    const chaveRevisao = `bm-available/${sgc!.id}/1`;
    const logRevisao = await prisma.emailLog.findFirst({ where: { event: "BM_AVAILABLE", idempotencyKey: chaveRevisao }, orderBy: { createdAt: "desc" } });
    expect(logRevisao, "reenvio pós-revisão precisa gerar um email_log SENT com revisaoNumero=1 na chave").toBeTruthy();
    expect(logRevisao!.status).toBe("SENT");
    expect(logRevisao!.idempotencyKey).not.toContain("-retorno-");
    const logPrimeiroEnvio = await prisma.emailLog.findFirst({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgc!.id}/0` }, orderBy: { createdAt: "desc" } });
    expect(logPrimeiroEnvio!.providerMessageId).not.toBe(logRevisao!.providerMessageId);

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR C: nova rodada de conferência limpa, sem contaminação da rodada anterior", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorC.usuario, e2eUsers.fornecedorC.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    // Estado limpo: nem "EM ANÁLISE" nem a mensagem de revisão anterior — é uma nova rodada.
    await expect(page.getByText("EM ANÁLISE")).toHaveCount(0);
    await expect(page.getByText("Solicitação enviada.")).toHaveCount(0);

    await portal.uploadMascara("tests/fixtures/e2e/conferencia/mascara-valida.xlsx");
    await expect(page.getByText("EM ANÁLISE")).toHaveCount(0);

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_C, ciclo: e2eCiclo() } } });
    expect(sgc?.statusConferencia).toBe("CONCLUIDA");

    await page.request.post("/api/auth/logout");
  });

  test("FORNECEDOR C aprova na segunda rodada → AGUARDANDO_NF", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.fornecedorC.usuario, e2eUsers.fornecedorC.senha);

    const portal = new PortalPage(page);
    await portal.goto();
    await portal.salvarEEnviarBm();
    await portal.expectStatusBadge("AGUARDANDO_NF");

    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: CODIGO_C, ciclo: e2eCiclo() } } });
    expect(sgc?.status).toBe("AGUARDANDO_NF");
    expect(sgc?.revisaoNumero).toBe(1);

    await page.request.post("/api/auth/logout");
  });

  test("ADMIN: Evidências lista o Fornecedor C exatamente uma vez, sem duplicar por causa da revisão", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

    const evidencias = new EvidenciasPage(page);
    await evidencias.goto();
    await evidencias.selectCiclo(e2eCiclo());
    await evidencias.expectFornecedorDisponivel(FORNECEDOR_NOME);

    await page.request.post("/api/auth/logout");
  });

  test("RECONCILIAÇÃO FINAL: banco reflete exatamente uma rodada de revisão, sem registros órfãos", async () => {
    const registros = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: CODIGO_C, ciclo: e2eCiclo() } });
    expect(registros.length).toBe(1);
    expect(registros[0].status).toBe("AGUARDANDO_NF");
    expect(registros[0].revisaoNumero).toBe(1);
    expect(registros[0].pontosDiscordancia).toBeNull();
  });
});
