import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const usuarios = await prisma.usuario.findMany({
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      ativo: true,
      primeiroLogin: true,
      senhaTemporaria: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });

  return NextResponse.json(
    usuarios.map((u) => ({
      id: u.id,
      usuario: u.usuario,
      nome: u.nome,
      perfil: u.perfil,
      ativo: u.ativo,
      primeiroLogin: u.primeiroLogin,
      senhaTemporaria: u.senhaTemporaria,
      ultimoLoginAt: u.ultimoLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }))
  );
}
