import { prisma } from "@/lib/prisma";

export async function getCicloAtivoMedicao() {
  const ativo = await prisma.mapaPagamentoContexto.findFirst({
    where: { ativoMedicao: true },
    select: { ciclo: true },
    orderBy: { ciclo: "desc" },
  });
  if (ativo?.ciclo) return ativo.ciclo;

  const maisRecente = await prisma.mapaPagamentoContexto.findFirst({
    select: { ciclo: true },
    orderBy: { ciclo: "desc" },
  });
  return maisRecente?.ciclo ?? "2605";
}
