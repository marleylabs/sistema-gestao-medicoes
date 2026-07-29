import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureChatParticipant } from "@/app/api/chat/_helpers";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { id } = await params;

  const participante = await ensureChatParticipant(id, user.id);
  if (!participante) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const now = new Date();
  await prisma.chatParticipante.update({
    where: { conversaId_usuarioId: { conversaId: id, usuarioId: user.id } },
    data: { ultimoLidoAt: now },
  });

  return NextResponse.json({ ok: true, lidoAt: now.toISOString() });
}
