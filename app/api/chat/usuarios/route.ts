import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avatarUrlByUserId, canChatWith, canUseChatPerfil, isOnline } from "@/app/api/chat/_helpers";

const FIXED_TEAM_PROFILES = new Set(["MEDICAO", "FINANCEIRO", "ADMIN"]);

function fixedProfilesFor(perfil: string) {
  if (perfil === "COLABORADOR") return new Set(["MEDICAO", "FINANCEIRO"]);
  if (perfil === "MEDICAO") return new Set(["FINANCEIRO", "ADMIN"]);
  if (perfil === "FINANCEIRO") return new Set(["MEDICAO", "ADMIN"]);
  if (perfil === "ADMIN") return new Set(["MEDICAO", "FINANCEIRO"]);
  return new Set<string>();
}

function teamLabel(perfil: string) {
  if (perfil === "MEDICAO") return "Equipe de Medição";
  if (perfil === "FINANCEIRO") return "Financeiro";
  if (perfil === "ADMIN") return "Administrador";
  return "Equipe";
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json([]);

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const fixedProfiles = fixedProfilesFor(user.perfil);
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
      } : fixedProfiles.size ? { perfil: { in: Array.from(fixedProfiles) } } : {}),
    },
    select: { id: true, usuario: true, nome: true, perfil: true, avatarAtualizadoAt: true, onlineAt: true },
    orderBy: [{ perfil: "asc" }, { nome: "asc" }],
    take: 40,
  });

  const usedFixedProfiles = new Set<string>();
  const mappedUsuarios = usuarios
    .filter((target) => canChatWith(user, target.perfil))
    .map((target) => {
      const fixado = fixedProfiles.has(target.perfil) && !usedFixedProfiles.has(target.perfil);
      if (fixado) usedFixedProfiles.add(target.perfil);
      return ({
        id: target.id,
        usuario: target.usuario,
        nome: target.nome,
        perfil: target.perfil,
        avatarUrl: avatarUrlByUserId(target.id, target.avatarAtualizadoAt),
        online: isOnline(target.onlineAt),
        fixado,
      });
    });

  if (!q) {
    const fixedTeamCards = Array.from(fixedProfiles)
      .filter((perfil) => FIXED_TEAM_PROFILES.has(perfil))
      .map((perfil) => ({
        id: `perfil:${perfil}`,
        usuario: `perfil:${perfil}`,
        nome: teamLabel(perfil),
        perfil,
        avatarUrl: null,
        online: mappedUsuarios.some((target) => target.perfil === perfil && target.online),
        fixado: true,
      }));
    return NextResponse.json(fixedTeamCards);
  }

  return NextResponse.json(
    mappedUsuarios,
  );
}
