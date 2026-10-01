import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { PagamentosPage } from "./pages/pagamentos-page";
import { PortalPage } from "./pages/portal-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Divergências da Medição — análise por DOCUMENTO, com o caso real reportado: máscara oficial
 * "Mascara_Conferencia_Medicao.xlsx" (aba Documentos) enviada pelo Portal (API real de upload) e
 * analisada pela Equipe em Fornecedores → Editar pagamento (rotas reais incluir/descartar).
 *  - NR-TESTE: arquivo A1 · 1 · 100 · DOC × equipe A1 · 2 · 100 · DOC → só A1eq/HH diverge;
 *  - NR-002:   arquivo A1 · 1 · 50 · DOC  × equipe A3 · 2 · 100 · DG  → 4 campos, UM documento;
 *  - NR-NOVO:  só no arquivo (documento novo do fornecedor).
 * Fornecedor dedicado, criado e removido aqui (o seed também limpa o prefixo).
 */

const NOME = "E2E Divergencia Fornecedor";
const USUARIO = "P0909963";
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;
const S = randomBytes(3).toString("hex").toUpperCase();
const ARQUIVO = "tests/fixtures/e2e/conferencia/Mascara_Conferencia_Medicao.xlsx";

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let profissionalId = "";

async function limpar() {
  const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: USUARIO }, select: { id: true } });
  await prisma.sgcLog.deleteMany({ where: { sgcId: { in: sgcs.map((s) => s.id) } } });
  await prisma.divergenciaMedicao.deleteMany({ where: { colaboradorCodigo: USUARIO } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: USUARIO } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: USUARIO } });
  const profissionais = await prisma.profissional.findMany({ where: { codigo: USUARIO }, select: { id: true } });
  const medicoes = await prisma.medicao.findMany({ where: { idProfissional: { in: profissionais.map((p) => p.id) } }, select: { idProjeto: true } });
  await prisma.medicao.deleteMany({ where: { idProfissional: { in: profissionais.map((p) => p.id) } } });
  await prisma.projeto.deleteMany({ where: { OR: [{ codigoProjeto: { startsWith: "PRJ-DIV-RD-" } }, { id: { in: medicoes.map((m) => m.idProjeto) }, codigoProjeto: { startsWith: "MANUAL-" } }] } });
  await prisma.profissional.deleteMany({ where: { codigo: USUARIO } });
  await prisma.usuario.deleteMany({ where: { usuario: USUARIO, nome: NOME } });
}

async function entrar(page: Page, usuario: string, senha: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(usuario, senha);
}

async function abrirEditor(page: Page) {
  await entrar(page, e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
  const pagamentos = new PagamentosPage(page);
  await pagamentos.goto();
  await pagamentos.selectCiclo(ciclo);
  await pagamentos.abrirEditarPagamento(NOME);
  await expect(page.getByTestId("divergencias-medicao")).toBeVisible();
  return pagamentos;
}

const medicaoDoc = (numeroDocumento: string) => prisma.medicao.findFirstOrThrow({ where: { idProfissional: profissionalId, numeroDocumento } });

test.beforeAll(async ({ browser }) => {
  await assertConnectedToE2eDatabase();
  const existente = await prisma.usuario.findUnique({ where: { usuario: USUARIO } });
  if (existente && existente.nome !== NOME) throw new Error(`${USUARIO} já pertence a outro usuário E2E — escolha outro código.`);
  await limpar();
  await prisma.usuario.create({ data: { usuario: USUARIO, nome: NOME, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });

  const page = await browser.newPage();
  await entrar(page, USUARIO, SENHA);
  ciclo = (await (await page.request.get("/api/colaborador/me")).json()).cicloAtivo;
  await page.request.post("/api/auth/logout");
  await page.close();

  const profissional = await prisma.profissional.create({ data: { codigo: USUARIO, nome: NOME, nomeCompleto: NOME, razaoSocial: `${NOME} LTDA` } });
  profissionalId = profissional.id;
  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `PRJ-DIV-RD-${S}`, contrato: `CTO DIV ${S}` } });
  for (const [numeroDocumento, formato, a1, pct, tipo2] of [["NR-TESTE", "A1", 2, 1, "DOC"], ["NR-002", "A3", 2, 1, "DG"]] as const) {
    await prisma.medicao.create({ data: { numeroMedicao: "BM01", idProjeto: projeto.id, idProfissional: profissional.id, ciclo, numeroDocumento, formato, equivalenteA1Horas: a1, percentualEmissao: pct, tipo2, condicao: "100", sourceRowHash: `e2e-div-rd-${S}-${numeroDocumento}` } });
  }
  await prisma.mapaPagamentoItem.create({ data: { ciclo, ordem: 9963, projetistaCodigo: USUARIO, responsavel: NOME, razaoSocial: `${NOME} LTDA`, valor: 400, sourceRowHash: `e2e-div-rd-${USUARIO}-${S}` } });
  await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: USUARIO, colaboradorNome: NOME, ciclo, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" } });
});

