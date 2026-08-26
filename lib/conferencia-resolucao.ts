import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/** Se não restar nenhuma divergência PENDENTE para este sgcId, libera a conferência (CONCLUIDA). */
export async function liberarConferenciaSeCompleta(tx: TxClient | Prisma.TransactionClient, sgcId: string) {
  const pendentes = await tx.divergenciaMedicao.count({ where: { sgcId, status: "PENDENTE" } });
  if (pendentes === 0) {
    await tx.sgcAprovacaoMedicao.update({
      where: { id: sgcId },
      data: { statusConferencia: "CONCLUIDA", updatedAt: new Date() },
    });
    return true;
  }
  return false;
}
