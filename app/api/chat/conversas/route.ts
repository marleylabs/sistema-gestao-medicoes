import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avatarUrlByUserId, canChatWith, canUseChatPerfil, directChatKey, importSgcChatsForUser, isInternalPerfil, isOnline, joinSharedFornecedorChats } from "@/app/api/chat/_helpers";

function serializePerfil(perfil: string) {
  if (perfil === "COLABORADOR") return "Fornecedor";
  if (perfil === "FINANCEIRO") return "Financeiro";
  if (perfil === "ADMIN") return "Administrador";
  if (perfil === "MEDICAO") return "Medição";
  return "Usuário";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json([]);
  await importSgcChatsForUser(user);
  await joinSharedFornecedorChats(user);

  const participacoes = await prisma.chatParticipante.findMany({
    where: { usuarioId: user.id },
    include: {
      conversa: {
        include: {
          participantes: { include: { usuario: { select: { id: true, usuario: true, nome: true, perfil: true, avatarAtualizadoAt: true, onlineAt: true } } } },
          mensagens: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { autor: { select: { id: true, nome: true } } },
          },
        },
      },
    },
    orderBy: { conversa: { updatedAt: "desc" } },
    take: 80,
  });

  const payload = await Promise.all(participacoes.map(async (participacao) => {
    const conversa = participacao.conversa;
    const outro = isInternalPerfil(user.perfil)
      ? conversa.participantes.find((item) => item.usuario.perfil === "COLABORADOR")?.usuario
        ?? conversa.participantes.find((item) => item.usuarioId !== user.id)?.usuario
      : conversa.participantes.find((item) => item.usuarioId !== user.id && isInternalPerfil(item.usuario.perfil))?.usuario
        ?? conversa.participantes.find((item) => item.usuarioId !== user.id)?.usuario;
    const ultima = conversa.mensagens[0] ?? null;
    const unread = await prisma.chatMensagem.count({
      where: {
        conversaId: conversa.id,
        autorId: { not: user.id },
        ...(participacao.ultimoLidoAt ? { createdAt: { gt: participacao.ultimoLidoAt } } : {}),
      },
    });
    return {
      id: conversa.id,
      titulo: outro?.nome ?? conversa.titulo ?? "Conversa",
      subtitulo: outro ? serializePerfil(outro.perfil) : "Conversa",
      targetUserId: outro?.id ?? null,
      avatarUrl: outro ? avatarUrlByUserId(outro.id, outro.avatarAtualizadoAt) : null,
      online: isOnline(outro?.onlineAt),
      ultimaMensagem: ultima ? {
        id: ultima.id,
        texto: ultima.texto,
        autorNome: ultima.autor.nome,
        criadoAt: ultima.createdAt.toISOString(),
      } : null,
      unreadCount: unread,
      updatedAt: conversa.updatedAt.toISOString(),
    };
  }));

  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) {
    return NextResponse.json({ error: "O Administrativo não utiliza o chat da aplicação." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : "";
  if (!targetUserId || targetUserId === user.id) {
    return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
  }

  const target = await prisma.usuario.findUnique({
    where: { id: targetUserId },
    select: { id: true, perfil: true, ativo: true },
  });
  if (!target?.ativo || !canChatWith(user, target.perfil)) {
    return NextResponse.json({ error: "Usuário indisponível para conversa." }, { status: 403 });
  }

  if ((isInternalPerfil(user.perfil) && target.perfil === "COLABORADOR") || (user.perfil === "COLABORADOR" && isInternalPerfil(target.perfil))) {
    const fornecedorId = user.perfil === "COLABORADOR" ? user.id : target.id;
    const existing = await prisma.chatConversa.findFirst({
      where: {
        participantes: { some: { usuarioId: fornecedorId } },
        AND: [{ participantes: { some: { usuario: { perfil: { in: ["MEDICAO", "ADMIN", "FINANCEIRO"] } } } } }],
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      await prisma.chatParticipante.upsert({
        where: { conversaId_usuarioId: { conversaId: existing.id, usuarioId: user.id } },
        create: { conversaId: existing.id, usuarioId: user.id, ultimoLidoAt: new Date() },
        update: {},
      });
      if (target.id !== user.id) {
        await prisma.chatParticipante.upsert({
          where: { conversaId_usuarioId: { conversaId: existing.id, usuarioId: target.id } },
          create: { conversaId: existing.id, usuarioId: target.id },
          update: {},
        });
      }
      return NextResponse.json({ id: existing.id });
    }
  }

  const chave = directChatKey(user.id, target.id);
  const conversa = await prisma.chatConversa.upsert({
    where: { chave },
    create: {
      chave,
      participantes: {
        create: [
          { usuarioId: user.id, ultimoLidoAt: new Date() },
          { usuarioId: target.id },
        ],
      },
    },
    update: { updatedAt: new Date() },
    select: { id: true },
  });

  return NextResponse.json({ id: conversa.id });
}