test.afterAll(async () => {
  await limpar();
});

test.describe.serial("Divergências da Medição — análise por documento (caso real Mascara_Conferencia_Medicao.xlsx)", () => {
  test("fornecedor envia a máscara real pelo Portal → 3 documentos com divergência gravados", async ({ page }) => {
    await entrar(page, USUARIO, SENHA);
    const portal = new PortalPage(page);
    await portal.goto();
    await portal.uploadMascara(ARQUIVO);
    await portal.expectEmAnalise();
    const divergencias = await prisma.divergenciaMedicao.findMany({ where: { colaboradorCodigo: USUARIO, ciclo }, orderBy: { nrVale: "asc" } });
    expect(divergencias.map((d) => d.nrVale)).toEqual(["NR-002", "NR-NOVO", "NR-TESTE"]);
  });

  test("NR-TESTE: 5 campos, só A1eq/HH divergente (equipe 2 × fornecedor 1); NR-002 é UM documento com 4 campos; NR-NOVO não existe na equipe", async ({ page }) => {
    const pagamentos = await abrirEditor(page);
    await expect(page.getByTestId("divergencias-resumo")).toHaveText("3 documentos com divergência · 3 pendentes · 0 resolvidos");
    await expect(page.getByTestId("divergencias-arquivo")).toContainText("Mascara_Conferencia_Medicao.xlsx");
    await expect(page.getByTestId("divergencia-documento")).toHaveCount(3);

    const teste = await pagamentos.abrirDivergencia("NR-TESTE");
    const linhas = teste.getByTestId("divergencia-comparacao").locator("tbody tr");
    await expect(linhas).toHaveCount(5);
    for (const [campo, status] of [["nrVale", "IGUAL"], ["formato", "IGUAL"], ["a1eqHh", "DIVERGENTE"], ["percentualEmissao", "IGUAL"], ["tipo", "IGUAL"]] as const) {
      await expect(teste.locator(`tr[data-campo="${campo}"]`)).toHaveAttribute("data-status-campo", status);
    }
    const a1 = teste.locator('tr[data-campo="a1eqHh"] td');
    await expect(a1.nth(0)).toHaveText("2");
    await expect(a1.nth(1)).toHaveText("1");
    await expect(a1.nth(2)).toHaveText("Divergente");
    await expect(teste.locator('tr[data-campo="percentualEmissao"] td').nth(0)).toHaveText("100%");
    await expect(teste.getByTestId("divergencia-resumo")).toHaveText("A1eq/HH diverge: a equipe possui 2 e o fornecedor informou 1.");
    await expect(teste).toContainText("1 campo divergente");

    const n002 = await pagamentos.abrirDivergencia("NR-002");
    await expect(n002.locator('tr[data-status-campo="DIVERGENTE"]')).toHaveCount(4);
    await expect(n002.locator('tr[data-campo="nrVale"]')).toHaveAttribute("data-status-campo", "IGUAL");
    await expect(n002).toContainText("4 campos divergentes");

    const novo = await pagamentos.abrirDivergencia("NR-NOVO");
    await expect(novo).toContainText("Documento novo do fornecedor");
    await expect(novo.getByTestId("divergencia-resumo")).toHaveText("Documento esperado pelo fornecedor não localizado na medição.");
    await expect(novo.getByTestId("divergencia-comparacao")).toContainText("Não existe na medição da equipe");
    await expect(novo).not.toContainText("undefined");
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: comparação sem rolagem horizontal; tabela só no desktop`, async ({ page }) => {
      // A tabela de Fornecedores vira lista no celular: abre o editor no desktop e então redimensiona.
      const pagamentos = await abrirEditor(page);
      await page.setViewportSize({ width: largura, height: 900 });
      const card = await pagamentos.abrirDivergencia("NR-TESTE");
      if (largura < 768) {
        await expect(card.getByTestId("divergencia-comparacao-mobile")).toBeVisible();
        await expect(card.getByTestId("divergencia-comparacao")).toBeHidden();
      } else {
        await expect(card.getByTestId("divergencia-comparacao")).toBeVisible();
      }
      const sem = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(sem, "sem rolagem horizontal na página").toBe(true);
      const caixa = await card.boundingBox();
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(largura + 1);
    });
  }

  test("decisões reais: aceitar (uma requisição, loading, valor final), manter (motivo obrigatório) e incluir documento novo", async ({ page }) => {
    const pagamentos = await abrirEditor(page);
    let incluirRequests = 0;
    await page.route("**/api/admin/conferencia/*/incluir", async (route) => {
      incluirRequests += 1;
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });

    // NR-TESTE — Aceitar dados do fornecedor (rota incluir): atualiza só A1eq/HH para 1.
    const teste = await pagamentos.abrirDivergencia("NR-TESTE");
    await teste.getByLabel("Observação da análise").fill("Conferido com o fornecedor: A1eq/HH correto é 1.");
    await teste.getByRole("button", { name: "Aceitar dados do fornecedor" }).click();
    const dialogo = page.getByRole("alertdialog", { name: "Aceitar dados do fornecedor" });
    await expect(dialogo).toContainText("NR-TESTE");
    await expect(dialogo.locator("tbody tr")).toHaveCount(1);
    await expect(dialogo.locator("tbody tr")).toContainText("A1eq/HH21");
    await dialogo.getByRole("button", { name: "Aceitar dados do fornecedor" }).dblclick();
    await expect(dialogo.getByRole("button", { name: "Registrando..." })).toBeDisabled();
    await expect(dialogo).toHaveCount(0);
    await expect(pagamentos.divergenciaCard("NR-TESTE")).toHaveAttribute("data-status", "INCLUIDA");
    expect(incluirRequests).toBe(1);
    const medTeste = await medicaoDoc("NR-TESTE");
    expect([medTeste.formato, Number(medTeste.equivalenteA1Horas), Number(medTeste.percentualEmissao), medTeste.tipo2]).toEqual(["A1", 1, 1, "DOC"]);
    const resolvido = await pagamentos.abrirDivergencia("NR-TESTE");
    await expect(resolvido.getByTestId("divergencia-decisao")).toContainText("Aceitar dados do fornecedor");
    await expect(resolvido.getByTestId("divergencia-decisao")).toContainText("A1eq/HH: 1");
    await expect(resolvido.getByTestId("divergencia-decisao")).toContainText("Conferido com o fornecedor: A1eq/HH correto é 1.");
    await expect(resolvido.getByTestId("divergencia-decisao")).toContainText("Resolvido por");

    // NR-002 — Manter dados da equipe (rota descartar): bloqueado sem motivo; a medição não muda.
    await pagamentos.expectDescartarDesabilitado("NR-002");
    await pagamentos.descartarDivergencia("NR-002", "Arquivo do fornecedor desatualizado.");
    await expect(pagamentos.divergenciaCard("NR-002")).toHaveAttribute("data-status", "DESCARTADA");
    const med002 = await medicaoDoc("NR-002");
    expect([med002.formato, Number(med002.equivalenteA1Horas), Number(med002.percentualEmissao), med002.tipo2]).toEqual(["A3", 2, 1, "DG"]);

    // NR-NOVO — Incluir documento na medição (rota incluir): cria o documento com os dados do arquivo.
    await pagamentos.incluirDivergencia("NR-NOVO");
    await expect(pagamentos.divergenciaCard("NR-NOVO")).toHaveAttribute("data-status", "INCLUIDA");
    const medNovo = await medicaoDoc("NR-NOVO");
    expect([medNovo.formato, Number(medNovo.equivalenteA1Horas), Number(medNovo.percentualEmissao), medNovo.tipo2]).toEqual(["A1", 3, 1, "DOC"]);

    await expect(page.getByTestId("divergencias-resumo")).toHaveText("3 documentos com divergência · 0 pendentes · 3 resolvidos");
    await expect(page.getByText("Todas as divergências foram resolvidas.")).toBeVisible();
    const divergencias = await prisma.divergenciaMedicao.findMany({ where: { colaboradorCodigo: USUARIO, ciclo }, orderBy: { nrVale: "asc" } });
    expect(divergencias.map((d) => [d.nrVale, d.status, d.observacao])).toEqual([
      ["NR-002", "DESCARTADA", "Arquivo do fornecedor desatualizado."],
      ["NR-NOVO", "INCLUIDA", null],
      ["NR-TESTE", "INCLUIDA", "Conferido com o fornecedor: A1eq/HH correto é 1."],
    ]);
    const sgc = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: USUARIO, ciclo } } });
    expect(sgc.statusConferencia).toBe("CONCLUIDA");
  });
});
