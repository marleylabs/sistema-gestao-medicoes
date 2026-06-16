import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function dateValue(value: unknown) {
  const cleaned = text(value);
  if (!cleaned) return null;
  const date = new Date(`${cleaned}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json();
  const contexto = await prisma.mapaPagamentoContexto.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      mesReferencia: text(payload.mesReferencia),
      producaoLabel: text(payload.producaoLabel),
      producaoInicio: dateValue(payload.producaoInicio),
      producaoFim: dateValue(payload.producaoFim),
      atoLabel: text(payload.atoLabel),
      atoCiclo: text(payload.atoCiclo),
      contratos: [],
      rateio: [],
    },
    update: {
      mesReferencia: text(payload.mesReferencia),
      producaoLabel: text(payload.producaoLabel),
      producaoInicio: dateValue(payload.producaoInicio),
      producaoFim: dateValue(payload.producaoFim),
      atoLabel: text(payload.atoLabel),
      atoCiclo: text(payload.atoCiclo),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({
    id: contexto.id,
    mesReferencia: contexto.mesReferencia,
    producaoLabel: contexto.producaoLabel,
    producaoInicio: contexto.producaoInicio?.toISOString().slice(0, 10) ?? null,
    producaoFim: contexto.producaoFim?.toISOString().slice(0, 10) ?? null,
    atoLabel: contexto.atoLabel,
    atoCiclo: contexto.atoCiclo,
  });
}

export async function DELETE() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  await prisma.mapaPagamentoContexto.deleteMany({ where: { id: 1 } });
  return NextResponse.json({ ok: true });
}
