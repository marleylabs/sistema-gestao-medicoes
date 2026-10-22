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

/** Ciclo que o fornecedor preenche no timesheet: o publicado no timesheet, senão o do portal. */
export async function getCicloTimesheet() {
  const ativo = await prisma.mapaPagamentoContexto.findFirst({ where: { ativoTimesheet: true }, select: { ciclo: true } });
  return ativo?.ciclo ?? (await getCicloAtivoMedicao());
}
