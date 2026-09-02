import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * BUG REPORTADO EM PRODUÇÃO: "Retornar BM" (financeiro/medição devolve o BM para
 * AGUARDANDO_ENVIO) seguido de um novo "Enviar BM" nunca notificava o fornecedor por e-mail de
 * novo.
 *
 * CAUSA RAIZ CONFIRMADA (lendo app/api/admin/financeiro/route.ts VOLTAR_BM + app/api/sgc/enviar):
 * VOLTAR_BM leva o status para AGUARDANDO_ENVIO sem passar por REVISAO_SOLICITADA — então
 * `isRevisao` em /api/sgc/enviar é false, `revisaoNumero` nunca incrementa, e a chave de
 * idempotência de BM_AVAILABLE (`bm-available/${sgcId}/${revisaoNumero}`) fica IDÊNTICA à do
 * envio original. O curto-circuito de idempotência de `sendTransactionalEmail()` (proteção real
 * contra duplo-clique/retry) descartava o reenvio como se fosse o mesmo e-mail de novo.
 *
 * CORREÇÃO (decisão explícita do usuário: reenviar sem contar como revisão formal — não altera
 * `revisaoNumero`/"Rev. N", que continua reservado para revisão pedida pelo fornecedor):
 * `SgcAprovacaoMedicao.voltadoAt` (já existente, sem migração) passa a compor a chave de
 * idempotência (`-retorno-${voltadoAt.getTime()}`) sempre que o envio vier de um "Retornar BM"
 * anterior — ver lib/email/events.ts:notifyBmAvailable e app/api/sgc/enviar/route.ts.
 *
 * AUDITORIA DE COMPROVAÇÃO (rodada 2, sem alterar a regra de negócio): ao provar o comportamento
 * exigido — retry sequencial e DUAS CHAMADAS GENUINAMENTE CONCORRENTES ao mesmo /api/sgc/enviar —
 * foi reproduzido um bug REAL e pré-existente (não introduzido por esta correção, mas exposto por
 * ela): `sendTransactionalEmail()` fazia um `findFirst` (já enviado?) e só depois um `create`, sem
 * nenhuma trava entre as duas operações. Sob concorrência verdadeira (duas requisições chegando
 * quase no mesmo instante, comprovado abaixo), as duas passavam pelo `findFirst` ANTES de
 * qualquer uma ter persistido seu log — as duas concluíam "ainda não enviado" e as duas enviavam,
 * gerando 2 `email_logs` SENT com a MESMA idempotencyKey e 2 envios reais ao provedor.
 * `email_logs.idempotencyKey` não tem `@@unique` no schema, só `@@index` (prisma/schema.prisma).
 *
 * CORREÇÃO (lib/email/send-email.ts): o bloco "checar já enviado → enviar → persistir SENT" agora
 * roda dentro de uma transação Prisma que primeiro adquire `pg_advisory_xact_lock(hashtext(chave))`
 * — serializa qualquer par de chamadas com a MESMA idempotencyKey (chaves diferentes nunca se
 * bloqueiam entre si). A trava é liberada automaticamente no fim da transação (commit/rollback).
 * Falha na própria trava/transação (não na lógica de negócio) cai para o caminho antigo sem trava,
 * preservando a mesma resiliência "fail-open" que já existia. Nenhuma flag de "force"/"skip"/
 * "bypass" idempotência foi usada — a trava GARANTE uma nova rodada idempotente, não desliga a
 * proteção.
 */

test.beforeAll(assertConnectedToE2eDatabase);

