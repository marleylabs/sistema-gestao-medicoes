import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Isolamento entre fornecedores homônimos (spec docs/brain/specs/p1-escopo-fornecedor-por-identidade.md, T5).
 * B tem uma linha no mapa cujo responsável é o nome de A (vetor V1) e um nomeCompleto igual ao nome
 * do Profissional de A (V3). A nunca pode ver BM, NF, comprovante, documentos ou chat de B.
 */

const SUF = randomBytes(3).toString("hex").toUpperCase();
const SENHA = `E2e-${randomBytes(6).toString("hex")}`;
// Decisão 012: o código do fornecedor é o login (P0).
const A = { login: "P0909971", nome: `E2E Homonimo A ${SUF}`, codigo: "P0909971" };
const B = { login: "P0909972", nome: `E2E Homonimo B ${SUF}`, codigo: "P0909972" };
const NOME_PROFISSIONAL_A = `E2E HOMONIMO ${SUF}`;
const DOC_B = `DOC-B-${SUF}`;
const CHAT_B = `Mensagem privada de B ${SUF}`;

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

let ciclo = "";
let sgcA = "";
let sgcB = "";
let projetoId = "";

async function limpar() {
  const codigos = [A.codigo, B.codigo];
  const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: { in: codigos } }, select: { id: true } });
  await prisma.sgcLog.deleteMany({ where: { sgcId: { in: sgcs.map((s) => s.id) } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { in: codigos } } });
  await prisma.medicao.deleteMany({ where: { numeroMedicao: { startsWith: `E2E-HOM-${SUF}` } } });
  if (projetoId) await prisma.projeto.deleteMany({ where: { id: projetoId } });
  await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
  await prisma.usuario.deleteMany({ where: { usuario: { in: [A.login, B.login] }, nome: { startsWith: "E2E Homonimo" } } });
  await prisma.profissional.deleteMany({ where: { codigo: { in: codigos } } });
}

async function entrar(page: Page, login: string, senha = SENHA) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(login, senha);
}

test.beforeAll(async ({ browser }) => {
  await assertConnectedToE2eDatabase();
  for (const u of [A, B]) {
    const existente = await prisma.usuario.findUnique({ where: { usuario: u.login } });
    if (existente && existente.nome !== u.nome && !existente.nome.startsWith("E2E Homonimo")) {
      throw new Error(`${u.login} já pertence a outro usuário E2E — escolha outro código.`);
    }
    await prisma.usuario.deleteMany({ where: { usuario: u.login } });
  }
  await limpar();

  await prisma.profissional.create({ data: { codigo: A.codigo, nome: NOME_PROFISSIONAL_A } });
  // V3: o nomeCompleto de B é o nome do Profissional de A.
  const profissionalB = await prisma.profissional.create({ data: { codigo: B.codigo, nome: `E2E OUTRO ${SUF}`, nomeCompleto: NOME_PROFISSIONAL_A } });
  for (const u of [A, B]) {
    await prisma.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: u.codigo, responsavel: u.nome, razaoSocial: `${u.nome} LTDA` } });
    await prisma.usuario.create({ data: { usuario: u.login, nome: u.nome, perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA), ativo: true } });
  }

  // Ciclo publicado no portal é decidido pelo servidor (lib/ciclo-ativo.ts).
  const page = await browser.newPage();
  await entrar(page, A.login);
  ciclo = (await (await page.request.get("/api/colaborador/me")).json()).cicloAtivo;
  await page.request.post("/api/auth/logout");
  await page.close();

  await prisma.mapaPagamentoItem.createMany({
    data: [
      { ciclo, ordem: 9971, projetistaCodigo: A.codigo, responsavel: A.nome, valor: 100, sourceRowHash: `e2e-hom-a-${SUF}` },
      // V1: linha de B com o nome de A como responsável.
      { ciclo, ordem: 9972, projetistaCodigo: B.codigo, responsavel: A.nome, valor: 999, sourceRowHash: `e2e-hom-b-${SUF}` },
    ],
  });
  projetoId = (await prisma.projeto.create({ data: { codigoProjeto: `E2E-HOM-${SUF}-PROJ`, contrato: "TESTE" } })).id;
  await prisma.medicao.create({
    data: {
      numeroMedicao: `E2E-HOM-${SUF}-B`, numeroDocumento: DOC_B, idProjeto: projetoId, idProfissional: profissionalB.id, ciclo,
      equivalenteA1Horas: 1, percentualEmissao: 1, condicao: "100", sourceRowHash: `e2e-hom-med-b-${SUF}`,
    },
  });
  sgcA = (await prisma.sgcAprovacaoMedicao.create({
    data: { colaboradorCodigo: A.codigo, colaboradorNome: A.nome, ciclo, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
  })).id;
  sgcB = (await prisma.sgcAprovacaoMedicao.create({
    data: {
      colaboradorCodigo: B.codigo, colaboradorNome: B.nome, ciclo, status: "PAGO", statusConferencia: "CONCLUIDA", aprovadoAt: new Date(),
      nfArquivo: Buffer.from("%PDF-NF-B"), nfArquivoNome: "nf-b.pdf",
      comprovanteArquivo: Buffer.from("%PDF-COMP-B"), comprovanteArquivoNome: "comprovante-b.pdf",
    },
  })).id;
  await prisma.sgcLog.create({ data: { sgcId: sgcB, colaboradorCodigo: B.codigo, ciclo, acao: "SOLICITAR_REVISAO", observacao: CHAT_B } });
});

