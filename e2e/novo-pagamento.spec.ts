import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers, e2eCiclo } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * BUG — "Novo pagamento" falhava em silêncio: preencher Condições fixas + Descontos + Documentos
 * Medidos e clicar "Cadastrar" não fazia nada visível (sem toast, sem erro, modal continuava
 * aberto). Causa raiz real, encontrada nesta sessão via reprodução direta contra
 * localhost:3011+medicoes_e2e: o campo "Nome (ID)" tinha dois estados desacoplados
 * (`codigoQuery`, o texto visível, e `form.projetistaCodigo`, o valor de fato enviado) — digitar
 * sem clicar numa sugestão da lista deixava `projetistaCodigo` vazio, e qualquer linha de
 * Documento/Desconto adicionada then falhava com 400/404 dentro de um `for` sem try/catch em
 * `handleSavePayment` — a promise rejeitada nunca chegava a `onSave` (que cria o registro em si) e
 * também nunca era capturada em lugar nenhum, resultando em silêncio total.
 */

const FORNECEDOR_NOME = "E2E Novo Pagamento";
const CODIGO = "E2E-NP-001";

test.beforeAll(assertConnectedToE2eDatabase);

async function abrirNovoPagamento(page: import("@playwright/test").Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
  await page.goto("/?section=visao");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();
}

