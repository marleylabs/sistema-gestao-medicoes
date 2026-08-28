import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";

  const registros = await prisma.sgcAprovacaoMedicao.findMany({
    where: { ciclo },
    select: {
      colaboradorCodigo: true,
      colaboradorNome: true,
      status: true,
      revisaoNumero: true,
      id: true,
      statusConferencia: true,
    },
  });

  const payload: Record<string, { status: string; revisaoNumero: number; id: string; statusConferencia: string; colaboradorNome: string | null }> = {};
  for (const r of registros) {
    payload[r.colaboradorCodigo] = {
      status: r.status,
      revisaoNumero: r.revisaoNumero,
      id: r.id,
      statusConferencia: r.statusConferencia,
      colaboradorNome: r.colaboradorNome,
    };
  }

  return NextResponse.json(payload);
}