test.afterAll(async () => {
  await limpar();
});

test.describe.serial("Isolamento entre fornecedores homônimos", () => {
  test("A vê só o próprio BM e documentos no portal", async ({ page }) => {
    await entrar(page, A.login);
    const me = await (await page.request.get("/api/colaborador/me")).json();
    expect(me.sgc.id).toBe(sgcA);
    expect(me.usuario.razaoSocial).toBe(`${A.nome} LTDA`); // cadastro do escopo, nunca o de B
    const texto = JSON.stringify(me);
    expect(texto).not.toContain(B.codigo);
    expect(texto).not.toContain(DOC_B);

    await page.goto("/");
    await expect(page.getByTestId("portal-bm-valor")).toHaveText("R$ 100,00");
  });

  test("Minhas Medições de A não lista o BM pago de B", async ({ page }) => {
    await entrar(page, A.login);
    const { medicoes } = await (await page.request.get("/api/colaborador/medicoes")).json();
    expect(JSON.stringify(medicoes)).not.toContain(sgcB);
  });

  test("NF e comprovante de B são negados para A", async ({ page }) => {
    await entrar(page, A.login);
    expect((await page.request.get(`/api/colaborador/nf/${sgcB}`)).status()).toBe(403);
    expect((await page.request.get(`/api/colaborador/comprovante/${sgcB}`)).status()).toBe(403);
  });

  test("chat de A não importa a conversa de B", async ({ page }) => {
    await entrar(page, A.login);
    const conversas = await (await page.request.get("/api/chat/conversas")).text();
    expect(conversas).not.toContain(CHAT_B);
  });

  test("controle: B abre a própria NF e o próprio comprovante", async ({ page }) => {
    await entrar(page, B.login);
    expect((await page.request.get(`/api/colaborador/nf/${sgcB}`)).status()).toBe(200);
    expect((await page.request.get(`/api/colaborador/comprovante/${sgcB}`)).status()).toBe(200);
  });

  test("A não troca o próprio nome para o de B (o nome é o elo com o cadastro)", async ({ page }) => {
    await entrar(page, A.login);
    const resposta = await page.request.patch("/api/usuario/me", { data: { nome: B.nome } });
    expect(resposta.status()).toBe(403);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { usuario: A.login } })).nome).toBe(A.nome);
    expect((await (await page.request.get("/api/colaborador/me")).json()).sgc.id).toBe(sgcA);
  });

  test("Administrativo renomeia o responsável de A: o usuário acompanha e A segue vendo o próprio BM", async ({ page, browser }) => {
    const novoNome = `${A.nome} Renomeado`;
    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { colaboradorCodigo: A.codigo }, select: { id: true } });
    await entrar(page, e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    const resposta = await page.request.patch(`/api/admin/administrativo/fornecedores/${cadastro.id}`, {
      data: { cnpj: "11222333000181", responsavel: novoNome, razaoSocial: `${A.nome} LTDA` },
    });
    expect(resposta.status()).toBe(200);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { usuario: A.login } })).nome).toBe(novoNome);

    const paginaA = await browser.newPage();
    await entrar(paginaA, A.login);
    expect((await (await paginaA.request.get("/api/colaborador/me")).json()).sgc.id).toBe(sgcA);
    await paginaA.close();
  });
});
