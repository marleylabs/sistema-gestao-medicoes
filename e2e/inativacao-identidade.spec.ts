import { request as apiRequest, expect, test } from "@playwright/test";

import { e2eUsers } from "./fixtures";
import { LoginPage } from "./pages/login-page";
import { assertConnectedToE2eDatabase, prismaTest as prisma } from "../lib/prisma-test";

test.beforeAll(assertConnectedToE2eDatabase);

test("ADMIN inativa e reativa fornecedor sem tombstone nem perda da política de acesso", async ({ page, baseURL }) => {
  const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: "E2E Fornecedor A" } });
  const profissional = await prisma.profissional.findUniqueOrThrow({ where: { codigo: cadastro.colaboradorCodigo! } });
  const usuarioAntes = await prisma.usuario.findUniqueOrThrow({ where: { usuario: e2eUsers.fornecedorA.usuario } });
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

  try {
    const inativacao = await page.request.post("/api/admin/administrativo/fornecedores/status", {
      data: { ids: [cadastro.id], ativo: false },
    });
    expect(inativacao.ok()).toBeTruthy();

    const [cadastroInativo, usuarioInativo, profissionalPreservado] = await Promise.all([
      prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastro.id } }),
      prisma.usuario.findUniqueOrThrow({ where: { id: usuarioAntes.id } }),
      prisma.profissional.findUniqueOrThrow({ where: { id: profissional.id } }),
    ]);
    expect(cadastroInativo.ativo).toBe(false);
    expect(cadastroInativo.inativadoAt).not.toBeNull();
    expect(usuarioInativo.ativo).toBe(false);
    expect(usuarioInativo.excluidoAt).toBeNull();
    expect(usuarioInativo.primeiroLogin).toBe(usuarioAntes.primeiroLogin);
    expect(usuarioInativo.senhaHash).toBe(usuarioAntes.senhaHash);
    expect(profissionalPreservado.deletedAt).toBeNull();

    const anonymous = await apiRequest.newContext({ baseURL });
    const blockedLogin = await anonymous.post("/api/auth/login", {
      data: { usuario: e2eUsers.fornecedorA.usuario, senha: e2eUsers.fornecedorA.senha },
    });
    expect(blockedLogin.status()).toBe(401);
    await anonymous.dispose();

    const reativacao = await page.request.post("/api/admin/administrativo/fornecedores/status", {
      data: { ids: [cadastro.id], ativo: true },
    });
    expect(reativacao.ok()).toBeTruthy();
    const usuarioReativado = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioAntes.id } });
    expect(usuarioReativado.ativo).toBe(true);
    expect(usuarioReativado.excluidoAt).toBeNull();
    expect(usuarioReativado.primeiroLogin).toBe(usuarioAntes.primeiroLogin);
    expect(await prisma.profissional.count({ where: { codigo: cadastro.colaboradorCodigo } })).toBe(1);
  } finally {
    // Recuperação defensiva do próprio teste caso uma asserção intermediária falhe.
    await prisma.cadastroFornecedor.update({ where: { id: cadastro.id }, data: { ativo: true, inativadoAt: null } });
    await prisma.usuario.update({ where: { id: usuarioAntes.id }, data: { ativo: true, excluidoAt: null } });
  }
});
