import { prisma } from "@/lib/prisma";

export async function logBmAction(opts: {
  sgcId?: string;
  colaboradorCodigo: string;
  ciclo?: string;
  usuarioId?: string;
  usuarioNome?: string;
  acao: string;
  statusAnterior?: string;
  statusNovo?: string;
  telaOrigem?: string;
  observacao?: string;
}) {
  try {
    await prisma.sgcLog.create({ data: opts });
  } catch {
    // log errors must never interrupt the main flow
  }
}
