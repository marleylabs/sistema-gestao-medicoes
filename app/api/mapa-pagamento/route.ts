import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";

export async function GET(request: NextRequest) {
  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";

  const itens = await prisma.mapaPagamentoItem.findMany({
    where: {
      ciclo,
      valor: { gt: 0 },
    },
    orderBy: { ordem: "asc" },
  });

  return NextResponse.json(itens.map(serializeMapaPagamentoItem));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json();
  const ciclo = typeof payload.ciclo === "string" ? payload.ciclo.trim() : "2605";

  const maxOrdem = await prisma.mapaPagamentoItem.aggregate({
    where: { ciclo },
    _max: { ordem: true },
  });
  const nextOrdem = (maxOrdem._max.ordem ?? 0) + 1;

  const created = await prisma.mapaPagamentoItem.create({
    data: mapaPagamentoData({ ...payload, ciclo, ordem: nextOrdem }),
  });

  return NextResponse.json(serializeMapaPagamentoItem(created), { status: 201 });
}
