import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prismaTest, assertConnectedToE2eDatabase } from "../lib/prisma-test";

async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  // Só neutraliza o marcador de bundler Next; os serviços e o banco abaixo são REAIS.
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { deleteFornecedoresDefinitivamente, upsertCadastroFornecedor, FornecedorIdentityDeletedError } = require("../lib/cadastro-fornecedor");
  const { resolveFornecedorEmail } = require("../lib/email/resolve-recipients");
  const { serializeMedicao } = require("../lib/format");
  Module._load = originalLoad;

  const id = randomUUID();
  const nome = `TESTE EXCLUSAO NOME ${id}`;
  const codigo = `TESTE-COD-${id}`;
  const admin = { id: randomUUID(), nome: "Administrador de teste", usuario: "TESTE-EXCLUSAO-SERVICE" };
  const profissional = await prismaTest.profissional.create({ data: { nome, nomeCompleto: nome, codigo, statusColaborador: "ATO", email: "exclusao@example.test", cpf: "123", cnpj: "456", razaoSocial: "Teste", funcao: "Teste" } });
  const projeto = await prismaTest.projeto.create({ data: { codigoProjeto: `TESTE-EXCLUSAO-${id}` } });
  const cadastro = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigo, responsavel: nome, razaoSocial: "Teste", cnpjNormalizado: "00000000000000" } });
  const medicao = await prismaTest.medicao.create({ data: { numeroMedicao: id, idProjeto: projeto.id, idProfissional: profissional.id, idCoordenador: profissional.id, valorTotal: 4321, sourceRowHash: id } });
  try {
    // Falha da auditoria após os writes: a transação real deve reverter todos eles.
    const originalTransaction = prismaTest.$transaction.bind(prismaTest);
    (prismaTest as any).$transaction = (callback: any) => originalTransaction(async (tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === "adminAuditLog") return { createMany: async () => { throw new Error("FALHA_AUDITORIA_TESTE"); } };
        return Reflect.get(target, key);
      },
    })));
    try {
      const failed = await deleteFornecedoresDefinitivamente([cadastro.id], admin);
      assert.equal(failed.administrativeDeleted, 0);
      assert.ok(failed.errors.some((e: any) => e.error.includes("FALHA_AUDITORIA_TESTE")));
    } finally { (prismaTest as any).$transaction = originalTransaction; }
    assert.ok(await prismaTest.cadastroFornecedor.findUnique({ where: { id: cadastro.id } }));
    assert.equal((await prismaTest.profissional.findUniqueOrThrow({ where: { id: profissional.id } })).deletedAt, null);
    assert.equal((await prismaTest.medicao.findUniqueOrThrow({ where: { id: medicao.id } })).profissionalNomeSnapshot, null);

    const result = await deleteFornecedoresDefinitivamente([cadastro.id], admin, "Teste controlado");
    assert.equal(result.errors.length, 0);
    assert.equal(result.administrativeDeleted, 1);
    const deleted = await prismaTest.profissional.findUniqueOrThrow({ where: { id: profissional.id } });
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedById, admin.id);
    assert.equal(deleted.nome, `EXCLUIDO-${profissional.id}`);
    for (const field of ["nomeCompleto", "cpf", "cnpj", "email", "razaoSocial", "funcao"] as const) assert.equal(deleted[field], null);
    assert.equal(deleted.statusColaborador, "ATO"); // CHECK real intacta.
    const history = await prismaTest.medicao.findUniqueOrThrow({ where: { id: medicao.id }, include: { profissional: true, coordenador: true } });
    assert.equal(Number(history.valorTotal), 4321);
    assert.equal(history.idProfissional, profissional.id);
    assert.equal(history.profissionalNomeSnapshot, nome);
    assert.equal(history.coordenadorNomeSnapshot, nome);
    assert.equal(serializeMedicao(history).profissional.nome, nome);
    const audit = await prismaTest.adminAuditLog.findFirstOrThrow({ where: { targetId: profissional.id, adminId: admin.id } });
    assert.equal(audit.action, "FORNECEDOR_EXCLUSAO_DEFINITIVA");
    assert.equal(audit.reason, "Teste controlado");
    assert.ok(!JSON.stringify(audit.metadata).includes(nome));
    assert.ok(!JSON.stringify(audit.metadata).includes("exclusao@example.test"));

    // Nome diferente do código também não pode ressuscitar após anonimização.
    await assert.rejects(() => upsertCadastroFornecedor({ responsavel: nome, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste", rawPayload: {} }), FornecedorIdentityDeletedError);
    // Mesmo com cadastro residual e e-mail válido, o estado explícito bloqueia o destinatário.
    await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigo, responsavel: nome, razaoSocial: "Teste", cnpjNormalizado: "00000000000000", email: "exclusao@example.test" } });
    const recipient = await resolveFornecedorEmail(codigo);
    assert.equal(recipient.email, null);
    assert.equal(recipient.missing, true);
    const repeated = await deleteFornecedoresDefinitivamente([cadastro.id], admin);
    assert.equal(repeated.administrativeDeleted, 0);
    assert.ok(repeated.errors.length > 0);
    const legacyName = `TESTE LEGADO ${id}`;
    const legacy = await prismaTest.profissional.create({ data: { nome: legacyName, nomeCompleto: legacyName } });
    const legacyCadastro = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: legacyName, responsavel: legacyName, razaoSocial: "Teste", cnpjNormalizado: "00000000000000" } });
    const legacyMedicao = await prismaTest.medicao.create({ data: { numeroMedicao: `${id}-legacy`, idProjeto: projeto.id, idProfissional: legacy.id, sourceRowHash: `${id}-legacy`, valorTotal: 50 } });
    try {
      const legacyResult = await deleteFornecedoresDefinitivamente([legacyCadastro.id], admin);
      assert.equal(legacyResult.errors.length, 0);
      const tombstone = await prismaTest.profissional.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.ok(tombstone.deletedAt);
      assert.equal(tombstone.codigo, legacyName);
      assert.equal((await prismaTest.medicao.findUniqueOrThrow({ where: { id: legacyMedicao.id } })).profissionalNomeSnapshot, legacyName);
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { id: legacyCadastro.id } });
      await prismaTest.medicao.deleteMany({ where: { id: legacyMedicao.id } });
      await prismaTest.profissional.deleteMany({ where: { id: legacy.id } });
    }
    console.log("PASS: serviços reais — exclusão, rollback, auditoria, snapshots, reimportação e e-mail.");
  } finally {
    await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: codigo } });
    await prismaTest.medicao.deleteMany({ where: { id: medicao.id } });
    await prismaTest.profissional.deleteMany({ where: { id: profissional.id } });
    await prismaTest.projeto.deleteMany({ where: { id: projeto.id } });
    await prismaTest.adminAuditLog.deleteMany({ where: { adminId: admin.id } });
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
