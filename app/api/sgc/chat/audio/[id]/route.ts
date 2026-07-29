import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const log = await prisma.sgcLog.findUnique({
    where: { id },
    select: {
      colaboradorCodigo: true,
      tipoMensagem: true,
      audioArquivo: true,
      audioMime: true,
      audioNome: true,
    },
  });

  if (!log || log.tipoMensagem !== "AUDIO" || !log.audioArquivo) {
    return NextResponse.json({ error: "Áudio não encontrado." }, { status: 404 });
  }

  if (user.perfil === "COLABORADOR" && log.colaboradorCodigo !== user.usuario) {
    return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });
  }
  if (!["COLABORADOR", "MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  return new NextResponse(log.audioArquivo, {
    headers: {
      "Content-Type": log.audioMime ?? "audio/webm",
      "Content-Disposition": `inline; filename="${encodeURIComponent(log.audioNome ?? "audio.webm")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
