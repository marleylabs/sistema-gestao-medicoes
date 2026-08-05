import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildSgcChatMessages } from "@/lib/bm-log";
import { prisma } from "@/lib/prisma";
import { normalizeAccessUsername, toColaboradorCodigo } from "@/lib/usuario-format";

function avatarUrlByUserId(id: string, updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?userId=${encodeURIComponent(id)}&v=${updatedAt.getTime()}` : null;
}

function avatarUrlByUsuario(usuario: string, updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?usuario=${encodeURIComponent(usuario)}&v=${updatedAt.getTime()}` : null;
}

function isOnline(onlineAt: Date | null | undefined) {
  return !!onlineAt && Date.now() - onlineAt.getTime() <= 2 * 60 * 1000;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito ao perfil Medição." }, { status: 403 });
  }

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";

  const registros = await prisma.sgcAprovacaoMedicao.findMany({
    where: {
      ciclo,
      status: { not: "AGUARDANDO_ENVIO" },
    },
    orderBy: [{ updatedAt: "desc" }, { revisaoSolicitadaAt: "desc" }],
    take: 80,
  });

  const payload = await Promise.all(
    registros.map(async (registro) => {
      const logs = await prisma.sgcLog.findMany({
        where: { sgcId: registro.id },
        select: {
          id: true,
          acao: true,
          observacao: true,
          usuarioId: true,
          tipoMensagem: true,
          audioMime: true,
          audioNome: true,
          usuarioNome: true,
          lidoAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });

      const chatUserIds = Array.from(new Set(logs.map((log) => log.usuarioId).filter((id): id is string => !!id)));
      const usuariosChat = await prisma.usuario.findMany({
        where: {
          OR: [
            { usuario: registro.colaboradorCodigo },
            { usuario: normalizeAccessUsername(registro.colaboradorCodigo) },
            ...(registro.colaboradorNome ? [{ nome: { equals: registro.colaboradorNome, mode: "insensitive" as const } }] : []),
            ...(chatUserIds.length ? [{ id: { in: chatUserIds } }] : []),
          ],
        },
        select: { id: true, usuario: true, nome: true, avatarAtualizadoAt: true, onlineAt: true },
      });
      const fornecedorUsuario = usuariosChat.find((usuario) => toColaboradorCodigo(usuario.usuario) === registro.colaboradorCodigo || usuario.nome === registro.colaboradorNome);
      const fornecedorAvatarUrl = fornecedorUsuario ? avatarUrlByUsuario(fornecedorUsuario.usuario, fornecedorUsuario.avatarAtualizadoAt) : null;
      const medicaoAvatarUrlsByUsuarioId = Object.fromEntries(
        usuariosChat.map((usuario) => [usuario.id, avatarUrlByUserId(usuario.id, usuario.avatarAtualizadoAt)]),
      );
      const mensagens = buildSgcChatMessages(registro, logs, { fornecedorAvatarUrl, medicaoAvatarUrlsByUsuarioId });

      return {
        id: registro.id,
        colaboradorCodigo: registro.colaboradorCodigo,
        colaboradorNome: registro.colaboradorNome,
        status: registro.status,
        revisaoNumero: registro.revisaoNumero,
        proximaRevisaoLabel: `Rev. ${registro.revisaoNumero + 1}`,
        pontosDiscordancia: registro.pontosDiscordancia,
        respostaAdmin: registro.respostaAdmin,
        observacaoColaborador: registro.observacaoColaborador,
        colaboradorAvatarUrl: fornecedorAvatarUrl,
        colaboradorOnline: isOnline(fornecedorUsuario?.onlineAt),
        mensagens,
        revisaoSolicitadaAt: registro.revisaoSolicitadaAt?.toISOString() ?? null,
      };
    }),
  );

  return NextResponse.json(payload.filter((registro) => registro.mensagens.length > 0));
}
