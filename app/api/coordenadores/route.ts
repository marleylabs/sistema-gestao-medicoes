import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeProfessional } from "@/lib/format";

export async function GET() {
  const medicoes = await prisma.medicao.findMany({
    where: {
      idCoordenador: {
        not: null,
      },
    },
    distinct: ["idCoordenador"],
    select: {
      coordenador: {
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
      },
    },
    orderBy: {
      coordenador: {
        nome: "asc",
      },
    },
  });

  const coordenadores = medicoes
    .map((medicao) => medicao.coordenador)
    .filter((coordenador): coordenador is NonNullable<typeof coordenador> => Boolean(coordenador));

  return NextResponse.json(coordenadores.map(serializeProfessional));
}
