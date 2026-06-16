import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeProfessional } from "@/lib/format";

export async function GET() {
  const profissionais = await prisma.profissional.findMany({
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
      codigo: true,
      nomeCompleto: true,
      cpf: true,
      razaoSocial: true,
      cnpj: true,
      email: true,
      statusColaborador: true,
      funcao: true,
    },
  });

  return NextResponse.json(profissionais.map(serializeProfessional));
}
