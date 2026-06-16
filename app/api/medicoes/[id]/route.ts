import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeMedicao } from "@/lib/format";
import { buildMedicaoData } from "@/lib/medicao-input";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const data = buildMedicaoData(body);

  if (!data.numeroMedicao || !data.idProjeto) {
    return NextResponse.json({ message: "Número da medição e projeto são obrigatórios." }, { status: 400 });
  }

  const medicao = await prisma.medicao.update({
    where: { id },
    data,
    include: {
      projeto: true,
      coordenador: true,
      profissional: true,
    },
  });

  return NextResponse.json(serializeMedicao(medicao));
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.medicao.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
