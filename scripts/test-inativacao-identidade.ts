import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { assertConnectedToE2eDatabase, prismaTest } from "../lib/prisma-test";

async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const service = await import("../lib/cadastro-fornecedor");
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const codigo = `TESTE INATIVACAO ${suffix}`;
  const nome = `Fornecedor Inativacao ${suffix}`;
  const login = `P0${String(Date.now()).slice(-6)}`;
  const actor = { id: randomUUID(), usuario: "P0000001", nome: "ADMIN TESTE" };
  let cadastroId = "";
  let profissionalId = "";
  let usuarioId = "";
  let reparadoId = "";
  const missingCodigo = `${codigo} AUSENTE`;
  let missingCadastroId = "";

  try {
    const profissional = await prismaTest.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: nome } });
    profissionalId = profissional.id;
    const cadastro = await prismaTest.cadastroFornecedor.create({
      data: { cnpjNormalizado: "11111111000199", colaboradorCodigo: codigo, responsavel: nome, razaoSocial: nome, rawPayload: {} },
    });
    cadastroId = cadastro.id;
    const usuario = await prismaTest.usuario.create({
      data: { usuario: login, nome, senhaHash: "hash-preservado", senhaTemporaria: "TEMP-PRESERVADA", primeiroLogin: true, perfil: "COLABORADOR" },
    });
    usuarioId = usuario.id;

    await service.setFornecedoresAtivos([cadastroId], false, actor);
    const [inativo, acessoInativo, profissionalPreservado, auditInativo] = await Promise.all([
      prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroId } }),
      prismaTest.usuario.findUniqueOrThrow({ where: { id: usuarioId } }),
      prismaTest.profissional.findUniqueOrThrow({ where: { id: profissionalId } }),
      prismaTest.adminAuditLog.findFirst({ where: { action: "FORNECEDOR_INATIVADO", targetId: cadastroId } }),
    ]);
    assert.equal(inativo.ativo, false);
    assert.ok(inativo.inativadoAt);
    assert.equal(acessoInativo.ativo, false);
    assert.equal(acessoInativo.excluidoAt, null);
    assert.equal(acessoInativo.senhaHash, "hash-preservado");
    assert.equal(acessoInativo.senhaTemporaria, "TEMP-PRESERVADA");
    assert.equal(acessoInativo.primeiroLogin, true);
    assert.equal(profissionalPreservado.deletedAt, null);
    assert.equal(profissionalPreservado.nome, codigo);
    assert.ok(auditInativo);

    await service.setFornecedoresAtivos([cadastroId], true, actor);
    const [reativado, acessoReativado, countProfissionais, auditReativado] = await Promise.all([
      prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroId } }),
      prismaTest.usuario.findUniqueOrThrow({ where: { id: usuarioId } }),
      prismaTest.profissional.count({ where: { codigo } }),
      prismaTest.adminAuditLog.findFirst({ where: { action: "FORNECEDOR_REATIVADO", targetId: cadastroId } }),
    ]);
    assert.equal(reativado.ativo, true);
    assert.equal(reativado.inativadoAt, null);
    assert.equal(acessoReativado.ativo, true);
    assert.equal(acessoReativado.excluidoAt, null);
    assert.equal(acessoReativado.primeiroLogin, true);
    assert.equal(countProfissionais, 1);
    assert.ok(auditReativado);

    const missingCadastro = await prismaTest.cadastroFornecedor.create({
      data: { cnpjNormalizado: "11111111000199", colaboradorCodigo: missingCodigo, responsavel: `${nome} Ausente`, razaoSocial: nome, rawPayload: {} },
    });
    missingCadastroId = missingCadastro.id;
    const inconsistencias = await service.auditActiveCadastroIdentityInconsistencies();
    assert.ok(inconsistencias.some((item) => item.cadastroId === missingCadastroId));
    const reconciliado = await service.reconcileActiveCadastroIdentity(missingCadastroId, actor);
    assert.equal(reconciliado.created, true);
    reparadoId = reconciliado.profissionalId;
    assert.notEqual(reparadoId, profissionalId);
    assert.equal((await prismaTest.profissional.findUniqueOrThrow({ where: { id: reparadoId } })).codigo, missingCodigo);
    assert.ok(await prismaTest.adminAuditLog.findFirst({ where: { action: "FORNECEDOR_IDENTIDADE_RECONCILIADA", targetId: reparadoId } }));
    assert.ok(!(await service.auditActiveCadastroIdentityInconsistencies()).some((item) => item.cadastroId === missingCadastroId));

    console.log("PASS: inativação, reativação, preservação de acesso/Profissional e reconciliação explícita.");
  } finally {
    await prismaTest.adminAuditLog.deleteMany({ where: { OR: [{ targetId: { in: [cadastroId, missingCadastroId, reparadoId].filter(Boolean) } }, { targetCodigo: { in: [codigo, missingCodigo] } }] } });
    if (missingCadastroId) await prismaTest.cadastroFornecedor.deleteMany({ where: { id: missingCadastroId } });
    if (cadastroId) await prismaTest.cadastroFornecedor.deleteMany({ where: { id: cadastroId } });
    if (reparadoId) await prismaTest.profissional.deleteMany({ where: { id: reparadoId } });
    if (profissionalId) await prismaTest.profissional.deleteMany({ where: { id: profissionalId } });
    if (usuarioId) await prismaTest.usuario.deleteMany({ where: { id: usuarioId } });
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
