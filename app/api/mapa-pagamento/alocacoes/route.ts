import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const rows = await prisma.mapaPagamentoItem.findMany({
    where: { ato: { not: null } },
    select: { ato: true },
    distinct: ["ato"],
    orderBy: { ato: "asc" },
  });

  const alocacoes = rows.map((r) => r.ato).filter(Boolean) as string[];
  return NextResponse.json(alocacoes);
}
