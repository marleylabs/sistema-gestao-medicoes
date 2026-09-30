import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/test-with-error-guard";
import type { Page } from "@playwright/test";
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

async function abrirNovoPagamento(page: Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
  await page.goto("/fornecedores");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("heading", { name: "Novo pagamento" })).toBeVisible();
}

/** Painel de cadastro — o MESMO editor lateral do "Editar pagamento" (diálogo nomeado pelo título). */
function painelNovo(page: Page) {
  return page.getByRole("dialog", { name: "Novo pagamento" });
}

async function kpiFornecedoresNoCiclo(page: Page) {
  const texto = await page.getByTestId("fornecedores-kpis").locator(":scope > *").first().innerText();
  return Number(texto.match(/\n\s*(\d+)\s*\n/)?.[1] ?? NaN);
}

test.describe.serial("Novo pagamento — sucesso e falha controlada, nunca silêncio", () => {
  test("SUCESSO: condição fixa + desconto + documento medido → cadastra, calcula R$ 9.900,00, sem F5", async ({ page }) => {
    await abrirNovoPagamento(page);

    // Seleciona um fornecedor REAL (via sugestão do autocomplete) — sincroniza codigoQuery e
    // form.projetistaCodigo corretamente.
    await page.getByRole("textbox", { name: "Nome", exact: true }).fill(CODIGO);
    await page.getByRole("button", { name: new RegExp(FORNECEDOR_NOME) }).click();
    await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toHaveValue(CODIGO);
    // Seleção preenche CNPJ e Razão social (somente leitura, vindos do cadastro) e o cabeçalho.
    await expect(painelNovo(page).getByRole("textbox", { name: "CNPJ" })).not.toHaveValue("");
    const profissionalSelecionado = await prisma.profissional.findUniqueOrThrow({ where: { codigo: CODIGO } });
    await expect(painelNovo(page).getByRole("textbox", { name: "Razão social" })).toHaveValue(profissionalSelecionado.razaoSocial ?? "");
    await expect(painelNovo(page).getByText(FORNECEDOR_NOME, { exact: true }).first()).toBeVisible();

    // Condição fixa: a UI atual mantém somente o valor mensal/contratual editável.
    await page.getByLabel("Valor fixo mensal/contratual").fill("5000");
    await page.getByLabel("Valor fixo mensal/contratual").blur();
    await expect(page.getByText("Base: R$ 5.000,00")).toBeVisible();

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
    await expect(page.getByText("R$ 9.900,00").last()).toBeVisible();

    const kpiAntes = await kpiFornecedoresNoCiclo(page);
    const cadastrarBtn = page.getByRole("button", { name: "Cadastrar", exact: true });
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/mapa-pagamento") && r.request().method() === "POST");
    await cadastrarBtn.click();
    // Nunca mais "clica e nada acontece" — o botão precisa refletir o estado de carregamento real.
    await expect(page.getByRole("button", { name: "Cadastrando…" })).toBeVisible();
    await criarResponse;

    // Sucesso: toast aparece, modal fecha, SEM reload.
    await expect(page.getByText("Pagamento cadastrado com sucesso.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Novo pagamento" })).toHaveCount(0);
    const pagamentosTable = page.getByTestId("fornecedores-tabela");
    await expect(pagamentosTable.locator("tr", { hasText: FORNECEDOR_NOME })).toContainText("R$ 9.900,00");
    // Continuidade: o detalhe do fornecedor recém-criado abre, e o KPI reflete a nova linha.
    await expect(page.getByRole("dialog", { name: `Detalhe de ${FORNECEDOR_NOME}` })).toBeVisible();
    await expect.poll(() => kpiFornecedoresNoCiclo(page)).toBe(kpiAntes + 1);

    const item = await prisma.mapaPagamentoItem.findFirstOrThrow({ where: { ciclo: e2eCiclo(), projetistaCodigo: CODIGO } });
    expect(Number(item.valor)).toBe(9900);

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
    await page.getByRole("textbox", { name: "Nome", exact: true }).fill("CODIGO-QUE-NAO-EXISTE-99999");
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
    await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toHaveValue("CODIGO-QUE-NAO-EXISTE-99999");

    const depoisCount = await prisma.mapaPagamentoItem.count({ where: { ciclo: e2eCiclo(), projetistaCodigo: "CODIGO-QUE-NAO-EXISTE-99999" } });
    expect(depoisCount).toBe(0);

    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.request.post("/api/auth/logout");
  });
  test("PAINEL: Adicionar abre o painel lateral (não modal central), sem Voltar; Cancelar/Esc/X fecham sem criar e devolvem o foco", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await abrirNovoPagamento(page);
    const painel = painelNovo(page);
    await expect(painel).toBeVisible();
    const caixa = await painel.locator("aside").boundingBox();
    expect(Math.round(caixa!.x + caixa!.width)).toBe(1440);
    expect(caixa!.width).toBeGreaterThanOrEqual(820);
    expect(caixa!.width).toBeLessThanOrEqual(960);
    await expect(painel.getByText("Novo fornecedor no ciclo")).toBeVisible();
    await expect(painel.getByRole("button", { name: "Voltar ao fornecedor" })).toHaveCount(0);
    // Sem fornecedor: resumo oculto e estados vazios informativos (nada fictício).
    await expect(painel.getByLabel("Resumo do pagamento")).toHaveCount(0);
    await expect(painel.getByText("Calculado automaticamente após salvar e vincular documentos medidos.")).toBeVisible();
    await expect(painel.getByText("Nenhum desconto aplicado.")).toBeVisible();
    await expect(painel.getByText(/Nenhum documento medido adicionado/)).toBeVisible();
    await expect(painel.getByText("Divergências da Medição")).toHaveCount(0);
    for (const secao of ["Identificação", "Participação por contrato", "Condição fixa", "Descontos", "Documentos medidos"]) {
      await expect(painel.getByRole("heading", { name: secao, exact: true })).toBeVisible();
    }
    await painel.getByRole("button", { name: "Adicionar linha" }).click();
    await expect(painel.getByPlaceholder("SE-001")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const antes = await prisma.mapaPagamentoItem.count({ where: { ciclo: e2eCiclo() } });
    const adicionar = page.getByRole("button", { name: "Adicionar" });

    await painel.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(painel).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /^Detalhe de / })).toHaveCount(0);
    await expect(adicionar).toBeFocused();

    await adicionar.click();
    await expect(painel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(painel).toHaveCount(0);

    await adicionar.click();
    await painel.getByRole("button", { name: "Fechar" }).click();
    await expect(painel).toHaveCount(0);
    expect(await prisma.mapaPagamentoItem.count({ where: { ciclo: e2eCiclo() } })).toBe(antes);
    await page.request.post("/api/auth/logout");
  });

  test("MOBILE: painel de cadastro em tela cheia, sem overflow, com Cancelar/Cadastrar acessíveis", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrirNovoPagamento(page);
    const caixa = await painelNovo(page).locator("aside").boundingBox();
    expect(Math.round(caixa!.width)).toBe(375);
    await expect(painelNovo(page).getByRole("button", { name: "Cadastrar", exact: true })).toBeInViewport();
    await expect(painelNovo(page).getByRole("button", { name: "Cancelar", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.request.post("/api/auth/logout");
  });

  test("CONDICIONAL_PRODUCAO: seleção mostra com/sem produção e aplica o valor conforme houver documentos (sem cadastrar)", async ({ page }) => {
    const sufixo = randomUUID().slice(0, 6).toUpperCase();
    const codigo = `E2E-COND-${sufixo}`;
    const nome = `E2E Condicional ${sufixo}`;
    const profissional = await prisma.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: nome } });
    const cadastro = await prisma.cadastroFornecedor.create({
      data: {
        cnpjNormalizado: "99888777000155", cnpj: "99888777000155", colaboradorCodigo: codigo, responsavel: nome, razaoSocial: `${nome} LTDA`,
        tipoCondicaoFixa: "CONDICIONAL_PRODUCAO", valorCondicaoFixaComProducao: 1000, valorCondicaoFixaSemProducao: 400, rawPayload: {},
      },
    });
    try {
      await abrirNovoPagamento(page);
      const painel = painelNovo(page);
      await painel.getByRole("textbox", { name: "Nome", exact: true }).fill(codigo);
      await painel.getByRole("button", { name: new RegExp(nome) }).click();
      const info = painel.getByTestId("condicao-condicional");
      await expect(info).toContainText("R$ 1.000,00");
      await expect(info).toContainText("R$ 400,00");
      await expect(info).toContainText("aplicado: sem produção");
      await expect(painel.getByLabel("Valor fixo mensal/contratual")).toHaveValue(/^R\$\s400,00$/);

      await painel.getByRole("button", { name: "Adicionar linha" }).click();
      const docRow = painel.locator("tbody tr").filter({ has: page.getByPlaceholder("SE-001") });
      await docRow.getByPlaceholder("0", { exact: true }).first().fill("1");
      await docRow.getByPlaceholder("100").fill("100");
      await docRow.getByPlaceholder("0", { exact: true }).last().fill("50");
      await expect(info).toContainText("aplicado: com produção");
      await expect(painel.getByLabel("Valor fixo mensal/contratual")).toHaveValue(/^R\$\s1\.000,00$/);

      await painel.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(painel).toHaveCount(0);
      expect(await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: codigo } })).toBe(0);
    } finally {
      await prisma.cadastroFornecedor.deleteMany({ where: { id: cadastro.id } });
      await prisma.profissional.deleteMany({ where: { id: profissional.id } });
    }
    await page.request.post("/api/auth/logout");
  });
  test("AUTOCOMPLETE: identidades distintas nunca são fundidas (nome parecido/CNPJ compartilhado); origem diferenciada; seleção não herda dados; cabeçalho só com a escolha", async ({ page }) => {
    const S = randomUUID().slice(0, 5).toUpperCase();
    const CNPJ = "55591066000195";
    const legado = await prisma.profissional.create({ data: { nome: `RONALD LEAL ${S}` } }); // codigo NULL, sem cadastro
    const adminCodigo = `RONALD RAFAEL SILVA LEAL ${S}`;
    const admin = await prisma.profissional.create({ data: { nome: adminCodigo, codigo: adminCodigo, nomeCompleto: adminCodigo, razaoSocial: `RR LEAL ENGENHARIA ${S} LTDA`, cnpj: CNPJ } });
    const ramosCodigo = `RONALDO RAMOS ${S}`;
    const ramos = await prisma.profissional.create({ data: { nome: ramosCodigo, codigo: ramosCodigo, nomeCompleto: ramosCodigo, razaoSocial: `RAMOS ${S} LTDA`, cnpj: CNPJ } });
    const inativoCodigo = `RONALD INATIVO ${S}`;
    const inativo = await prisma.profissional.create({ data: { nome: inativoCodigo, codigo: inativoCodigo, nomeCompleto: inativoCodigo } });
    const cadastros = await Promise.all([
      prisma.cadastroFornecedor.create({ data: { cnpjNormalizado: CNPJ, cnpj: CNPJ, colaboradorCodigo: adminCodigo, responsavel: adminCodigo, razaoSocial: `RR LEAL ENGENHARIA ${S} LTDA`, rawPayload: {} } }),
      prisma.cadastroFornecedor.create({ data: { cnpjNormalizado: CNPJ, cnpj: CNPJ, colaboradorCodigo: ramosCodigo, responsavel: ramosCodigo, razaoSocial: `RAMOS ${S} LTDA`, rawPayload: {} } }),
      prisma.cadastroFornecedor.create({ data: { cnpjNormalizado: "11111111000111", colaboradorCodigo: inativoCodigo, responsavel: inativoCodigo, razaoSocial: "Inativo LTDA", ativo: false, inativadoAt: new Date(), rawPayload: {} } }),
    ]);
    try {
      await abrirNovoPagamento(page);
      const painel = painelNovo(page);
      const nome = painel.getByRole("textbox", { name: "Nome", exact: true });
      await nome.fill(S);
      const sugestoes = painel.locator("button").filter({ has: page.getByTestId("sugestao-origem") });

      // A/F/G: três identidades distintas → três sugestões (nome parecido e CNPJ compartilhado não fundem);
      // inativo continua fora de novas operações (regra atual do /api/profissionais).
      await expect(sugestoes).toHaveCount(3);
      await expect(sugestoes.filter({ hasText: inativoCodigo })).toHaveCount(0);

      // B: identidade administrativa mostra nome, empresa e CNPJ + marca "Cadastro administrativo".
      const sAdmin = sugestoes.filter({ hasText: adminCodigo });
      await expect(sAdmin).toContainText(`RR LEAL ENGENHARIA ${S} LTDA · 55.591.066/0001-95`);
      await expect(sAdmin).toContainText("Cadastro administrativo");
      // C: legado marcado, sem empresa/CNPJ inventados.
      const sLegado = sugestoes.filter({ hasText: `RONALD LEAL ${S}` }).filter({ hasNotText: "RAFAEL" });
      await expect(sLegado).toContainText("Legado · sem cadastro administrativo");
      await expect(sLegado).not.toContainText("55.591.066");
      await expect(sugestoes.filter({ hasText: ramosCodigo })).toContainText("Cadastro administrativo");

      // H (antes da seleção): cabeçalho nunca mostra o texto digitado.
      await expect(painel.getByText("Novo fornecedor no ciclo")).toBeVisible();

      // D: selecionar a identidade administrativa preenche os dados dela.
      await sAdmin.click();
      await expect(nome).toHaveValue(adminCodigo);
      await expect(painel.getByRole("textbox", { name: "CNPJ" })).toHaveValue("55.591.066/0001-95");
      await expect(painel.getByRole("textbox", { name: "Razão social" })).toHaveValue(`RR LEAL ENGENHARIA ${S} LTDA`);
      await expect(painel.getByText(adminCodigo, { exact: true }).first()).toBeVisible();
      await expect(painel.getByTestId("aviso-sem-cadastro")).toHaveCount(0);

      // E: trocar para o legado NÃO herda CNPJ/Razão social da identidade anterior; aviso discreto.
      await nome.fill(S);
      await sugestoes.filter({ hasText: `RONALD LEAL ${S}` }).filter({ hasNotText: "RAFAEL" }).click();
      await expect(nome).toHaveValue(`RONALD LEAL ${S}`);
      await expect(painel.getByRole("textbox", { name: "CNPJ" })).toHaveValue("");
      await expect(painel.getByRole("textbox", { name: "Razão social" })).toHaveValue("");
      await expect(painel.getByTestId("aviso-sem-cadastro")).toHaveText("Sem cadastro administrativo vinculado.");
      // H: cabeçalho mostra só a identidade escolhida (legado) e a marca de legado.
      await expect(painel.getByText(`RONALD LEAL ${S}`, { exact: true }).first()).toBeVisible();
      await expect(painel.getByText(/Legado · sem cadastro administrativo/).first()).toBeVisible();
      await expect(painel.getByText(adminCodigo, { exact: true })).toHaveCount(0);

      await painel.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(painel).toHaveCount(0);
      expect(await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: { in: [`RONALD LEAL ${S}`, adminCodigo, ramosCodigo] } } })).toBe(0);
    } finally {
      await prisma.cadastroFornecedor.deleteMany({ where: { id: { in: cadastros.map((c) => c.id) } } });
      await prisma.profissional.deleteMany({ where: { id: { in: [legado.id, admin.id, ramos.id, inativo.id] } } });
    }
    await page.request.post("/api/auth/logout");
  });
});
