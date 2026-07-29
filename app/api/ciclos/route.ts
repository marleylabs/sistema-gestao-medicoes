import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cicloToDates, cicloToMesReferencia } from "@/lib/ciclo";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const ciclos = await prisma.mapaPagamentoContexto.findMany({
    select: {
      ciclo: true,
      mesReferencia: true,
      ativoMedicao: true,
      updatedAt: true,
    },
    orderBy: { ciclo: "desc" },
  });

  return NextResponse.json(ciclos);
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "";

  if (!ciclo || !/^\d{4}$/.test(ciclo)) {
    return NextResponse.json({ error: "Ciclo inválido. Use formato YYMM (ex: 2606)." }, { status: 400 });
  }

  const existing = await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo } });
  if (existing) {
    return NextResponse.json({ error: "Ciclo já existe." }, { status: 409 });
  }

  const datas = cicloToDates(ciclo);
  const created = await prisma.mapaPagamentoContexto.create({
    data: {
      ciclo,
      mesReferencia:  cicloToMesReferencia(ciclo),
      producaoInicio: new Date(`${datas.producaoInicio}T00:00:00`),
      producaoFim:    new Date(`${datas.producaoFim}T00:00:00`),
      atoCiclo:       ciclo,
    },
  });

  return NextResponse.json({ ciclo: created.ciclo }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "";
  const action = typeof payload?.action === "string" ? payload.action : "";

  if (action !== "set_ativo_medicao") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  if (!ciclo || !/^\d{4}$/.test(ciclo)) {
    return NextResponse.json({ error: "Ciclo inválido. Use formato YYMM (ex: 2606)." }, { status: 400 });
  }

  const existing = await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo } });
  if (!existing) {
    return NextResponse.json({ error: "Ciclo não encontrado." }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.mapaPagamentoContexto.updateMany({ data: { ativoMedicao: false } }),
    prisma.mapaPagamentoContexto.update({ where: { ciclo }, data: { ativoMedicao: true, updatedAt: new Date() } }),
  ]);

  return NextResponse.json({ ciclo, ativoMedicao: true });
}