test.describe.serial("Novo pagamento — sucesso e falha controlada, nunca silêncio", () => {
  test("SUCESSO: condições fixas + desconto + documento medido → cadastra, calcula R$ 11.900,00, sem F5", async ({ page }) => {
    await abrirNovoPagamento(page);

    // Seleciona um fornecedor REAL (via sugestão do autocomplete) — sincroniza codigoQuery e
    // form.projetistaCodigo corretamente.
    await page.getByPlaceholder("Digite o ID ou nome…").fill(CODIGO);
    await page.getByRole("button", { name: new RegExp(CODIGO) }).click();
    await expect(page.getByPlaceholder("Digite o ID ou nome…")).toHaveValue(CODIGO);

    // Condições fixas: Valor fixo R$5.000,00 + Adicionais R$2.000,00 = R$7.000,00.
    await page.getByLabel("Valor fixo mensal/contratual").fill("5000");
    await page.getByLabel("Valor fixo mensal/contratual").blur();
    await page.getByLabel("Adicionais fixos").fill("2000");
    await page.getByLabel("Adicionais fixos").blur();
    await expect(page.getByText("Base: R$ 7.000,00")).toBeVisible();

    // Desconto: descrição "TESTE", valor R$ 100,00.
    await page.getByRole("button", { name: "Adicionar desconto" }).click();
    await page.getByLabel("Descrição do desconto").fill("TESTE");
    await page.getByLabel("Valor do desconto").fill("100");
    await page.getByLabel("Valor do desconto").blur();

    // Documento medido: A1eq=1, %Emissão=100, Preço Unit.=R$5.000,00 → Valor Medido R$5.000,00.
    await page.getByRole("button", { name: "Adicionar linha" }).click();
    const docRow = page.locator("tbody tr").filter({ has: page.getByPlaceholder("SE-001") });
    await docRow.getByPlaceholder("SE-001").fill("SE-TESTE");
    await docRow.getByPlaceholder("NR-0001").fill("NR-TESTE");
    await docRow.getByPlaceholder("A1").fill("PDF");
    // getByPlaceholder faz substring match por padrão — "0" sem exact:true também bateria em
    // "SE-001"/"NR-0001" (ambos contêm "0"). Com exact:true sobram só A1eq e Preço Unit., que são
    // literalmente "0" — nessa ordem no DOM (A1eq vem antes de Preço Unit. na linha).
    const a1eqInput = docRow.getByPlaceholder("0", { exact: true }).first();
    await a1eqInput.fill("1");
    await docRow.getByPlaceholder("100").fill("100");
    await docRow.getByPlaceholder("Tipo").fill("DOC");
    const precoInput = docRow.getByPlaceholder("0", { exact: true }).last();
    await precoInput.fill("5000");

    await expect(page.getByText("Total medido líquido")).toBeVisible();
    await expect(page.getByText("R$ 11.900,00").last()).toBeVisible();

    const cadastrarBtn = page.getByRole("button", { name: "Cadastrar", exact: true });
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
    await cadastrarBtn.click();
    // Nunca mais "clica e nada acontece" — o botão precisa refletir o estado de carregamento real.
    await expect(page.getByRole("button", { name: "Cadastrando…" })).toBeVisible();
    await criarResponse;

    // Sucesso: toast aparece, modal fecha, SEM reload.
    await expect(page.getByText("Pagamento cadastrado com sucesso.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toHaveCount(0);
    // "Pagamentos por fornecedor" é a única tabela com a coluna "Ações" — as outras duas
    // ("Tipos e Preços" e o resumo do dashboard) também listam o nome do fornecedor.
    const pagamentosTable = page.locator("table").filter({ has: page.getByText("Ações", { exact: true }) });
    await expect(pagamentosTable.locator("tr", { hasText: FORNECEDOR_NOME })).toContainText("R$ 11.900,00");

    const item = await prisma.mapaPagamentoItem.findFirstOrThrow({ where: { ciclo: e2eCiclo(), projetistaCodigo: CODIGO } });
    expect(Number(item.valor)).toBe(11900);

    const documentoMedido = await prisma.medicao.findFirst({ where: { ciclo: e2eCiclo(), numeroDocumento: "NR-TESTE" } });
    expect(documentoMedido).toBeTruthy();
    expect(Number(documentoMedido!.equivalenteA1Horas)).toBe(1);

    const descontoPersistido = await prisma.medicao.findFirst({ where: { ciclo: e2eCiclo(), tipo2: "DESCONTO", obs: "TESTE" } });
    expect(descontoPersistido).toBeTruthy();
    expect(Number(descontoPersistido!.condicao)).toBe(-100);

    await page.request.post("/api/auth/logout");
  });

  test("ERRO CONTROLADO: fornecedor digitado sem selecionar sugestão (código inexistente) + documento → modal permanece aberto com mensagem, nada é criado", async ({ page }) => {
    await abrirNovoPagamento(page);

    // Digita livremente SEM clicar em nenhuma sugestão — simula o cenário real que causava a
    // falha silenciosa.
    await page.getByPlaceholder("Digite o ID ou nome…").fill("CODIGO-QUE-NAO-EXISTE-99999");
    await page.getByRole("heading", { name: "Novo pagamento" }).click(); // fecha a lista de sugestões

    await page.getByRole("button", { name: "Adicionar linha" }).click();
    const docRow = page.locator("tbody tr").filter({ has: page.getByPlaceholder("SE-001") });
    const a1eqInput = docRow.getByPlaceholder("0", { exact: true }).first();
    await a1eqInput.fill("1");
    const precoInput = docRow.getByPlaceholder("0", { exact: true }).last();
    await precoInput.fill("500");

    const antesCount = await prisma.mapaPagamentoItem.count({ where: { ciclo: e2eCiclo(), projetistaCodigo: "CODIGO-QUE-NAO-EXISTE-99999" } });
    expect(antesCount).toBe(0);

    await page.getByRole("button", { name: "Cadastrar", exact: true }).click();

    // Nunca "clica e nada acontece": ou modal fecha com sucesso, ou fica aberto com mensagem clara.
    await expect(page.getByText(/Fornecedor não encontrado|Não foi possível cadastrar/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();
    // Dados digitados preservados — o campo não foi limpo.
    await expect(page.getByPlaceholder("Digite o ID ou nome…")).toHaveValue("CODIGO-QUE-NAO-EXISTE-99999");

    const depoisCount = await prisma.mapaPagamentoItem.count({ where: { ciclo: e2eCiclo(), projetistaCodigo: "CODIGO-QUE-NAO-EXISTE-99999" } });
    expect(depoisCount).toBe(0);

    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.request.post("/api/auth/logout");
  });
});
