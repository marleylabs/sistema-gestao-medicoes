import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const colaboradorCodigo = typeof payload?.colaboradorCodigo === "string" ? payload.colaboradorCodigo.trim() : "";
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "2605";

  if (!colaboradorCodigo) {
    return NextResponse.json({ error: "Código do colaborador é obrigatório." }, { status: 400 });
  }

  const profissional = await prisma.profissional.findUnique({
    where: { codigo: colaboradorCodigo },
    select: { nome: true, nomeCompleto: true },
  });

  const existing = await prisma.sgcAprovacaoMedicao.findUnique({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
    select: { status: true },
  });

  if (existing && !["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Medição já enviada para este colaborador neste ciclo." },
      { status: 409 },
    );
  }

  const isRevisao = existing?.status === "REVISAO_SOLICITADA";
  const now = new Date();

  const sgc = await prisma.sgcAprovacaoMedicao.upsert({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
    create: {
      colaboradorCodigo,
      ciclo,
      colaboradorNome: profissional?.nomeCompleto || profissional?.nome || colaboradorCodigo,
      status: "PENDENTE",
      revisaoNumero: 0,
    },
    update: {
      status: "PENDENTE",
      pontosDiscordancia: null,
      revisaoSolicitadaAt: null,
      aprovadoAt: null,
      reenviadoAt: isRevisao ? now : undefined,
      resolvidoAt: isRevisao ? now : undefined,
      revisaoNumero: isRevisao ? { increment: 1 } : undefined,
      updatedAt: now,
    },
  });

  return NextResponse.json({
    status: sgc.status,
    colaboradorCodigo: sgc.colaboradorCodigo,
    revisaoNumero: sgc.revisaoNumero,
  });
}
