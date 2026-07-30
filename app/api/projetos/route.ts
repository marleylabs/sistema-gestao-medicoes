import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const projetos = await prisma.projeto.findMany({
    orderBy: { codigoProjeto: "asc" },
    select: {
      id: true,
      codigoProjeto: true,
      centroCusto: true,
      localizacao: true,
      contrato: true,
    },
  });

  return NextResponse.json(projetos);
}
