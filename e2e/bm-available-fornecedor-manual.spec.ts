import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * AUDITORIA — BM_AVAILABLE não chegava para fornecedor criado manualmente.
 *
 * CAUSA RAIZ CONFIRMADA (reproduzida contra localhost:3011+medicoes_e2e antes da correção): o
 * campo "Nome (ID)" do modal "Novo pagamento" aceitava qualquer texto digitado como
 * `projetistaCodigo`, sem exigir seleção de uma sugestão real. Texto digitado (ex.: "Fornecedor
 * Manual Email B") virava literalmente `SgcAprovacaoMedicao.colaboradorCodigo` ao "Enviar BM" —
 * mas `resolveFornecedorEmail`/`/api/sgc/enviar` resolvem o Profissional/CadastroFornecedor por
 * IGUALDADE EXATA de colaboradorCodigo (nunca por CNPJ, corretamente), então nunca batia com o
 * "FORNECEDOR MANUAL EMAIL B" canônico gravado por `upsertCadastroFornecedor`. A exibição em
 * "Pagamentos por Fornecedor" (lib/mapa-pagamento-cadastro.ts) já tolerava a divergência via
 * comparação normalizada — por isso a tela parecia correta e o workflow avançava normalmente,
 * mascarando o problema até o e-mail (que nunca teve destinatário para resolver).
 *
 * CORREÇÃO: `lib/mapa-pagamento.ts:resolveProjetistaCodigo()`, chamada em POST /api/mapa-pagamento
 * e PATCH /api/mapa-pagamento/[id] — resolve o texto contra um Profissional real (case-insensitive)
 * e persiste sempre a grafia CANÔNICA; se não encontrar nenhum Profissional correspondente,
 * rejeita com 400 em vez de aceitar identidade inventada (nunca mais falha silenciosa).
 *
 * Provider fake (EMAIL_FAKE_PROVIDER=true — playwright.config.ts + lib/email/send-email.ts):
 * nenhuma chamada de rede real ao Resend, mas toda a lógica de negócio real roda sem mock.
 */

test.beforeAll(assertConnectedToE2eDatabase);

async function criarFornecedorManual(page: import("@playwright/test").Page, opts: { responsavel: string; cnpj: string; email: string }) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
  await page.goto("/?section=administrativo");
  await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);

  await page.getByRole("button", { name: "Novo fornecedor" }).click();
  await page.getByLabel("Nome / Responsável").fill(opts.responsavel);
  await page.getByLabel("CNPJ", { exact: true }).fill(opts.cnpj);
  await page.getByLabel("Razão social").fill(`${opts.responsavel} LTDA`);
  await page.getByLabel("E-mail", { exact: true }).fill(opts.email);
  const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
  await criarResponse;
  await expect(page.getByText("Fornecedor cadastrado com sucesso.")).toBeVisible();
  await page.request.post("/api/auth/logout");
}

