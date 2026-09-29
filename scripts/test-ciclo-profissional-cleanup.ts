import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteOrphanProfessionalsAfterCycleRemoval } from "../lib/ciclo-cleanup";
import { assertConnectedToE2eDatabase, prismaTest } from "../lib/prisma-test";

const ROLLBACK = "ROLLBACK_TEST_CICLO_CLEANUP";

async function main() {
  await assertConnectedToE2eDatabase();

  try {
    await prismaTest.$transaction(async (tx) => {
      const suffix = randomUUID();
      const protectedNames = [
        `TESTE_IDENTIDADE_${suffix}`,
        `CRISTIANO JEFERSON TESTE ${suffix}`,
        `MAURICIO SPINDOLA TESTE ${suffix}`,
        `JOSE EVERTON TESTE ${suffix}`,
      ];

      for (const codigo of protectedNames) {
        await tx.profissional.create({ data: { nome: codigo, codigo } });
        await tx.cadastroFornecedor.create({
          data: {
            colaboradorCodigo: codigo,
            responsavel: codigo,
            cnpjNormalizado: "00000000000000",
            razaoSocial: "Fixture de regressão",
            ativo: true,
          },
        });
      }

      const orphanCode = `ORFAO_${suffix}`;
      const orphan = await tx.profissional.create({ data: { nome: orphanCode, codigo: orphanCode } });

      const inactiveCode = `INATIVO_${suffix}`;
      const inactive = await tx.profissional.create({ data: { nome: inactiveCode, codigo: inactiveCode } });
      const inactiveCadastro = await tx.cadastroFornecedor.create({
        data: {
          colaboradorCodigo: inactiveCode,
          responsavel: inactiveCode,
          cnpjNormalizado: "00000000000000",
          razaoSocial: "Fixture inativa",
            ativo: true,
        },
      });

      await tx.cadastroFornecedor.update({
        where: { id: inactiveCadastro.id },
        data: { ativo: false, inativadoAt: new Date() },
      });

      const removed = await deleteOrphanProfessionalsAfterCycleRemoval(tx);

      for (const codigo of protectedNames) {
        assert.ok(await tx.profissional.findUnique({ where: { codigo } }), `${codigo} deve ser protegido pelo cadastro ativo`);
      }
      assert.equal(await tx.profissional.findUnique({ where: { id: orphan.id } }), null, "órfão legítimo deve continuar removível");
      assert.ok(await tx.profissional.findUnique({ where: { id: inactive.id } }), "cadastro inativo deve preservar a identidade canônica");
      assert.ok(removed >= 1, "a limpeza deve remover ao menos a fixture realmente órfã");

      // Sequência aprovada: ativo -> inativo -> cleanup -> reativo conserva exatamente o mesmo
      // vínculo canônico; não há criação/reconciliação de Profissional em nenhuma etapa.
      await tx.cadastroFornecedor.update({ where: { id: inactiveCadastro.id }, data: { ativo: true, inativadoAt: null } });
      const afterReactivation = await tx.profissional.findUniqueOrThrow({ where: { codigo: inactiveCode } });
      assert.equal(afterReactivation.id, inactive.id, "reativação deve continuar vinculada ao mesmo Profissional");
      assert.equal(await tx.profissional.count({ where: { codigo: inactiveCode } }), 1, "reativação nunca duplica Profissional");

      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK) {
      console.log("PASS: cadastros ativo e inativo protegem Profissional; reativação preserva o mesmo UUID; órfão real continua removível.");
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prismaTest.$disconnect());
