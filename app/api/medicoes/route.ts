import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeMedicao } from "@/lib/format";
import { buildCreateMedicaoData } from "@/lib/medicao-input";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const numero = searchParams.get("numero")?.trim();
  const projeto = searchParams.get("projeto")?.trim();
  const coordenador = searchParams.get("coordenador")?.trim();

  const medicoes = await prisma.medicao.findMany({
    where: {
      ...(numero ? { numeroMedicao: { contains: numero, mode: "insensitive" } } : {}),
      ...(projeto ? { idProjeto: projeto } : {}),
      ...(coordenador ? { idCoordenador: coordenador } : {}),
    },
    include: {
      projeto: true,
      coordenador: true,
      profissional: true,
    },
    orderBy: [{ dataCadastro: "desc" }, { numeroMedicao: "desc" }],
    take: 500,
  });

  return NextResponse.json(medicoes.map(serializeMedicao));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const data = buildCreateMedicaoData(body);

  if (!data.numeroMedicao || !data.idProjeto) {
    return NextResponse.json({ message: "Número da medição e projeto são obrigatórios." }, { status: 400 });
  }

  const medicao = await prisma.medicao.create({
    data,
    include: {
      projeto: true,
      coordenador: true,
      profissional: true,
    },
  });

  return NextResponse.json(serializeMedicao(medicao), { status: 201 });
}
