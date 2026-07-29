import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function avatarUrl(updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?v=${updatedAt.getTime()}` : null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const dbUser = await prisma.usuario.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      avatarAtualizadoAt: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
  });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  return NextResponse.json({
    ...dbUser,
    avatarUrl: avatarUrl(dbUser.avatarAtualizadoAt),
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";

  if (nome.length < 3) {
    return NextResponse.json({ error: "Informe um nome com pelo menos 3 caracteres." }, { status: 400 });
  }
  if (nome.length > 120) {
    return NextResponse.json({ error: "O nome deve ter no máximo 120 caracteres." }, { status: 400 });
  }

  const updated = await prisma.usuario.update({
    where: { id: user.id },
    data: { nome, updatedAt: new Date() },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      avatarAtualizadoAt: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ...updated,
    avatarUrl: avatarUrl(updated.avatarAtualizadoAt),
  });
}
