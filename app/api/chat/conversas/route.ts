import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avatarUrlByUserId, canChatWith, canUseChatPerfil, directChatKey, importSgcChatsForUser, isDisabledTeamChave, isInternalPerfil, isOnline, joinSharedFornecedorChats } from "@/app/api/chat/_helpers";

function serializePerfil(perfil: string) {
  if (perfil === "COLABORADOR") return "Fornecedor";
  if (perfil === "FINANCEIRO") return "Financeiro";
  if (perfil === "ADMIN") return "Administrador";
  if (perfil === "MEDICAO") return "Equipe de Medição";
  return "Usuário";
}

function teamLabel(perfil: string) {
  if (perfil === "MEDICAO") return "Equipe de Medição";
  if (perfil === "FINANCEIRO") return "Financeiro";
  if (perfil === "ADMIN") return "Administrador";
  return "Equipe";
}

function getTeamPerfilFromKey(chave: string) {
  const parts = chave.split(":");
  return parts[0] === "TEAM" ? parts[1] ?? null : null;
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

  const payload = await Promise.all(participacoes.filter((participacao) => !isDisabledTeamChave(participacao.conversa.chave)).map(async (participacao) => {
    const conversa = participacao.conversa;
    const chaveTeamPerfil = getTeamPerfilFromKey(conversa.chave);
    const temColaborador = conversa.participantes.some((item) => item.usuario.perfil === "COLABORADOR");
    // "TEAM:<perfil>:<id>" serve dois propósitos: canal interno genérico da equipe (ex.: ADMIN↔MEDICAO)
    // OU o canal individual de um fornecedor com aquela equipe (chave termina no id do colaborador).
    // Só o primeiro caso deve exibir o rótulo genérico da equipe — senão duas conversas de fornecedores
    // diferentes com a mesma equipe aparecem ambas como "Equipe de Medição", mascarando quem é quem.
    const ehCanalGenericoDaEquipe = !!chaveTeamPerfil && (user.perfil === "COLABORADOR" || !temColaborador);
    const targetPerfil = ehCanalGenericoDaEquipe ? chaveTeamPerfil : null;
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
      titulo: targetPerfil ? teamLabel(targetPerfil) : outro?.nome ?? conversa.titulo ?? "Conversa",
      subtitulo: targetPerfil ? "Equipe fixada" : outro ? serializePerfil(outro.perfil) : "Conversa",
      targetUserId: outro?.id ?? null,
      targetPerfil,
      avatarUrl: targetPerfil ? null : outro ? avatarUrlByUserId(outro.id, outro.avatarAtualizadoAt) : null,
      online: targetPerfil
        ? conversa.participantes.some((item) => item.usuarioId !== user.id && isOnline(item.usuario.onlineAt))
        : isOnline(outro?.onlineAt),
      ultimaMensagem: ultima ? {
        id: ultima.id,
        texto: ultima.tipoMensagem === "AUDIO"
          ? "Áudio"
          : ultima.tipoMensagem === "IMAGEM"
            ? "Imagem"
            : ultima.tipoMensagem === "VIDEO"
              ? "Vídeo"
              : ultima.tipoMensagem === "ARQUIVO"
                ? (ultima.arquivoNome ?? "Arquivo")
                : ultima.texto,
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
  const targetPerfil = typeof body?.targetPerfil === "string" ? body.targetPerfil : targetUserId.startsWith("perfil:") ? targetUserId.replace("perfil:", "") : "";

  if (targetPerfil) {
    if (targetPerfil === "FINANCEIRO") {
      return NextResponse.json({ error: "A conversa com o Financeiro está desabilitada." }, { status: 403 });
    }
    if (!canChatWith(user, targetPerfil)) {
      return NextResponse.json({ error: "Equipe indisponível para conversa." }, { status: 403 });
    }

    let targets = await prisma.usuario.findMany({
      where: {
        perfil: targetPerfil,
        ativo: true,
        excluidoAt: null,
        id: { not: user.id },
      },
      select: { id: true },
      orderBy: { nome: "asc" },
      take: 20,
    });

    if (!targets.length && targetPerfil !== "ADMIN") {
      targets = await prisma.usuario.findMany({
        where: {
          perfil: "ADMIN",
          ativo: true,
          excluidoAt: null,
          id: { not: user.id },
        },
        select: { id: true },
        orderBy: { nome: "asc" },
        take: 5,
      });
    }

    if (!targets.length) {
      return NextResponse.json({ error: "Nenhum usuário disponível nessa equipe." }, { status: 404 });
    }

    const chave = user.perfil === "COLABORADOR"
      ? `TEAM:${targetPerfil}:${user.id}`
      : `TEAM:${targetPerfil}:${user.perfil}`;
    const participantIds = Array.from(new Set([user.id, ...targets.map((target) => target.id)]));
    const conversa = await prisma.chatConversa.upsert({
      where: { chave },
      create: {
        chave,
        tipo: "EQUIPE",
        titulo: teamLabel(targetPerfil),
        participantes: {
          create: participantIds.map((usuarioId) => ({
            usuarioId,
            ...(usuarioId === user.id ? { ultimoLidoAt: new Date() } : {}),
          })),
        },
      },
      update: { updatedAt: new Date(), titulo: teamLabel(targetPerfil), tipo: "EQUIPE" },
      select: { id: true },
    });

    for (const usuarioId of participantIds) {
      await prisma.chatParticipante.upsert({
        where: { conversaId_usuarioId: { conversaId: conversa.id, usuarioId } },
        create: { conversaId: conversa.id, usuarioId, ...(usuarioId === user.id ? { ultimoLidoAt: new Date() } : {}) },
        update: {},
      });
    }

    return NextResponse.json({ id: conversa.id });
  }

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
