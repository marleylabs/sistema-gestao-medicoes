import { expect, test, type Page } from "@playwright/test";
import { e2eCiclo, e2eUsers } from "./fixtures";
import { LoginPage } from "./pages/login-page";

const FORNECEDOR_NOME = "E2E Fornecedor A";
const APIS_DA_TELA = () => [`/api/mapa-pagamento?ciclo=${e2eCiclo()}`, "/api/sgc/status", "/api/profissionais"];

async function login(page: Page, user: { usuario: string; senha: string }) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(user.usuario, user.senha);
}

function tabelaOperacional(page: Page) {
  return page.getByTestId("fornecedores-tabela");
}

async function semOverflowGlobal(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe("Fornecedores — tabela só de leitura; detalhe (drawer) concentra as ações", () => {
  test("MEDICAO: APIs da tela respondem, KPIs, filtros, busca, drawer e ações permitidas", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, e2eUsers.medicao);

    // Mesma regra da página e das APIs (requireAdmin = MEDICAO/ADMIN): dados chegam para MEDICAO.
    for (const url of APIS_DA_TELA()) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(200);
    }

    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Fornecedores" }).click();
    await expect(page).toHaveURL(/\/fornecedores(\?|$)/);
    await expect(page.getByRole("main").getByRole("heading", { name: "Fornecedores", exact: true })).toBeVisible();

    const kpis = page.getByTestId("fornecedores-kpis");
    for (const label of ["Fornecedores no ciclo", "Pendências da equipe", "Valor medido", "Pagos"]) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    for (const label of ["Ciclo", "Contrato", "Status", "Alocação", "Ordenar por"]) {
      await expect(page.getByRole("combobox", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Adicionar" })).toBeEnabled();

    const linha = tabelaOperacional(page).locator("tr", { hasText: FORNECEDOR_NOME });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText(/R\$\s?[\d.]+,\d{2}/);

    // Tabela só de leitura: sem coluna "Ações", sem botões de workflow e sem menu nas linhas.
    await expect(page.getByRole("columnheader", { name: "Ações" })).toHaveCount(0);
    await expect(tabelaOperacional(page).getByRole("button", { name: /Enviar BM|Reenviar BM|Retornar BM|Mais ações|Editar pagamento|Excluir pagamento/ })).toHaveCount(0);

    // Pesquisa: filtra por nome e mostra estado vazio sem resultado.
    const busca = page.getByPlaceholder("Nome, código ou empresa");
    await busca.fill(FORNECEDOR_NOME);
    await expect(tabelaOperacional(page).locator("tbody tr")).toHaveCount(1);
    await busca.fill("NENHUM-FORNECEDOR-XYZ");
    await expect(page.getByText("Nenhum fornecedor encontrado com os filtros aplicados.")).toBeVisible();
    await busca.fill("");

    // Filtros de status/alocação/ordenação continuam operando sobre a mesma lista.
    const status = page.getByRole("combobox", { name: "Status" });
    const primeiroStatus = await status.locator("option").nth(1).getAttribute("value");
    if (primeiroStatus) {
      await status.selectOption(primeiroStatus);
      await expect(tabelaOperacional(page).locator("tbody tr").first()).toBeVisible();
      await status.selectOption("");
    }
    await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("asc");
    await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("");

    // Ciclo: valor YYMM, rótulo legível (mês/ano · código).
    const ciclo = page.getByRole("combobox", { name: "Ciclo" });
    const cicloAtual = await ciclo.inputValue();
    if (/^\d{4}$/.test(cicloAtual)) {
      await expect(ciclo.locator(`option[value="${cicloAtual}"]`)).toHaveText(new RegExp(`^[A-Z][a-z]{2}/20\\d{2} · ${cicloAtual}$`));
    }

    // Teclado: foco na linha + Enter abre o detalhe.
    await linha.focus();
    await page.keyboard.press("Enter");
    const detalhe = page.getByRole("dialog", { name: `Detalhe de ${FORNECEDOR_NOME}` });
    await expect(detalhe).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detalhe).toHaveCount(0);

    // Clique na linha abre o detalhe com hierarquia e TODAS as ações (mesmas regras de sempre).
    await linha.locator("td:not(:has(input[type=checkbox]))").first().click();
    await expect(detalhe).toBeVisible();
    for (const secao of ["Resumo", "Empresa", "Distribuição por contrato", "Ações"]) {
      await expect(detalhe.getByText(secao, { exact: true })).toBeVisible();
    }
    await detalhe.getByText("Tipos e preços").click();
    if (/Aguardando envio/i.test(await linha.innerText())) {
      await expect(detalhe.getByRole("button", { name: /Enviar BM/ })).toBeVisible();
    }
    await expect(detalhe.getByRole("button", { name: "Excluir pagamento" })).toBeVisible();
    await detalhe.getByRole("button", { name: "Editar pagamento" }).click();
    await expect(page.getByRole("heading", { name: "Editar pagamento" })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("heading", { name: "Editar pagamento" })).toHaveCount(0);
    await expect(detalhe).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detalhe).toHaveCount(0);

    expect(await semOverflowGlobal(page)).toBe(true);
  });

  test("ADMIN: URL direta e refresh funcionam; Dashboard leva a /fornecedores por \"Ver todos\"", async ({ page }) => {
    await login(page, e2eUsers.admin);
    await page.goto("/fornecedores");
    await expect(page.getByRole("main").getByRole("heading", { name: "Fornecedores", exact: true })).toBeVisible();
    await page.reload();
    await expect(tabelaOperacional(page)).toBeVisible();

    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Visão Geral" }).click();
    await expect(page.getByRole("main").getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(tabelaOperacional(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Ver todos" }).click();
    await expect(page).toHaveURL(/\/fornecedores(\?|$)/);
  });

  test("tablet 1024px: tabela cabe sem rolagem local e a linha abre o detalhe", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await login(page, e2eUsers.medicao);
    await page.goto("/fornecedores");
    const tabela = tabelaOperacional(page);
    await expect(tabela.locator("tbody tr").first()).toBeVisible();
    const semRolagemLocal = await tabela.evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth);
    expect(semRolagemLocal).toBe(true);
    await expect(page.getByRole("columnheader", { name: "Ações" })).toHaveCount(0);
    await tabela.locator("tr", { hasText: FORNECEDOR_NOME }).locator("td:not(:has(input[type=checkbox]))").first().click();
    await expect(page.getByRole("dialog", { name: `Detalhe de ${FORNECEDOR_NOME}` })).toBeVisible();
    expect(await semOverflowGlobal(page)).toBe(true);
  });

  test("mobile: KPIs em 2×2, lista compacta abre o detalhe e não há overflow global", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, e2eUsers.medicao);
    await page.goto("/fornecedores");
    const lista = page.getByTestId("fornecedores-lista-mobile");
    await expect(lista).toBeVisible();
    const cards = page.getByTestId("fornecedores-kpis").locator(":scope > *");
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(3)).toBeVisible();
    // offsetTop/offsetLeft: independentes da rolagem do container.
    const caixas = await cards.evaluateAll((els) => els.map((el) => ({ x: (el as HTMLElement).offsetLeft, y: (el as HTMLElement).offsetTop })));
    expect(caixas[0].y).toBe(caixas[1].y);
    expect(caixas[2].y).toBe(caixas[3].y);
    expect(caixas[2].y).toBeGreaterThan(caixas[0].y);
    expect(caixas[1].x).toBeGreaterThan(caixas[0].x);
    await expect(lista.getByRole("button", { name: /Enviar BM|Retornar BM|Editar pagamento/ })).toHaveCount(0);
    await lista.getByRole("button", { name: new RegExp(FORNECEDOR_NOME) }).click();
    const detalhe = page.getByRole("dialog", { name: `Detalhe de ${FORNECEDOR_NOME}` });
    await expect(detalhe).toBeVisible();
    await expect(detalhe.getByRole("button", { name: "Editar pagamento" })).toBeVisible();
    expect(await semOverflowGlobal(page)).toBe(true);
  });

  test("FINANCEIRO: não abre /fornecedores e as APIs da tela continuam negadas", async ({ page }) => {
    await login(page, e2eUsers.financeiro);
    await page.goto("/fornecedores");
    await expect(page).not.toHaveURL(/\/fornecedores/);
    await expect(tabelaOperacional(page)).toHaveCount(0);
    for (const url of APIS_DA_TELA()) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(403);
    }
  });
});
