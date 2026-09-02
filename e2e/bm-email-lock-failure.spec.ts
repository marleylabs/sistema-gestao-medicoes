import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * CORREÇÃO DE SEGURANÇA — remove o fail-open da idempotência de e-mail.
 *
 * A auditoria anterior (e2e/bm-retornar-reenvio.spec.ts) provou que a trava de idempotência
 * (`pg_advisory_xact_lock` dentro de uma transação Prisma, em lib/email/send-email.ts) fecha a
 * janela de duplicação sob concorrência real. Mas a implementação daquela correção caía de volta
 * para o caminho SEM trava sempre que a própria transação/lock falhava — exatamente o caminho já
 * comprovado vulnerável. Esta suíte prova que esse fallback foi removido: uma falha real na
 * infraestrutura de idempotência agora BLOQUEIA o envio (nunca duplica, nunca envia sem proteção).
 *
 * Não existe forma de derrubar de fora um advisory lock real do Postgres de forma controlada e
 * determinística num teste E2E — por isso a suíte usa uma injeção de falha PROPOSITAL, restrita
 * ao ambiente de teste (app/api/admin/e2e-test/email-lock-failure/route.ts, que só responde fora
 * de produção com ALLOW_E2E_DATABASE=true — mesma guarda em 3 camadas de EMAIL_FAKE_PROVIDER).
 */

test.beforeAll(assertConnectedToE2eDatabase);

async function setLockFailureInjection(page: import("@playwright/test").Page, enabled: boolean) {
  const res = await page.request.post("/api/admin/e2e-test/email-lock-failure", { data: { enabled } });
  expect(res.ok(), `esperava a rota de injeção de teste responder 200, obtive ${res.status()}`).toBeTruthy();
}

test.describe.serial("Auditoria — falha da trava de idempotência NUNCA cai para envio sem proteção", () => {
  test.afterEach(async ({ page }) => {
    // Garantia de limpeza: nenhum teste seguinte (nesta suíte ou em qualquer outra rodando depois,
    // já que o toggle é um estado em memória do processo do servidor) pode herdar a injeção ligada.
    await setLockFailureInjection(page, false);
    await page.request.post("/api/auth/logout").catch(() => {});
  });

  test("LOCK FALHA — primeiro Enviar BM: workflow continua PENDENTE, e-mail bloqueado (ERROR/EMAIL_IDEMPOTENCY_LOCK_FAILED), zero provider sends", async ({ page }) => {
    const resp = "Fornecedor Lock Falha E2E";
    const email = "fornecedor.lock.falha@example.test";

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    await page.getByLabel("Nome / Responsável").fill(resp);
    await page.getByLabel("CNPJ", { exact: true }).fill("22.333.444/0001-02");
    await page.getByLabel("Razão social").fill(`${resp} LTDA`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await criarResponse;
    await page.request.post("/api/auth/logout");

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: resp } });
    const codigo = cadastro.colaboradorCodigo!;
    const ciclo = (await prisma.mapaPagamentoContexto.findFirstOrThrow()).ciclo;

    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    await setLockFailureInjection(page, true);

    // POST direto (equivalente ao clique real de "Enviar BM") — o workflow de negócio (upsert do
    // SgcAprovacaoMedicao) roda ANTES da notificação e não depende dela; a resposta HTTP precisa
    // continuar 200 mesmo com a camada de e-mail bloqueada (falha de e-mail nunca desfaz o BM).
    const res = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo } });
    expect(res.status(), "falha da trava de e-mail NUNCA pode derrubar a operação de negócio (Enviar BM continua respondendo 200)").toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PENDENTE");
    expect(body.emailNotificacao.ok).toBe(false);

    const sgc = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigo } });
    expect(sgc.status, "workflow precisa ter avançado normalmente, sem rollback por causa do e-mail").toBe("PENDENTE");
    expect(sgc.revisaoNumero).toBe(0);

    const chave = `bm-available/${sgc.id}/0`;
    const logs = await prisma.emailLog.findMany({ where: { event: "BM_AVAILABLE", idempotencyKey: chave } });
    expect(logs.length, "precisa existir exatamente 1 registro de auditoria da tentativa bloqueada").toBe(1);
    expect(logs[0].status).toBe("ERROR");
    expect(logs[0].errorMessage).toContain("EMAIL_IDEMPOTENCY_LOCK_FAILED");
    // Nunca pode existir um providerMessageId — isso indicaria que o provedor foi chamado mesmo
    // sem a garantia da trava, exatamente o que esta correção elimina.
    expect(logs[0].providerMessageId, "provedor NUNCA pode ter sido chamado quando a trava falha").toBeNull();
    const sentCount = await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: chave, status: "SENT" } });
    expect(sentCount, "zero provider sends quando a trava falha").toBe(0);
  });

  test("LOCK FALHA + CONCORRÊNCIA — duas chamadas simultâneas com a trava indisponível produzem ZERO e-mails (nunca 1 duplicado por fallback, nunca 2)", async ({ page }) => {
    const resp = "Fornecedor Lock Falha Concorrencia E2E";
    const email = "fornecedor.lock.falha.concorrencia@example.test";

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    await page.getByLabel("Nome / Responsável").fill(resp);
    await page.getByLabel("CNPJ", { exact: true }).fill("33.444.555/0001-03");
    await page.getByLabel("Razão social").fill(`${resp} LTDA`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await criarResponse;
    await page.request.post("/api/auth/logout");

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: resp } });
    const codigo = cadastro.colaboradorCodigo!;
    const ciclo = (await prisma.mapaPagamentoContexto.findFirstOrThrow()).ciclo;

    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    await setLockFailureInjection(page, true);

    const [r1, r2] = await Promise.all([
      page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo } }),
      page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo } }),
    ]);
    for (const r of [r1, r2]) {
      expect([200, 409]).toContain(r.status());
    }

    const sgc = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigo } });
    expect(sgc.status, "workflow ainda avança normalmente mesmo com a camada de e-mail bloqueada").toBe("PENDENTE");

    const chave = `bm-available/${sgc.id}/0`;
    const sentLogs = await prisma.emailLog.findMany({ where: { event: "BM_AVAILABLE", idempotencyKey: chave, status: "SENT" } });
    expect(sentLogs.length, "com a trava indisponível, é aceitável perder a notificação — nunca duplicar (0, não 1, não 2)").toBe(0);
  });

  test("LOCK NORMAL DEPOIS DA INJEÇÃO DESLIGADA — Enviar BM volta a notificar normalmente (regressão: toggle não vaza estado entre testes)", async ({ page }) => {
    const resp = "Fornecedor Lock Recuperado E2E";
    const email = "fornecedor.lock.recuperado@example.test";

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    await page.getByLabel("Nome / Responsável").fill(resp);
    await page.getByLabel("CNPJ", { exact: true }).fill("44.555.666/0001-04");
    await page.getByLabel("Razão social").fill(`${resp} LTDA`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await criarResponse;
    await page.request.post("/api/auth/logout");

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: resp } });
    const codigo = cadastro.colaboradorCodigo!;

    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=visao");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();
    await page.getByPlaceholder("Digite o ID ou nome…").fill(codigo);
    await page.getByRole("button", { name: new RegExp(codigo) }).click();
    const criarPagamento = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
    await criarPagamento;
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toHaveCount(0);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(resp);

    const sgc = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigo } });
    const log = await prisma.emailLog.findFirst({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgc.id}/0` }, orderBy: { createdAt: "desc" } });
    expect(log!.status).toBe("SENT");
    expect(log!.providerMessageId).toBeTruthy();
  });
});
