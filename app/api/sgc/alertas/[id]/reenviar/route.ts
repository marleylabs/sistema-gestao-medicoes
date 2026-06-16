import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await context.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Identificador SGC inválido." }, { status: 400 });
  }

  const current = await prisma.sgcAprovacaoMedicao.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Solicitação SGC não encontrada." }, { status: 404 });
  }
  if (current.status !== "REVISAO_SOLICITADA") {
    return NextResponse.json({ error: "Apenas solicitações de revisão podem ser reenviadas." }, { status: 409 });
  }
  if (current.revisaoNumero >= 5) {
    return NextResponse.json({ error: "Limite de revisões atingido para este ciclo." }, { status: 409 });
  }

  const revisaoNumero = current.revisaoNumero + 1;
  const updated = await prisma.sgcAprovacaoMedicao.update({
    where: { id },
    data: {
      status: "PENDENTE",
      revisaoNumero,
      pontosDiscordancia: null,
      revisaoSolicitadaAt: null,
      aprovadoAt: null,
      reenviadoAt: new Date(),
      resolvidoAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    revisaoNumero: updated.revisaoNumero,
    revisaoLabel: `Rev. ${updated.revisaoNumero}`,
  });
}
