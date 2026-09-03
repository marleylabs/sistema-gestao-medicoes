import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { serializeProfessional } from "@/lib/format";

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const profissionais = await prisma.profissional.findMany({
    // Seletor operacional (Novo Pagamento/Editar Pagamento) — identidades excluídas
    // definitivamente pelo ADMIN (Profissional.deletedAt) nunca podem ser oferecidas para um
    // processo NOVO. Estado explícito e real, não uma heurística sobre campos vazios.
    where: { deletedAt: null },
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
