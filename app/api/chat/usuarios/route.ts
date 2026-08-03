import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avatarUrlByUserId, canChatWith, canUseChatPerfil, isOnline } from "@/app/api/chat/_helpers";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json([]);

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const usuarios = await prisma.usuario.findMany({
    where: {
      ativo: true,
      excluidoAt: null,
      id: { not: user.id },
      ...(q ? {
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          { usuario: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    },
    select: { id: true, usuario: true, nome: true, perfil: true, avatarAtualizadoAt: true, onlineAt: true },
    orderBy: [{ perfil: "asc" }, { nome: "asc" }],
    take: 40,
  });

  return NextResponse.json(
    usuarios
      .filter((target) => canChatWith(user, target.perfil))
      .map((target) => ({
        id: target.id,
        usuario: target.usuario,
        nome: target.nome,
        perfil: target.perfil,
        avatarUrl: avatarUrlByUserId(target.id, target.avatarAtualizadoAt),
        online: isOnline(target.onlineAt),
      })),
  );
}
