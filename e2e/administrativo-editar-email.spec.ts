import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Bug: editar o e-mail no cadastro do fornecedor mudava o cadastro, mas "Enviar primeiro acesso"
 * continuava usando o e-mail antigo, porque o e-mail de acesso (`Usuario.email`) não acompanhava.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 6).toUpperCase();
const NOME = `E2E EMAIL ${S}`;
const login = `P0${990000 + Math.floor(Math.random() * 9000)}`;
let cadastroId = "";

test.beforeAll(async () => {
  await prisma.usuario.create({
    data: { usuario: login, nome: NOME, perfil: "COLABORADOR", senhaHash: "x", ativo: true, primeiroLogin: true, email: `antigo-${S.toLowerCase()}@example.test` },
  });
  cadastroId = (await prisma.cadastroFornecedor.create({
    data: { colaboradorCodigo: login, responsavel: NOME, razaoSocial: `${NOME} LTDA`, cnpjNormalizado: "11222333000181", email: `antigo-${S.toLowerCase()}@example.test` },
  })).id;
});

test.afterAll(async () => {
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: NOME } });
  await prisma.profissional.deleteMany({ where: { codigo: login } });
  await prisma.usuario.deleteMany({ where: { usuario: login } });
});

test("editar o e-mail do cadastro atualiza o e-mail usado no primeiro acesso", async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

  const novo = `novo-${S.toLowerCase()}@example.test`;
  const patch = await page.request.patch(`/api/admin/administrativo/fornecedores/${cadastroId}`, {
    data: { cnpj: "11222333000181", responsavel: NOME, razaoSocial: `${NOME} LTDA`, email: novo },
  });
  expect(patch.status()).toBe(200);

  const lista = await page.request.get("/api/admin/administrativo/fornecedores");
  const cadastros = (await lista.json()) as { id: string; email: string | null; acesso: { email: string | null } | null }[];
  const cadastro = cadastros.find((c) => c.id === cadastroId);
  expect(cadastro?.email).toBe(novo);
  expect(cadastro?.acesso?.email).toBe(novo);
});