test.describe.serial("Auditoria — idempotência do BM_AVAILABLE em Enviar BM / Retornar BM / concorrência", () => {
  const responsavel = "Fornecedor Retorno BM E2E";
  const email = "fornecedor.retorno.bm@example.test";

  test("Enviar BM → retry sequencial (409, sem novo log) → Retornar BM → Enviar BM de novo (2º log, revisaoNumero inalterado) → retry sequencial (409, sem 3º log)", async ({ page }) => {
    // 1) Cadastro manual do fornecedor (mesmo caminho de e2e/bm-available-fornecedor-manual.spec.ts).
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);

    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    await page.getByLabel("Nome / Responsável").fill(responsavel);
    await page.getByLabel("CNPJ", { exact: true }).fill("88.222.444/0001-90");
    await page.getByLabel("Razão social").fill(`${responsavel} LTDA`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await criarResponse;
    await expect(page.getByText("Fornecedor cadastrado com sucesso.")).toBeVisible();
    await page.request.post("/api/auth/logout");

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const codigoCanonico = cadastro.colaboradorCodigo!;
    const ciclo = (await prisma.mapaPagamentoContexto.findFirstOrThrow()).ciclo;

    // 2) Cria o pagamento e envia o primeiro BM (via botão real da UI — item 21/22).
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

    const pagamentos = new PagamentosPage(page);
    await pagamentos.goto();
    await pagamentos.enviarBm(responsavel);

    const sgcAposPrimeiroEnvio = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigoCanonico } });
    expect(sgcAposPrimeiroEnvio.status).toBe("PENDENTE");
    expect(sgcAposPrimeiroEnvio.revisaoNumero).toBe(0);
    expect(sgcAposPrimeiroEnvio.voltadoAt).toBeNull();

    const chavePrimeiroEnvio = `bm-available/${sgcAposPrimeiroEnvio.id}/${sgcAposPrimeiroEnvio.revisaoNumero}`;
    const primeiroLog = await prisma.emailLog.findFirst({
      where: { event: "BM_AVAILABLE", idempotencyKey: chavePrimeiroEnvio },
      orderBy: { createdAt: "desc" },
    });
    expect(primeiroLog, "primeiro envio precisa ter gerado email_log SENT").toBeTruthy();
    expect(primeiroLog!.status).toBe("SENT");
    expect(primeiroLog!.intendedRecipients).toContain(email);
    expect(primeiroLog!.providerMessageId).toBeTruthy();
    const primeiroProviderMessageId = primeiroLog!.providerMessageId;

    // 3) RETRY SEQUENCIAL do primeiro envio (chamada real a /api/sgc/enviar, sem passar por
    // Retornar BM) — a guarda de status de app/api/sgc/enviar/route.ts (`existing.status` já é
    // PENDENTE, fora de AGUARDANDO_ENVIO/REVISAO_SOLICITADA/CANCELADO) rejeita com 409 ANTES de
    // sequer chegar em notifyBmAvailable. Retry sequencial nunca alcança a camada de e-mail —
    // continua exatamente 1 log.
    const retry1 = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigoCanonico, ciclo } });
    expect(retry1.status()).toBe(409);
    const logsAposRetry1 = await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: chavePrimeiroEnvio } });
    expect(logsAposRetry1, "retry sequencial do primeiro envio nunca pode criar um segundo log").toBe(1);

    // 4) Retorna o BM (VOLTAR_BM, via botão real) — a UI do "Retornar BM" só aparece com status
    // PENDENTE/REVISAO_SOLICITADA.
    await pagamentos.goto();
    await pagamentos.retornarBm(responsavel);

    const sgcAposRetorno = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigoCanonico } });
    expect(sgcAposRetorno.status).toBe("AGUARDANDO_ENVIO");
    // Retornar BM NUNCA é revisão — revisaoNumero permanece intocado.
    expect(sgcAposRetorno.revisaoNumero).toBe(0);
    expect(sgcAposRetorno.voltadoAt, "VOLTAR_BM precisa gravar voltadoAt — é a base da nova chave de idempotência").not.toBeNull();

    // 5) Envia o BM de novo (via botão real) — antes da correção, isso NUNCA gerava um novo
    // email_log (idempotência colidia com o envio original porque revisaoNumero não muda).
    await pagamentos.goto();
    await pagamentos.enviarBm(responsavel);

    const sgcAposSegundoEnvio = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigoCanonico } });
    expect(sgcAposSegundoEnvio.status).toBe("PENDENTE");
    // Decisão explícita do usuário: reenvio pós-"Retornar BM" NUNCA conta como revisão formal.
    expect(sgcAposSegundoEnvio.revisaoNumero).toBe(0);

    const chaveSegundoEnvio = `bm-available/${sgcAposSegundoEnvio.id}/${sgcAposSegundoEnvio.revisaoNumero}-retorno-${sgcAposRetorno.voltadoAt!.getTime()}`;
    const segundoLog = await prisma.emailLog.findFirst({
      where: { event: "BM_AVAILABLE", idempotencyKey: chaveSegundoEnvio },
      orderBy: { createdAt: "desc" },
    });
    expect(segundoLog, "reenvio pós-Retornar-BM precisa gerar um SEGUNDO email_log SENT, distinto do primeiro").toBeTruthy();
    expect(segundoLog!.status).toBe("SENT");
    expect(segundoLog!.intendedRecipients).toContain(email);
    expect(segundoLog!.providerMessageId).toBeTruthy();
    expect(segundoLog!.providerMessageId).not.toBe(primeiroProviderMessageId);
    expect(segundoLog!.idempotencyKey).not.toBe(primeiroLog!.idempotencyKey);

    // 6) RETRY SEQUENCIAL do segundo envio (mesmo estado, sem outro Retornar BM no meio) — mesma
    // guarda 409, continua exatamente 2 logs no total (1 por rodada), nunca 3.
    const retry2 = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigoCanonico, ciclo } });
    expect(retry2.status()).toBe(409);
    const logsAposRetry2 = await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: chaveSegundoEnvio } });
    expect(logsAposRetry2, "retry sequencial do segundo envio nunca pode criar um terceiro log").toBe(1);
    const totalLogsFornecedor = await prisma.emailLog.count({
      where: { event: "BM_AVAILABLE", idempotencyKey: { in: [chavePrimeiroEnvio, chaveSegundoEnvio] } },
    });
    expect(totalLogsFornecedor, "no total: exatamente 1 log da primeira rodada + 1 log da segunda rodada, nunca mais").toBe(2);

    await page.request.post("/api/auth/logout");
  });

  test("CONCORRÊNCIA REAL — duas chamadas simultâneas a /api/sgc/enviar no primeiro envio produzem no máximo 1 e-mail BM_AVAILABLE", async ({ page }) => {
    // Fornecedor dedicado — cenário de "BM completamente novo, nunca enviado" (item 26), testado
    // sob concorrência genuína e não apenas retry sequencial (que a guarda de status já cobre).
    const resp = "Fornecedor Retorno BM Concorrencia E2E";
    const emailConc = "fornecedor.retorno.bm.concorrencia@example.test";
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    await page.getByLabel("Nome / Responsável").fill(resp);
    await page.getByLabel("CNPJ", { exact: true }).fill("11.222.333/0001-01");
    await page.getByLabel("Razão social").fill(`${resp} LTDA`);
    await page.getByLabel("E-mail", { exact: true }).fill(emailConc);
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await criarResponse;
    await page.request.post("/api/auth/logout");

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: resp } });
    const codigo = cadastro.colaboradorCodigo!;
    const ciclo = (await prisma.mapaPagamentoContexto.findFirstOrThrow()).ciclo;

    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);

    // Duas requisições disparadas em paralelo (Promise.all — sem await entre elas) contra a MESMA
    // rota, MESMO colaboradorCodigo/ciclo, simulando duplo clique/duas abas/retry de rede
    // concorrente real, não simulado por mock.
    const [r1, r2] = await Promise.all([
      page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo } }),
      page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo } }),
    ]);
    const statuses = [r1.status(), r2.status()].sort();
    // Duas variações legítimas dependendo de qual chegou primeiro ao banco: [200,200] quando as
    // duas passaram pelo upsert do workflow (o guard de status também correu concorrentemente) ou
    // [200,409] quando a segunda já viu o status PENDENTE gravado pela primeira — em QUALQUER dos
    // dois casos, o requisito é o mesmo: nunca dois e-mails.
    expect(statuses.every((s) => s === 200 || s === 409), `esperava só 200/409, obtive ${statuses}`).toBe(true);
    expect(statuses.includes(200), "pelo menos uma das duas chamadas concorrentes precisa ter sucesso").toBe(true);

    const sgc = await prisma.sgcAprovacaoMedicao.findFirstOrThrow({ where: { colaboradorCodigo: codigo } });
    expect(sgc.status).toBe("PENDENTE");
    expect(sgc.revisaoNumero).toBe(0);

    const logs = await prisma.emailLog.findMany({
      where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${sgc.id}/${sgc.revisaoNumero}` },
      select: { id: true, status: true, providerMessageId: true, createdAt: true },
    });
    // Critério de aceitação do usuário: nunca dois providerMessageId novos para a mesma rodada.
    expect(logs.length, `esperava exatamente 1 email_log BM_AVAILABLE para a rodada concorrente, obtive ${logs.length}: ${JSON.stringify(logs)}`).toBe(1);
    expect(logs[0].status).toBe("SENT");
    expect(logs[0].providerMessageId).toBeTruthy();

    await page.request.post("/api/auth/logout");
  });
});