test.describe.serial("Diagnóstico + regressão BM_AVAILABLE — fornecedor criado manualmente", () => {
  test("CAMINHO CORRETO: selecionar o fornecedor pela sugestão do autocomplete → BM_AVAILABLE resolve o e-mail e é enviado (fake)", async ({ page }) => {
    const responsavel = "Fornecedor Manual Email A";
    const email = "fornecedor.manual.a@example.test";
    await criarFornecedorManual(page, { responsavel, cnpj: "33.777.111/0001-40", email });

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const codigoCanonico = cadastro.colaboradorCodigo!;
    expect(codigoCanonico).toBeTruthy();
    const profissional = await prisma.profissional.findFirst({ where: { codigo: codigoCanonico } });
    expect(profissional, "upsertCadastroFornecedor precisa criar/vincular um Profissional com o MESMO colaboradorCodigo").toBeTruthy();

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=visao");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();
    await page.getByPlaceholder("Digite o ID ou nome…").fill(codigoCanonico);
    await page.getByRole("button", { name: new RegExp(codigoCanonico) }).click();
    await expect(page.getByPlaceholder("Digite o ID ou nome…")).toHaveValue(codigoCanonico);

    const criarPagamento = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
    await criarPagamento;
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toHaveCount(0);

    const item = await prisma.mapaPagamentoItem.findFirstOrThrow({ where: { projetistaCodigo: codigoCanonico } });
    expect(item.projetistaCodigo).toBe(codigoCanonico);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(responsavel);

    const sgc = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigoCanonico } });
    expect(sgc.status).toBe("PENDENTE");
    expect(sgc.colaboradorCodigo).toBe(cadastro.colaboradorCodigo);

    const emailLog = await prisma.emailLog.findFirst({
      where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgc.id}/${sgc.revisaoNumero}` },
      orderBy: { createdAt: "desc" },
    });
    expect(emailLog, "email_log de BM_AVAILABLE precisa existir — trigger disparou").toBeTruthy();
    expect(emailLog!.intendedRecipients).toContain(email);
    expect(emailLog!.status).toBe("SENT");
    expect(emailLog!.providerMessageId).toBeTruthy();
    expect(emailLog!.actualRecipients).toEqual(["e2e-test-recipient@example.test"]);

    // AJUSTE DE CC — planejamentoprojetacs@gmail.com adicionado a EMAIL_BM_CC (lib/email/cc-policy.ts).
    // Em EMAIL_TEST_MODE=true, resolveActualRecipients() sempre zera CC real (actualCc), então o
    // sinal real de "a política de CC calculou certo" é intendedCc em metadata — nunca actualCc.
    const metadata = emailLog!.metadata as { intendedCc?: string[] } | null;
    const intendedCc = metadata?.intendedCc ?? [];
    expect(intendedCc, "CC pretendido de BM_AVAILABLE precisa ter exatamente os 3 endereços de EMAIL_BM_CC").toEqual([
      "gabriel.sousa@projetacs.com",
      "anderson.marley@projetacs.com",
      "planejamentoprojetacs@gmail.com",
    ]);
    expect(new Set(intendedCc).size, "nenhum endereço duplicado no CC").toBe(intendedCc.length);
    // TO do fornecedor nunca pode se repetir dentro do CC (mesma garantia de dedup do
    // resolveActualRecipients/persistLog, aqui verificada sobre o pretendido).
    expect(intendedCc.map((e) => e.toLowerCase())).not.toContain(email.toLowerCase());

    await page.request.post("/api/auth/logout");
  });

  test("REGRESSÃO: digitar o NOME (caixa diferente do código canônico) sem clicar na sugestão → auto-corrigido para o código real, e-mail chega mesmo assim", async ({ page }) => {
    const responsavel = "Fornecedor Manual Email B";
    const email = "fornecedor.manual.b@example.test";
    await criarFornecedorManual(page, { responsavel, cnpj: "44.888.222/0001-50", email });

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const codigoCanonico = cadastro.colaboradorCodigo!; // "FORNECEDOR MANUAL EMAIL B"

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=visao");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();

    // Digita exatamente como aparece na tela ("Fornecedor Manual Email B", não o código
    // canônico em maiúsculas) e NUNCA clica na sugestão — antes da correção, isso persistia
    // uma identidade divergente em silêncio.
    await page.getByPlaceholder("Digite o ID ou nome…").fill(responsavel);
    await page.getByRole("heading", { name: "Novo pagamento" }).click();

    const criarPagamento = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
    const criarRes = await criarPagamento;
    expect(criarRes.status()).toBe(201);
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toHaveCount(0);

    // resolveProjetistaCodigo() já reescreveu para a grafia canônica antes de persistir.
    const item = await prisma.mapaPagamentoItem.findFirstOrThrow({ where: { projetistaCodigo: codigoCanonico } });
    expect(item.projetistaCodigo).toBe(codigoCanonico);

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(responsavel);

    const sgc = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigoCanonico } });
    expect(sgc.status).toBe("PENDENTE");

    const emailLog = await prisma.emailLog.findFirst({
      where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgc.id}/${sgc.revisaoNumero}` },
      orderBy: { createdAt: "desc" },
    });
    expect(emailLog, "email_log de BM_AVAILABLE precisa existir mesmo com o texto digitado em caixa diferente").toBeTruthy();
    expect(emailLog!.intendedRecipients).toContain(email);
    expect(emailLog!.status).toBe("SENT");

    await page.request.post("/api/auth/logout");
  });

  test("REGRESSÃO: fornecedor genuinamente inexistente → 400 controlado, nunca falha silenciosa, nenhum pagamento criado", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    await page.goto("/?section=visao");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();

    const codigoInexistente = "CODIGO-QUE-NUNCA-EXISTIU-XYZ";
    await page.getByPlaceholder("Digite o ID ou nome…").fill(codigoInexistente);
    await page.getByRole("heading", { name: "Novo pagamento" }).click();

    const criarPagamento = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
    const res = await criarPagamento;
    expect(res.status()).toBe(400);

    await expect(page.getByText(/não encontrado/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible(); // modal continua aberto

    const count = await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: codigoInexistente } });
    expect(count).toBe(0);

    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.request.post("/api/auth/logout");
  });

  test("SEGURANÇA — CNPJ compartilhado: dois fornecedores manuais com o MESMO CNPJ recebem BM_AVAILABLE nos e-mails corretos, nunca cruzados", async ({ page }) => {
    const cnpjCompartilhado = "55.999.333/0001-70";
    const respC = "Fornecedor Manual Email C";
    const respD = "Fornecedor Manual Email D";
    const emailC = "fornecedor.manual.c@example.test";
    const emailD = "fornecedor.manual.d@example.test";
    await criarFornecedorManual(page, { responsavel: respC, cnpj: cnpjCompartilhado, email: emailC });
    await criarFornecedorManual(page, { responsavel: respD, cnpj: cnpjCompartilhado, email: emailD });

    const cadastroC = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: respC } });
    const cadastroD = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: respD } });
    expect(cadastroC.cnpjNormalizado).toBe(cadastroD.cnpjNormalizado);
    expect(cadastroC.colaboradorCodigo).not.toBe(cadastroD.colaboradorCodigo);

    async function enviarBmParaCodigo(codigo: string) {
      const login = new LoginPage(page);
      await login.goto();
      await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
      await page.goto("/?section=visao");
      await page.getByRole("button", { name: "Adicionar" }).click();
      await page.getByPlaceholder("Digite o ID ou nome…").fill(codigo);
      await page.getByRole("button", { name: new RegExp(codigo) }).click();
      const criarPagamento = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
      await criarPagamento;
      await expect(page.getByRole("heading", { name: "Novo pagamento" })).toHaveCount(0);

      const enviarRes = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo: (await prisma.mapaPagamentoContexto.findFirstOrThrow()).ciclo } });
      expect(enviarRes.ok()).toBeTruthy();
      await page.request.post("/api/auth/logout");
    }

    await enviarBmParaCodigo(cadastroC.colaboradorCodigo!);
    await enviarBmParaCodigo(cadastroD.colaboradorCodigo!);

    const sgcC = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: cadastroC.colaboradorCodigo! } });
    const sgcD = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: cadastroD.colaboradorCodigo! } });
    const logC = await prisma.emailLog.findFirst({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgcC.id}/${sgcC.revisaoNumero}` }, orderBy: { createdAt: "desc" } });
    const logD = await prisma.emailLog.findFirst({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgcD.id}/${sgcD.revisaoNumero}` }, orderBy: { createdAt: "desc" } });

    expect(logC!.intendedRecipients).toEqual([emailC]);
    expect(logD!.intendedRecipients).toEqual([emailD]);
    expect(logC!.intendedRecipients).not.toEqual(logD!.intendedRecipients);
  });

  test("SEGURANÇA — HOMÔNIMOS: dois Profissional distintos com o mesmo nomeCompleto (ex.: duas pessoas reais do XLSX) nunca resolvem para um escolhido arbitrariamente", async ({ page }) => {
    // Profissional.nome/codigo são @unique — duas pessoas REAIS homônimas só podem coexistir com
    // nomeCompleto igual e codigo/nome distintos (cenário real de importação XLSX, não replicável
    // pelo cadastro manual — que colide por nome). Semeado direto por Prisma para reproduzir esse
    // dado exatamente como o ETL produziria.
    const nomeHomonimo = "Fornecedor Homônimo E2E";
    const codigoX = "HOMONIMO-CODIGO-X";
    const codigoY = "HOMONIMO-CODIGO-Y";
    await prisma.profissional.deleteMany({ where: { codigo: { in: [codigoX, codigoY] } } });
    await prisma.profissional.create({ data: { nome: codigoX, codigo: codigoX, nomeCompleto: nomeHomonimo, cnpj: "66111222000133" } });
    await prisma.profissional.create({ data: { nome: codigoY, codigo: codigoY, nomeCompleto: nomeHomonimo, cnpj: "77222333000144" } });

    try {
      const login = new LoginPage(page);
      await login.goto();
      await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
      await page.goto("/?section=visao");
      await page.getByRole("button", { name: "Adicionar" }).click();
      await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();

      // Digita o NOME compartilhado (não um dos dois códigos) sem clicar em nenhuma sugestão —
      // resolveProjetistaCodigo() precisa recusar a ambiguidade, nunca escolher X ou Y sozinho.
      await page.getByPlaceholder("Digite o ID ou nome…").fill(nomeHomonimo);
      await page.getByRole("heading", { name: "Novo pagamento" }).click();

      const criarPagamento = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
      const res = await criarPagamento;
      expect(res.status()).toBe(400);

      await expect(page.getByText(/mais de um fornecedor/i)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();

      const countX = await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: codigoX } });
      const countY = await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: codigoY } });
      expect(countX, "nunca deve ter escolhido X arbitrariamente").toBe(0);
      expect(countY, "nunca deve ter escolhido Y arbitrariamente").toBe(0);

      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.request.post("/api/auth/logout");
    } finally {
      await prisma.profissional.deleteMany({ where: { codigo: { in: [codigoX, codigoY] } } });
    }
  });
});
