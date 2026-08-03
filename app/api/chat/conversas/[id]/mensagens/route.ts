import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avatarUrlByUserId, canUseChatPerfil, ensureChatParticipant } from "@/app/api/chat/_helpers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json({ error: "O Administrativo não utiliza o chat da aplicação." }, { status: 403 });
  const { id } = await params;

  const participante = await ensureChatParticipant(id, user.id);
  if (!participante) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const mensagens = await prisma.chatMensagem.findMany({
    where: { conversaId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { autor: { select: { id: true, nome: true, avatarAtualizadoAt: true } } },
  });

  return NextResponse.json(mensagens.map((mensagem) => ({
    id: mensagem.id,
    autorId: mensagem.autorId,
    autorNome: mensagem.autor.nome,
    autorAvatarUrl: avatarUrlByUserId(mensagem.autorId, mensagem.autor.avatarAtualizadoAt),
    texto: mensagem.texto,
    criadoAt: mensagem.createdAt.toISOString(),
    meu: mensagem.autorId === user.id,
  })));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json({ error: "O Administrativo não utiliza o chat da aplicação." }, { status: 403 });
  const { id } = await params;

  const participante = await ensureChatParticipant(id, user.id);
  if (!participante) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const texto = typeof body?.texto === "string" ? body.texto.trim() : "";
  if (texto.length < 1) return NextResponse.json({ error: "Digite uma mensagem." }, { status: 400 });
  if (texto.length > 2000) return NextResponse.json({ error: "Mensagem muito longa." }, { status: 400 });

  const now = new Date();
  const mensagem = await prisma.chatMensagem.create({
    data: { conversaId: id, autorId: user.id, texto },
    include: { autor: { select: { id: true, nome: true, avatarAtualizadoAt: true } } },
  });
  await prisma.chatConversa.update({ where: { id }, data: { updatedAt: now } });
  await prisma.chatParticipante.update({
    where: { conversaId_usuarioId: { conversaId: id, usuarioId: user.id } },
    data: { ultimoLidoAt: now },
  });

  return NextResponse.json({
    id: mensagem.id,
    autorId: mensagem.autorId,
    autorNome: mensagem.autor.nome,
    autorAvatarUrl: avatarUrlByUserId(mensagem.autorId, mensagem.autor.avatarAtualizadoAt),
    texto: mensagem.texto,
    criadoAt: mensagem.createdAt.toISOString(),
    meu: true,
  });
}
