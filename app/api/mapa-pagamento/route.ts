import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";

export async function GET() {
  const itens = await prisma.mapaPagamentoItem.findMany({
    where: {
      valor: {
        gt: 0,
      },
    },
    orderBy: { ordem: "asc" },
  });

  return NextResponse.json(itens.map(serializeMapaPagamentoItem));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json();
  const created = await prisma.mapaPagamentoItem.create({
    data: mapaPagamentoData(payload),
  });

  return NextResponse.json(serializeMapaPagamentoItem(created), { status: 201 });
}
